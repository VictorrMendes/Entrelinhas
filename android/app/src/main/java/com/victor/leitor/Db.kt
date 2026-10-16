package com.victor.leitor

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

enum class Status { READY, IN_PROGRESS, COMPLETED }

data class Book(
    val id: Long,
    val title: String,
    val fileType: String,
    val language: String?,
    val targetLanguage: String?,
    val blockCount: Int,
    val lastBlock: Int,
    val lastOpenedAt: Long?,
    val completedAt: Long?,
    val contentHash: String?,
    /** CEFR level (A1–C2), estimated by AI once per book. */
    val level: String? = null,
    val shelves: List<String> = emptyList(),
) {
    val status
        get() = when {
            completedAt != null -> Status.COMPLETED
            lastOpenedAt != null -> Status.IN_PROGRESS
            else -> Status.READY
        }
    val progress
        get() = when {
            completedAt != null -> 1f
            lastOpenedAt == null || blockCount == 0 -> 0f
            else -> (lastBlock + 1f) / blockCount
        }
}

data class Word(
    val id: Long,
    val original: String,
    val translated: String,
    val bookTitle: String?,
    val example: String?,
    val box: Int,
    val dueDay: Long?,
    val source: String,
    /** The language of [translated]; empty for words saved before it was read back. */
    val target: String = "",
) {
    val learned get() = box >= Leitner.MASTERED
}

data class Highlight(val id: Long, val block: Int, val start: Int, val end: Int, val color: Int, val note: String?)

enum class Stat(val column: String, val translation: Boolean = true) {
    SESSION("reading_sessions_count", translation = false),
    WORD("translated_words_count"),
    PARAGRAPH("translated_paragraphs_count"),
    DICTATION("dictations_count", translation = false),
}

data class DayStat(
    val day: Long,
    val active: Boolean,
    val translations: Int,
    val words: Int,
    val paragraphs: Int,
    val autoParagraphs: Int,
    val readingSeconds: Int,
    val goalMet: Boolean = false,
)

/** Days since 1970-01-01 in the device's time zone (java.time needs API 26). */
fun localDay(millis: Long = System.currentTimeMillis()): Long =
    Math.floorDiv(millis + java.util.TimeZone.getDefault().getOffset(millis), 86_400_000L)

// Queries run on the caller's thread: the tables are small.
class Db(ctx: Context) : SQLiteOpenHelper(ctx, "leitor.db", null, 4) {
    /** Bumped on every write so Compose screens re-query. */
    val changes = MutableStateFlow(0)

    /** Also called after a book's files (cover, images) land on disk, since screens read those too. */
    fun changed() = changes.update { it + 1 }

    override fun onConfigure(db: SQLiteDatabase) = db.setForeignKeyConstraintsEnabled(true)

    /** Fresh installs build the v1 schema and replay the same upgrades as existing ones. */
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_uri TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                file_type TEXT NOT NULL,
                language TEXT,
                target_language TEXT,
                block_count INTEGER NOT NULL,
                last_block_index INTEGER NOT NULL DEFAULT 0,
                last_opened_at INTEGER,
                completed_at INTEGER,
                created_at INTEGER NOT NULL)""",
        )
        db.execSQL(
            """CREATE TABLE saved_words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text TEXT NOT NULL,
                original_text_normalized TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                source_language TEXT NOT NULL DEFAULT '',
                target_language TEXT NOT NULL DEFAULT '',
                book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
                book_title TEXT,
                status TEXT NOT NULL DEFAULT 'new',
                saved_at INTEGER NOT NULL,
                UNIQUE (original_text_normalized, source_language, target_language))""",
        )
        onUpgrade(db, 1, 4)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL(
                """CREATE TABLE progress_daily_stats (
                    day INTEGER PRIMARY KEY,
                    reading_active INTEGER NOT NULL DEFAULT 0,
                    reading_sessions_count INTEGER NOT NULL DEFAULT 0,
                    translations_count INTEGER NOT NULL DEFAULT 0,
                    translated_words_count INTEGER NOT NULL DEFAULT 0,
                    translated_paragraphs_count INTEGER NOT NULL DEFAULT 0,
                    auto_translated_paragraphs_count INTEGER NOT NULL DEFAULT 0)""",
            )
        }
        if (oldVersion < 3) {
            listOf(
                "ALTER TABLE books ADD COLUMN content_hash TEXT",
                "ALTER TABLE books ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE saved_words ADD COLUMN example TEXT",
                "ALTER TABLE saved_words ADD COLUMN box INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE saved_words ADD COLUMN due_day INTEGER",
                "ALTER TABLE saved_words ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
                "UPDATE saved_words SET box = ${Leitner.MASTERED} WHERE status = 'learned'",
                "UPDATE saved_words SET due_day = ${localDay()} WHERE status != 'learned'",
                "UPDATE saved_words SET updated_at = saved_at",
                "ALTER TABLE progress_daily_stats ADD COLUMN reading_seconds INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE progress_daily_stats ADD COLUMN goal_met INTEGER NOT NULL DEFAULT 0",
                "CREATE TABLE translation_cache (key TEXT PRIMARY KEY, translated TEXT NOT NULL, created_at INTEGER NOT NULL)",
                """CREATE TABLE paragraph_translations (
                    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    block_index INTEGER NOT NULL,
                    source_language TEXT NOT NULL,
                    target_language TEXT NOT NULL,
                    translated TEXT NOT NULL,
                    PRIMARY KEY (book_id, block_index, source_language, target_language))""",
                """CREATE TABLE highlights (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                    block_index INTEGER NOT NULL,
                    start_offset INTEGER NOT NULL,
                    end_offset INTEGER NOT NULL,
                    color INTEGER NOT NULL,
                    note TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL)""",
                "CREATE INDEX highlights_book_index ON highlights(book_id)",
                // tombstones so a sync doesn't resurrect what was deleted on this device
                "CREATE TABLE deletions (kind TEXT NOT NULL, key TEXT NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY (kind, key))",
            ).forEach(db::execSQL)
        }
        if (oldVersion < 4) {
            listOf(
                "ALTER TABLE books ADD COLUMN level TEXT",
                "ALTER TABLE books ADD COLUMN shelves TEXT NOT NULL DEFAULT ''",
                "ALTER TABLE progress_daily_stats ADD COLUMN dictations_count INTEGER NOT NULL DEFAULT 0",
            ).forEach(db::execSQL)
        }
    }

    private fun Cursor.longOrNull(i: Int) = if (isNull(i)) null else getLong(i)

    private fun tombstone(kind: String, key: String) {
        writableDatabase.insertWithOnConflict("deletions", null, ContentValues().apply {
            put("kind", kind)
            put("key", key)
            put("deleted_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    private fun ensureToday(): Long = localDay().also {
        writableDatabase.execSQL("INSERT OR IGNORE INTO progress_daily_stats (day) VALUES (?)", arrayOf<Any>(it))
    }

    /** Marks today as a reading day and adds [n] to the stat (translations also count toward the total). */
    fun record(stat: Stat, n: Int = 1) {
        val day = ensureToday()
        writableDatabase.execSQL(
            "UPDATE progress_daily_stats SET reading_active = 1, ${stat.column} = ${stat.column} + ?, " +
                "translations_count = translations_count + ? WHERE day = ?",
            arrayOf<Any>(n, if (stat.translation) n else 0, day),
        )
        changed()
    }

    /** True exactly when this call makes today reach the goal; a met day stays met even if the goal is raised later. */
    fun addReadingSeconds(seconds: Int, goalSeconds: Int): Boolean {
        val day = ensureToday()
        val db = writableDatabase
        db.execSQL("UPDATE progress_daily_stats SET reading_active = 1, reading_seconds = reading_seconds + ? WHERE day = ?", arrayOf<Any>(seconds, day))
        val justMet = DatabaseUtils.longForQuery(
            db, "SELECT goal_met = 0 AND reading_seconds >= ? FROM progress_daily_stats WHERE day = ?", arrayOf("$goalSeconds", "$day"),
        ) == 1L
        if (justMet) db.execSQL("UPDATE progress_daily_stats SET goal_met = 1 WHERE day = ?", arrayOf<Any>(day))
        changed()
        return justMet
    }

    fun todayReadingSeconds(): Int =
        DatabaseUtils.longForQuery(readableDatabase, "SELECT COALESCE(SUM(reading_seconds), 0) FROM progress_daily_stats WHERE day = ?", arrayOf("${localDay()}")).toInt()

    fun streak(): Streak.State {
        val met = readableDatabase.rawQuery("SELECT day FROM progress_daily_stats WHERE goal_met = 1 ORDER BY day", null)
            .use { c -> buildList { while (c.moveToNext()) add(c.getLong(0)) } }
        return Streak.compute(met, localDay())
    }

    fun dayStats(fromDay: Long): List<DayStat> = readableDatabase.rawQuery(
        "SELECT day, reading_active, translations_count, translated_words_count, translated_paragraphs_count, " +
            "auto_translated_paragraphs_count, reading_seconds, goal_met FROM progress_daily_stats WHERE day >= ? ORDER BY day",
        arrayOf("$fromDay"),
    ).use { c ->
        buildList { while (c.moveToNext()) add(DayStat(c.getLong(0), c.getInt(1) == 1, c.getInt(2), c.getInt(3), c.getInt(4), c.getInt(5), c.getInt(6), c.getInt(7) == 1)) }
    }

    /** Days with any reading, oldest first; the weekly streak counts on them. */
    fun activeDays(): List<Long> = query("SELECT day FROM progress_daily_stats WHERE reading_active = 1 ORDER BY day") { getLong(0) }

    private val bookCols = "id, title, file_type, language, target_language, block_count, last_block_index, last_opened_at, completed_at, content_hash, level, shelves"

    private fun Cursor.toBook() =
        Book(
            getLong(0), getString(1), getString(2), getString(3), getString(4), getInt(5), getInt(6), longOrNull(7), longOrNull(8), getString(9),
            getString(10), getString(11).split('\n').filter { it.isNotEmpty() },
        )

    fun books(): List<Book> =
        readableDatabase.rawQuery("SELECT $bookCols FROM books ORDER BY COALESCE(last_opened_at, created_at) DESC", null)
            .use { c -> buildList { while (c.moveToNext()) add(c.toBook()) } }

    fun book(id: Long): Book? =
        readableDatabase.rawQuery("SELECT $bookCols FROM books WHERE id = ?", arrayOf("$id")).use { if (it.moveToFirst()) it.toBook() else null }

    /** Duplicate check by source URI or by content, so the same file picked from two places isn't imported twice. */
    fun hasBook(uri: String, contentHash: String? = null) =
        DatabaseUtils.queryNumEntries(readableDatabase, "books", "source_uri = ? OR content_hash = ?", arrayOf(uri, contentHash ?: "-")) > 0

    fun insertBook(uri: String, title: String, fileType: String, language: String?, blockCount: Int, contentHash: String?): Long {
        val now = System.currentTimeMillis()
        return writableDatabase.insertOrThrow("books", null, ContentValues().apply {
            put("source_uri", uri)
            put("title", title)
            put("file_type", fileType)
            put("language", language)
            put("block_count", blockCount)
            put("content_hash", contentHash)
            put("created_at", now)
            put("updated_at", now)
        }).also { changed() }
    }

    fun deleteBook(id: Long) {
        book(id)?.contentHash?.let { tombstone("book", it) }
        writableDatabase.delete("books", "id = ?", arrayOf("$id"))
        changed()
    }

    fun deleteAllBooks() {
        books().forEach { b -> b.contentHash?.let { tombstone("book", it) } }
        writableDatabase.delete("books", null, null)
        changed()
    }

    fun saveProgress(id: Long, firstVisible: Int, reachedEnd: Boolean) {
        val now = System.currentTimeMillis()
        writableDatabase.execSQL(
            "UPDATE books SET last_block_index = ?, last_opened_at = ?, updated_at = ?, " +
                "completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE id = ?",
            arrayOf<Any>(firstVisible, now, now, if (reachedEnd) 1 else 0, now, id),
        )
        changed()
    }

    fun setLanguages(id: Long, source: String, target: String) {
        writableDatabase.update("books", ContentValues().apply {
            put("language", source)
            put("target_language", target)
            put("updated_at", System.currentTimeMillis())
        }, "id = ?", arrayOf("$id"))
        changed()
    }

    fun setShelves(id: Long, shelves: List<String>) {
        writableDatabase.update("books", ContentValues().apply {
            put("shelves", shelves.joinToString("\n"))
            put("updated_at", System.currentTimeMillis())
        }, "id = ?", arrayOf("$id"))
        changed()
    }

    /** Not synced: a level never changes, and each device asks for it once. */
    fun setLevel(id: Long, level: String) {
        writableDatabase.update("books", ContentValues().apply { put("level", level) }, "id = ?", arrayOf("$id"))
        changed()
    }

    fun totals(): Totals {
        fun n(sql: String) = DatabaseUtils.longForQuery(readableDatabase, sql, null).toInt()
        return Totals(
            readingMinutes = n("SELECT COALESCE(SUM(reading_seconds), 0) / 60 FROM progress_daily_stats"),
            savedWords = n("SELECT COUNT(*) FROM saved_words"),
            learnedWords = n("SELECT COUNT(*) FROM saved_words WHERE box >= ${Leitner.MASTERED}"),
            booksCompleted = n("SELECT COUNT(*) FROM books WHERE completed_at IS NOT NULL"),
            dictations = n("SELECT COALESCE(SUM(dictations_count), 0) FROM progress_daily_stats"),
            goalDays = n("SELECT COUNT(*) FROM progress_daily_stats WHERE goal_met = 1"),
            longestStreak = streak().longest,
            longestWeeks = WeekStreak.compute(activeDays(), localDay(), firstDayOfWeek()).longest,
        )
    }

    fun cachedTranslation(key: String): String? =
        readableDatabase.rawQuery("SELECT translated FROM translation_cache WHERE key = ?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) else null }

    fun cacheTranslation(key: String, translated: String) {
        writableDatabase.insertWithOnConflict("translation_cache", null, ContentValues().apply {
            put("key", key)
            put("translated", translated)
            put("created_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun paragraphTranslations(bookId: Long, source: String, target: String): Map<Int, String> = readableDatabase.rawQuery(
        "SELECT block_index, translated FROM paragraph_translations WHERE book_id = ? AND source_language = ? AND target_language = ?",
        arrayOf("$bookId", source, target),
    ).use { c -> buildMap { while (c.moveToNext()) put(c.getInt(0), c.getString(1)) } }

    fun saveParagraphTranslation(bookId: Long, block: Int, source: String, target: String, translated: String) {
        writableDatabase.insertWithOnConflict("paragraph_translations", null, ContentValues().apply {
            put("book_id", bookId)
            put("block_index", block)
            put("source_language", source)
            put("target_language", target)
            put("translated", translated)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    /** The reader hid this paragraph's translation: it no longer comes back when the book opens. */
    fun deleteParagraphTranslation(bookId: Long, block: Int, source: String, target: String) {
        writableDatabase.delete(
            "paragraph_translations", "book_id = ? AND block_index = ? AND source_language = ? AND target_language = ?",
            arrayOf("$bookId", "$block", source, target),
        )
    }

    private val wordCols = "id, original_text, translated_text, book_title, example, box, due_day, source_language, target_language"

    private fun Cursor.toWord() = Word(getLong(0), getString(1), getString(2), getString(3), getString(4), getInt(5), longOrNull(6), getString(7), getString(8))

    /** Saves a word due for review today; saving it again refreshes the translation and example but keeps its box. */
    fun saveWord(original: String, translated: String, source: String, target: String, bookId: Long, bookTitle: String, example: String?) {
        val now = System.currentTimeMillis()
        val normalized = original.trim().lowercase()
        val db = writableDatabase
        db.insertWithOnConflict("saved_words", null, ContentValues().apply {
            put("original_text", original)
            put("original_text_normalized", normalized)
            put("translated_text", translated)
            put("source_language", source)
            put("target_language", target)
            put("book_id", bookId)
            put("book_title", bookTitle)
            put("example", example)
            put("box", 0)
            put("due_day", localDay())
            put("saved_at", now)
            put("updated_at", now)
        }, SQLiteDatabase.CONFLICT_IGNORE)
        db.update("saved_words", ContentValues().apply {
            put("translated_text", translated)
            if (example != null) put("example", example)
            put("updated_at", now)
        }, "original_text_normalized = ? AND source_language = ? AND target_language = ?", arrayOf(normalized, source, target))
        db.delete("deletions", "kind = 'word' AND key = ?", arrayOf("$normalized|$source|$target"))
        changed()
    }

    fun words(): List<Word> =
        readableDatabase.rawQuery("SELECT $wordCols FROM saved_words ORDER BY saved_at DESC", null)
            .use { c -> buildList { while (c.moveToNext()) add(c.toWord()) } }

    /** Today's review queue: due words, oldest-answered first, so a "repeat" goes to the back. */
    fun dueWords(): List<Word> = readableDatabase.rawQuery(
        "SELECT $wordCols FROM saved_words WHERE box < ? AND due_day <= ? ORDER BY due_day, updated_at",
        arrayOf("${Leitner.MASTERED}", "${localDay()}"),
    ).use { c -> buildList { while (c.moveToNext()) add(c.toWord()) } }

    fun answer(word: Word, known: Boolean) {
        val (box, due) = Leitner.next(word.box, known, localDay())
        setBox(word.id, box, due)
    }

    fun setLearned(id: Long, learned: Boolean) = if (learned) setBox(id, Leitner.MASTERED, null) else setBox(id, 0, localDay())

    private fun setBox(id: Long, box: Int, due: Long?) {
        writableDatabase.update("saved_words", ContentValues().apply {
            put("box", box)
            if (due == null) putNull("due_day") else put("due_day", due)
            put("status", if (box >= Leitner.MASTERED) "learned" else "new")
            put("updated_at", System.currentTimeMillis())
        }, "id = ?", arrayOf("$id"))
        changed()
    }

    fun deleteWord(id: Long) {
        readableDatabase.rawQuery("SELECT original_text_normalized, source_language, target_language FROM saved_words WHERE id = ?", arrayOf("$id"))
            .use { if (it.moveToFirst()) tombstone("word", "${it.getString(0)}|${it.getString(1)}|${it.getString(2)}") }
        writableDatabase.delete("saved_words", "id = ?", arrayOf("$id"))
        changed()
    }

    fun highlights(bookId: Long): List<Highlight> = readableDatabase.rawQuery(
        "SELECT id, block_index, start_offset, end_offset, color, note FROM highlights WHERE book_id = ? ORDER BY block_index, start_offset",
        arrayOf("$bookId"),
    ).use { c -> buildList { while (c.moveToNext()) add(Highlight(c.getLong(0), c.getInt(1), c.getInt(2), c.getInt(3), c.getInt(4), c.getString(5))) } }

    fun addHighlight(bookId: Long, block: Int, start: Int, end: Int, color: Int, note: String?): Long {
        val now = System.currentTimeMillis()
        return writableDatabase.insertOrThrow("highlights", null, ContentValues().apply {
            put("book_id", bookId)
            put("block_index", block)
            put("start_offset", start)
            put("end_offset", end)
            put("color", color)
            put("note", note)
            put("created_at", now)
            put("updated_at", now)
        }).also { changed() }
    }

    fun updateHighlight(id: Long, color: Int, note: String?) {
        writableDatabase.update("highlights", ContentValues().apply {
            put("color", color)
            put("note", note)
            put("updated_at", System.currentTimeMillis())
        }, "id = ?", arrayOf("$id"))
        changed()
    }

    fun deleteHighlight(bookId: Long, h: Highlight) {
        book(bookId)?.contentHash?.let { tombstone("highlight", "$it|${h.block}|${h.start}|${h.end}") }
        writableDatabase.delete("highlights", "id = ?", arrayOf("${h.id}"))
        changed()
    }

    private fun <T> query(sql: String, vararg args: String, row: Cursor.() -> T): List<T> =
        readableDatabase.rawQuery(sql, args).use { c -> buildList { while (c.moveToNext()) add(c.row()) } }

    /** Books imported before content hashes existed have no identity across devices, so they stay local. */
    fun exportSnapshot() = Snapshot(
        books = query(
            "SELECT content_hash, title, file_type, language, target_language, last_block_index, last_opened_at, completed_at, updated_at, shelves " +
                "FROM books WHERE content_hash IS NOT NULL",
        ) { SyncBook(getString(0), getString(1), getString(2), getString(3), getString(4), getInt(5), longOrNull(6), longOrNull(7), getLong(8), getString(9)) },
        words = query(
            "SELECT original_text_normalized, original_text, translated_text, source_language, target_language, book_title, example, box, " +
                "due_day, saved_at, updated_at FROM saved_words",
        ) { SyncWord(getString(0), getString(1), getString(2), getString(3), getString(4), getString(5), getString(6), getInt(7), longOrNull(8), getLong(9), getLong(10)) },
        highlights = query(
            "SELECT b.content_hash, h.block_index, h.start_offset, h.end_offset, h.color, h.note, h.created_at, h.updated_at " +
                "FROM highlights h JOIN books b ON b.id = h.book_id WHERE b.content_hash IS NOT NULL",
        ) { SyncHighlight(getString(0), getInt(1), getInt(2), getInt(3), getInt(4), getString(5), getLong(6), getLong(7)) },
        days = query(
            "SELECT day, reading_active, reading_sessions_count, translations_count, translated_words_count, translated_paragraphs_count, " +
                "auto_translated_paragraphs_count, reading_seconds, goal_met, dictations_count FROM progress_daily_stats",
        ) { SyncDay(getLong(0), getInt(1), getInt(2), getInt(3), getInt(4), getInt(5), getInt(6), getInt(7), getInt(8), getInt(9)) },
        deletions = query("SELECT kind, key, deleted_at FROM deletions") { "${getString(0)}|${getString(1)}" to getLong(2) }.toMap(),
    )

    /** The merge already picked the newest version of each record, so values are written as they are. */
    fun applySnapshot(s: Snapshot, bookIds: Map<String, Long>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (b in s.books) {
                val id = bookIds[b.hash] ?: continue
                db.update("books", ContentValues().apply {
                    put("language", b.language)
                    put("target_language", b.targetLanguage)
                    put("last_block_index", b.lastBlock)
                    put("last_opened_at", b.lastOpenedAt)
                    put("completed_at", b.completedAt)
                    put("shelves", b.shelves)
                    put("updated_at", b.updatedAt)
                }, "id = ?", arrayOf("$id"))
            }
            for (w in s.words) {
                val values = ContentValues().apply {
                    put("original_text", w.original)
                    put("original_text_normalized", w.normalized)
                    put("translated_text", w.translated)
                    put("source_language", w.src)
                    put("target_language", w.tgt)
                    put("book_title", w.bookTitle)
                    put("example", w.example)
                    put("box", w.box)
                    put("due_day", w.dueDay)
                    put("status", if (w.box >= Leitner.MASTERED) "learned" else "new")
                    put("saved_at", w.savedAt)
                    put("updated_at", w.updatedAt)
                }
                val where = arrayOf(w.normalized, w.src, w.tgt)
                if (db.update("saved_words", values, "original_text_normalized = ? AND source_language = ? AND target_language = ?", where) == 0) {
                    db.insert("saved_words", null, values)
                }
            }
            for (h in s.highlights) {
                val bookId = bookIds[h.book] ?: continue
                val values = ContentValues().apply {
                    put("book_id", bookId)
                    put("block_index", h.block)
                    put("start_offset", h.start)
                    put("end_offset", h.end)
                    put("color", h.color)
                    put("note", h.note)
                    put("created_at", h.createdAt)
                    put("updated_at", h.updatedAt)
                }
                val where = arrayOf("$bookId", "${h.block}", "${h.start}", "${h.end}")
                if (db.update("highlights", values, "book_id = ? AND block_index = ? AND start_offset = ? AND end_offset = ?", where) == 0) {
                    db.insert("highlights", null, values)
                }
            }
            for (d in s.days) {
                db.execSQL("INSERT OR IGNORE INTO progress_daily_stats (day) VALUES (?)", arrayOf<Any>(d.day))
                db.execSQL(
                    "UPDATE progress_daily_stats SET reading_active = MAX(reading_active, ?), reading_sessions_count = MAX(reading_sessions_count, ?), " +
                        "translations_count = MAX(translations_count, ?), translated_words_count = MAX(translated_words_count, ?), " +
                        "translated_paragraphs_count = MAX(translated_paragraphs_count, ?), auto_translated_paragraphs_count = MAX(auto_translated_paragraphs_count, ?), " +
                        "reading_seconds = MAX(reading_seconds, ?), goal_met = MAX(goal_met, ?), dictations_count = MAX(dictations_count, ?) WHERE day = ?",
                    arrayOf<Any>(d.active, d.sessions, d.translations, d.words, d.paragraphs, d.autoParagraphs, d.seconds, d.goalMet, d.dictations, d.day),
                )
            }
            for ((kindKey, at) in s.deletions) {
                val kind = kindKey.substringBefore('|')
                val key = kindKey.substringAfter('|')
                db.execSQL("INSERT OR REPLACE INTO deletions (kind, key, deleted_at) VALUES (?, ?, MAX(?, COALESCE((SELECT deleted_at FROM deletions WHERE kind = ? AND key = ?), 0)))", arrayOf<Any>(kind, key, at, kind, key))
                // the records a deletion removes; books are removed by the caller, together with their files
                val parts = key.split('|')
                when {
                    kind == "word" && parts.size == 3 -> db.delete(
                        "saved_words", "original_text_normalized = ? AND source_language = ? AND target_language = ? AND updated_at <= ?",
                        arrayOf(parts[0], parts[1], parts[2], "$at"),
                    )
                    kind == "highlight" && parts.size == 4 -> bookIds[parts[0]]?.let { bookId ->
                        db.delete(
                            "highlights", "book_id = ? AND block_index = ? AND start_offset = ? AND end_offset = ? AND updated_at <= ?",
                            arrayOf("$bookId", parts[1], parts[2], parts[3], "$at"),
                        )
                    }
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        changed()
    }
}
