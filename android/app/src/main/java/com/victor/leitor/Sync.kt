package com.victor.leitor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

// Books are identified across devices by the sha256 of their file; words by their normalized text and language pair.
data class SyncBook(
    val hash: String, val title: String, val fileType: String, val language: String?, val targetLanguage: String?,
    val lastBlock: Int, val lastOpenedAt: Long?, val completedAt: Long?, val updatedAt: Long,
)

data class SyncWord(
    val normalized: String, val original: String, val translated: String, val src: String, val tgt: String,
    val bookTitle: String?, val example: String?, val box: Int, val dueDay: Long?, val savedAt: Long, val updatedAt: Long,
) {
    val key get() = "$normalized|$src|$tgt"
}

data class SyncHighlight(
    val book: String, val block: Int, val start: Int, val end: Int, val color: Int, val note: String?, val createdAt: Long, val updatedAt: Long,
) {
    val key get() = "$book|$block|$start|$end"
}

data class SyncDay(
    val day: Long, val active: Int, val sessions: Int, val translations: Int, val words: Int, val paragraphs: Int,
    val autoParagraphs: Int, val seconds: Int, val goalMet: Int,
)

/** [deletions] maps "kind|key" to when it was deleted. */
data class Snapshot(
    val books: List<SyncBook> = emptyList(),
    val words: List<SyncWord> = emptyList(),
    val highlights: List<SyncHighlight> = emptyList(),
    val days: List<SyncDay> = emptyList(),
    val deletions: Map<String, Long> = emptyMap(),
)

/**
 * Last write wins per record, and a deletion wins over any edit older than it. Daily stats keep the larger value of each counter:
 * two devices each report their own total for the same day, and summing would count the same minutes again on every sync.
 */
fun merge(a: Snapshot, b: Snapshot): Snapshot {
    val deletions = (a.deletions.keys + b.deletions.keys).associateWith { maxOf(a.deletions[it] ?: 0, b.deletions[it] ?: 0) }
    fun <T> lww(kind: String, x: List<T>, y: List<T>, key: (T) -> String, at: (T) -> Long): List<T> =
        (x + y).groupBy(key).values.map { it.maxBy(at) }.filter { at(it) > (deletions["$kind|${key(it)}"] ?: Long.MIN_VALUE) }

    val books = lww("book", a.books, b.books, { it.hash }, { it.updatedAt })
    val bookHashes = books.mapTo(HashSet()) { it.hash }
    return Snapshot(
        books = books,
        words = lww("word", a.words, b.words, { it.key }, { it.updatedAt }),
        highlights = lww("highlight", a.highlights, b.highlights, { it.key }, { it.updatedAt }).filter { it.book in bookHashes },
        days = (a.days + b.days).groupBy { it.day }.values.map { same ->
            same.reduce { p, q ->
                SyncDay(
                    p.day, maxOf(p.active, q.active), maxOf(p.sessions, q.sessions), maxOf(p.translations, q.translations),
                    maxOf(p.words, q.words), maxOf(p.paragraphs, q.paragraphs), maxOf(p.autoParagraphs, q.autoParagraphs),
                    maxOf(p.seconds, q.seconds), maxOf(p.goalMet, q.goalMet),
                )
            }
        },
        deletions = deletions,
    )
}

private fun JSONObject.longOrNull(k: String) = if (isNull(k) || !has(k)) null else getLong(k)
private fun JSONObject.stringOrNull(k: String) = if (isNull(k) || !has(k)) null else getString(k)
private fun <T> JSONArray?.list(f: (JSONObject) -> T): List<T> = if (this == null) emptyList() else (0 until length()).map { f(getJSONObject(it)) }

fun Snapshot.toJson(): JSONObject = JSONObject()
    .put("books", JSONArray(books.map {
        JSONObject().put("hash", it.hash).put("title", it.title).put("fileType", it.fileType).put("language", it.language)
            .put("targetLanguage", it.targetLanguage).put("lastBlock", it.lastBlock).put("lastOpenedAt", it.lastOpenedAt)
            .put("completedAt", it.completedAt).put("updatedAt", it.updatedAt)
    }))
    .put("words", JSONArray(words.map {
        JSONObject().put("normalized", it.normalized).put("original", it.original).put("translated", it.translated).put("src", it.src)
            .put("tgt", it.tgt).put("bookTitle", it.bookTitle).put("example", it.example).put("box", it.box).put("dueDay", it.dueDay)
            .put("savedAt", it.savedAt).put("updatedAt", it.updatedAt)
    }))
    .put("highlights", JSONArray(highlights.map {
        JSONObject().put("book", it.book).put("block", it.block).put("start", it.start).put("end", it.end).put("color", it.color)
            .put("note", it.note).put("createdAt", it.createdAt).put("updatedAt", it.updatedAt)
    }))
    .put("days", JSONArray(days.map {
        JSONObject().put("day", it.day).put("active", it.active).put("sessions", it.sessions).put("translations", it.translations)
            .put("words", it.words).put("paragraphs", it.paragraphs).put("autoParagraphs", it.autoParagraphs).put("seconds", it.seconds)
            .put("goalMet", it.goalMet)
    }))
    .put("deletions", JSONObject(deletions))

fun snapshotFromJson(j: JSONObject) = Snapshot(
    books = j.optJSONArray("books").list {
        SyncBook(
            it.getString("hash"), it.getString("title"), it.getString("fileType"), it.stringOrNull("language"), it.stringOrNull("targetLanguage"),
            it.getInt("lastBlock"), it.longOrNull("lastOpenedAt"), it.longOrNull("completedAt"), it.getLong("updatedAt"),
        )
    },
    words = j.optJSONArray("words").list {
        SyncWord(
            it.getString("normalized"), it.getString("original"), it.getString("translated"), it.getString("src"), it.getString("tgt"),
            it.stringOrNull("bookTitle"), it.stringOrNull("example"), it.getInt("box"), it.longOrNull("dueDay"), it.getLong("savedAt"), it.getLong("updatedAt"),
        )
    },
    highlights = j.optJSONArray("highlights").list {
        SyncHighlight(
            it.getString("book"), it.getInt("block"), it.getInt("start"), it.getInt("end"), it.getInt("color"), it.stringOrNull("note"),
            it.getLong("createdAt"), it.getLong("updatedAt"),
        )
    },
    days = j.optJSONArray("days").list {
        SyncDay(
            it.getLong("day"), it.getInt("active"), it.getInt("sessions"), it.getInt("translations"), it.getInt("words"),
            it.getInt("paragraphs"), it.getInt("autoParagraphs"), it.getInt("seconds"), it.getInt("goalMet"),
        )
    },
    deletions = j.optJSONObject("deletions")?.let { d -> d.keys().asSequence().associateWith { d.getLong(it) } }.orEmpty(),
)

/**
 * Pull, merge, apply, push. Book files go up before the snapshot that mentions them, so another device never sees a book
 * it can't download; a push that lost the race to another device (409) starts the round again from a fresh pull.
 */
suspend fun App.syncNow(): String = withContext(Dispatchers.IO) {
    checkNotNull(prefs.accountEmail) { "sem conta" }
    for (attempt in 1..3) {
        val remote = backend.json("GET", "/sync/snapshot").getJSONObject("data")
        val version = remote.getInt("version")
        val merged = merge(db.exportSnapshot(), remote.optJSONObject("snapshot")?.let(::snapshotFromJson) ?: Snapshot())
        val mergedHashes = merged.books.mapTo(HashSet()) { it.hash }

        db.books().forEach { b -> if (b.contentHash != null && b.contentHash !in mergedHashes) deleteBook(b.id) }
        val local = db.books().mapNotNull { b -> b.contentHash?.let { it to b } }.toMap()
        var downloaded = 0
        for (book in merged.books) {
            if (book.hash in local) continue
            val bytes = try {
                backend.call("GET", "/sync/files/${book.hash}")
            } catch (e: ApiException) {
                if (e.status == 404) continue else throw e // its device hasn't uploaded it yet
            }
            if (importBytes("sync:${book.hash}", "${book.title}.${book.fileType}", bytes) != null) downloaded++
        }
        val ids = db.books().mapNotNull { b -> b.contentHash?.let { it to b.id } }.toMap()
        db.applySnapshot(merged, ids)

        val files = backend.json("GET", "/sync/files").getJSONObject("data").getJSONArray("files")
        val onServer = (0 until files.length()).mapTo(HashSet()) { files.getString(it) }
        var uploaded = 0
        for (b in db.books()) {
            val hash = b.contentHash ?: continue
            val file = originalFile(b.id, b.fileType)
            if (hash in onServer || !file.exists()) continue
            backend.call("PUT", "/sync/files/$hash", file.readBytes(), "application/octet-stream")
            uploaded++
        }

        try {
            backend.json("PUT", "/sync/snapshot", JSONObject().put("version", version).put("snapshot", merged.toJson()))
        } catch (e: ApiException) {
            if (e.code == "VERSION_CONFLICT") continue
            throw e
        }
        onServer.filter { it !in mergedHashes }.forEach { backend.call("DELETE", "/sync/files/$it") }
        prefs.lastSync = System.currentTimeMillis()
        db.changed()
        return@withContext listOfNotNull(
            getString(R.string.sync_done),
            downloaded.takeIf { it > 0 }?.let { getString(R.string.sync_downloaded, it) },
            uploaded.takeIf { it > 0 }?.let { getString(R.string.sync_uploaded, it) },
        ).joinToString(" ")
    }
    error("outro aparelho está sincronizando; tente de novo")
}
