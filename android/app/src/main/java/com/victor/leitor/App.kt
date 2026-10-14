package com.victor.leitor

import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.CookieManager
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.UUID
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

/** Free-books downloads above this are refused (scanned PDFs on the Internet Archive can reach hundreds of MB). */
private const val MAX_DOWNLOAD = 80L * 1024 * 1024

/** Present in a book's folder once it was parsed with links; see [App.loadBlocks]. */
private const val PARSER_MARKER = "parsed-v2"

class App : Application() {
    lateinit var db: Db
    lateinit var prefs: Prefs
    lateinit var translator: TranslateService
    lateinit var backend: Backend
    var importing by mutableStateOf(false)
        private set
    var syncing by mutableStateOf(false)
        private set
    val speech by lazy { Speech(this) }
    private val scope = MainScope()

    override fun onCreate() {
        super.onCreate()
        CrashReports.install(this)
        PDFBoxResourceLoader.init(this)
        db = Db(this)
        prefs = Prefs(this)
        backend = Backend(prefs)
        translator = TranslateService(this, prefs, db, backend)
        Reminders.schedule(this)
        scope.launch {
            CrashReports.upload(this@App)
            if (prefs.accountEmail != null) sync(quiet = true)
        }
    }

    fun sync(quiet: Boolean = false) {
        if (syncing) return
        scope.launch {
            syncing = true
            val message = try {
                syncNow()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Sync", "sync failed", e)
                when {
                    e is ApiException && e.code == "SESSION_EXPIRED" -> getString(R.string.sync_session_expired)
                    e is ApiException && e.code == "STORAGE_FULL" -> getString(R.string.sync_storage_full)
                    e is java.io.IOException -> getString(R.string.sync_no_connection)
                    else -> getString(R.string.sync_failed)
                }
            } finally {
                syncing = false
            }
            if (!quiet) Toast.makeText(this@App, message, Toast.LENGTH_LONG).show()
        }
    }

    /** Parsed books are cached as JSON so opening a book never re-parses the original file. */
    fun bookFile(id: Long) = File(filesDir, "books/$id.json")

    fun bookDir(id: Long) = File(filesDir, "books/$id")

    fun coverFile(id: Long) = File(bookDir(id), "cover")

    fun tocFile(id: Long) = File(bookDir(id), "toc.json")

    /** Set by MainActivity: reading time only counts while the app is on screen. */
    @Volatile
    var foreground = false

    fun deleteBook(id: Long) {
        db.deleteBook(id)
        bookFile(id).delete()
        bookDir(id).deleteRecursively()
    }

    fun deleteAllBooks() {
        db.deleteAllBooks()
        File(filesDir, "books").deleteRecursively()
    }

    fun importBooks(uris: List<Uri>) {
        scope.launch {
            importing = true
            val message = try { importAll(uris) } finally { importing = false }
            Toast.makeText(this@App, message, Toast.LENGTH_LONG).show()
        }
    }

    /** Single entry point for every import; null when the same file is already in the library. */
    suspend fun importBytes(sourceKey: String, fileName: String, bytes: ByteArray): Long? = withContext(Dispatchers.IO) {
        val hash = sha256Hex(bytes)
        if (db.hasBook(sourceKey, hash)) return@withContext null
        val book = PdfOcr(bytes, cacheDir).use { ocr -> BookParser.parse(bytes, fileName, ocr = ocr::page) }
        require(book.blocks.isNotEmpty()) { "livro sem texto" }
        val id = db.insertBook(sourceKey, book.title, book.fileType, translator.detectLanguage(languageSample(book.blocks)), book.blocks.size, hash)
        try {
            val dir = bookDir(id).apply { mkdirs() }
            bookFile(id).writeText(BookParser.toJson(book.blocks))
            originalFile(id, book.fileType).writeBytes(bytes) // kept for the cloud backup
            book.images.forEach { (name, data) -> File(dir, name).writeBytes(data) }
            (book.cover ?: if (book.fileType == "pdf") pdfCover(bytes) else null)?.let { coverFile(id).writeBytes(it) }
            if (book.toc.isNotEmpty()) tocFile(id).writeText(BookParser.tocToJson(book.toc))
            File(dir, PARSER_MARKER).writeText("")
        } catch (e: Exception) {
            deleteBook(id)
            throw e
        }
        db.changed() // the row appeared before its files; let the library re-read the cover
        id
    }

    fun originalFile(id: Long, fileType: String) = File(bookDir(id), "original.$fileType")

    /**
     * Books imported before the parser kept links are parsed again from their original file once; the result is only
     * adopted when the text is identical, so reading positions, highlights and translations keep pointing at the same blocks.
     */
    fun loadBlocks(id: Long): List<Block> {
        val blocks = BookParser.fromJson(bookFile(id).readText())
        val marker = File(bookDir(id), PARSER_MARKER)
        val fileType = db.book(id)?.fileType
        val original = fileType?.let { originalFile(id, it) }
        if (marker.exists() || (fileType != "epub" && fileType != "fb2") || original?.exists() != true) return blocks
        val fresh = runCatching { BookParser.parse(original.readBytes(), "book.$fileType") }.getOrNull()
        marker.writeText("")
        if (fresh == null || fresh.blocks.map { it.text } != blocks.map { it.text }) return blocks
        bookFile(id).writeText(BookParser.toJson(fresh.blocks))
        if (fresh.toc.isNotEmpty()) tocFile(id).writeText(BookParser.tocToJson(fresh.toc))
        return fresh.blocks
    }

    fun importDownload(url: String, fileName: String, userAgent: String, onAdded: (Long) -> Unit) {
        scope.launch {
            importing = true
            val id = try {
                withContext(Dispatchers.IO) {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.setRequestProperty("User-Agent", userAgent)
                    CookieManager.getInstance().getCookie(url)?.let { c.setRequestProperty("Cookie", it) }
                    c.connectTimeout = 15_000
                    c.readTimeout = 60_000
                    require(c.contentLengthLong <= MAX_DOWNLOAD) { "arquivo grande demais" }
                    val bytes = c.inputStream.use { it.readNBytesCapped(MAX_DOWNLOAD) }
                    importBytes(url, fileName, bytes) ?: -1L
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Import", "download failed: $url", e)
                null
            } finally {
                importing = false
            }
            when (id) {
                null -> Toast.makeText(this@App, getString(R.string.import_failed, fileName), Toast.LENGTH_LONG).show()
                -1L -> Toast.makeText(this@App, getString(R.string.import_duplicate, fileName), Toast.LENGTH_LONG).show()
                else -> onAdded(id)
            }
        }
    }

    private fun java.io.InputStream.readNBytesCapped(max: Long): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = read(buf)
            if (n < 0) return out.toByteArray()
            out.write(buf, 0, n)
            require(out.size() <= max) { "arquivo grande demais" }
        }
    }

    private suspend fun importAll(uris: List<Uri>): String = withContext(Dispatchers.IO) {
        var added = 0
        var duplicates = 0
        var failed = 0
        for (uri in uris) {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("não foi possível ler $uri")
                if (importBytes(uri.toString(), displayName(uri), bytes) == null) duplicates++ else added++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Import", "failed to import $uri", e)
                failed++
            }
        }
        listOfNotNull(
            added.takeIf { it > 0 }?.let { getString(R.string.import_added, it) },
            duplicates.takeIf { it > 0 }?.let { getString(R.string.import_duplicates, it) },
            failed.takeIf { it > 0 }?.let { getString(R.string.import_failures, it) },
        ).joinToString("\n")
    }

    /** Skips front matter (title page, copyright) so language detection sees real prose. */
    private fun languageSample(blocks: List<Block>): String {
        val paragraphs = blocks.filter { it.type == BlockType.PARAGRAPH }.ifEmpty { blocks }
        return paragraphs.drop(paragraphs.size / 10).joinToString(" ") { it.text }.take(1500)
    }

    /** Renders the first PDF page as the cover thumbnail with the platform renderer (needs a file, hence the temp copy). */
    private fun pdfCover(bytes: ByteArray): ByteArray? = runCatching {
        val tmp = File.createTempFile("cover", ".pdf", cacheDir).apply { writeBytes(bytes) }
        try {
            ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                PdfRenderer(fd).use { renderer ->
                    renderer.openPage(0).use { page ->
                        val width = 360
                        val bitmap = Bitmap.createBitmap(width, width * page.height / page.width, Bitmap.Config.ARGB_8888)
                        bitmap.eraseColor(android.graphics.Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
                    }
                }
            }
        } finally {
            tmp.delete()
        }
    }.getOrNull()

    private class PdfOcr(private val bytes: ByteArray, private val cacheDir: File) : AutoCloseable {
        private var file: File? = null
        private var fd: ParcelFileDescriptor? = null
        private var renderer: PdfRenderer? = null
        private var recognizer: TextRecognizer? = null

        fun page(index: Int): String? = runCatching {
            val r = renderer ?: run {
                val f = File.createTempFile("ocr", ".pdf", cacheDir).apply { writeBytes(bytes) }.also { file = it }
                PdfRenderer(ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY).also { fd = it }).also { renderer = it }
            }
            val reader = recognizer ?: TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).also { recognizer = it }
            r.openPage(index).use { page ->
                val width = 1600 // enough resolution for body text without exhausting memory
                val bitmap = Bitmap.createBitmap(width, width * page.height / page.width, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(android.graphics.Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                Tasks.await(reader.process(InputImage.fromBitmap(bitmap, 0))).textBlocks.joinToString("\n\n") { it.text.replace('\n', ' ') }
            }
        }.getOrNull()

        override fun close() {
            recognizer?.close()
            renderer?.close()
            fd?.close()
            file?.delete()
        }
    }

    private fun displayName(uri: Uri): String =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }
            ?: uri.lastPathSegment ?: getString(R.string.book)
}

/** SharedPreferences exposed as Compose state, so the UI recomposes when a setting changes. */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("prefs", Context.MODE_PRIVATE)

    var theme by int("theme", 0) // 0 system, 1 light, 2 dark
    var textSize by int("text_size", 1) // 0 small, 1 medium, 2 large
    var useOffline by bool("use_offline", false)
    var onboarded by bool("onboarded", false)
    var dailyGoalMinutes by int("daily_goal_minutes", 5)
    var reminder by int("reminder", ReminderTime.OFF.ordinal)
    var speechRate by float("speech_rate", 1f)
    var defaultTarget by string("default_target", Locale.getDefault().language.takeIf { TranslateLanguage.fromLanguageTag(it) != null } ?: "en")

    /** Anonymous per-install id and secret: the device account that carries the translation quota. */
    val userId: String = sp.getString("user_id", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("user_id", it).apply() }
    val deviceSecret: String = sp.getString("device_secret", null)
        ?: ByteArray(32).also(java.security.SecureRandom()::nextBytes).joinToString("") { "%02x".format(it) }.also { sp.edit().putString("device_secret", it).apply() }

    var token by nullableString("token")
    var accountEmail by nullableString("account_email")
    var accountName by nullableString("account_name")
    var lastSync by long("last_sync", 0L)

    private fun int(key: String, default: Int) = state(sp.getInt(key, default)) { sp.edit().putInt(key, it).apply() }
    private fun bool(key: String, default: Boolean) = state(sp.getBoolean(key, default)) { sp.edit().putBoolean(key, it).apply() }
    private fun float(key: String, default: Float) = state(sp.getFloat(key, default)) { sp.edit().putFloat(key, it).apply() }
    private fun string(key: String, default: String) = state(sp.getString(key, null) ?: default) { sp.edit().putString(key, it).apply() }
    private fun nullableString(key: String) = state(sp.getString(key, null)) { sp.edit().putString(key, it).apply() }
    private fun long(key: String, default: Long) = state(sp.getLong(key, default)) { sp.edit().putLong(key, it).apply() }

    private fun <T> state(initial: T, save: (T) -> Unit) = object : ReadWriteProperty<Any?, T> {
        private val s = mutableStateOf(initial)
        override fun getValue(thisRef: Any?, property: KProperty<*>) = s.value
        override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
            s.value = value
            save(value)
        }
    }
}
