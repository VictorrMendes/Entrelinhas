package com.victor.leitor

import androidx.annotation.StringRes
import java.security.MessageDigest
import java.text.Normalizer

fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Leitner boxes: "known" climbs a box and waits its interval, "repeat" drops to box 0; past the last box the word is mastered. */
object Leitner {
    val INTERVAL_DAYS = intArrayOf(1, 3, 7, 14, 30, 90)
    const val MASTERED = 7

    /** (box, due day) after an answer; the due day is null once mastered. */
    fun next(box: Int, known: Boolean, today: Long): Pair<Int, Long?> {
        if (!known) return 0 to today
        val b = box + 1
        return if (b >= MASTERED) MASTERED to null else b to today + INTERVAL_DAYS[b - 1]
    }
}

/** A blank day spends a shield, otherwise the streak restarts; every 7 days of streak a shield comes back, up to 2. */
object Streak {
    const val MAX_SHIELDS = 2
    const val SHIELD_EVERY = 7

    data class State(val current: Int, val longest: Int, val shields: Int, val metToday: Boolean)

    /** [metDays] are ascending local days. */
    fun compute(metDays: List<Long>, today: Long): State {
        var current = 0
        var longest = 0
        var shields = 0
        var last: Long? = null
        for (day in metDays) {
            if (day == last) continue
            val missed = last?.let { day - it - 1 }
            if (current > 0 && missed != null && missed <= shields) {
                current++
                shields -= missed.toInt()
            } else {
                current = 1
                shields = MAX_SHIELDS
            }
            if (current % SHIELD_EVERY == 0) shields = minOf(MAX_SHIELDS, shields + 1)
            longest = maxOf(longest, current)
            last = day
        }
        if (last == null) return State(0, 0, 0, false)
        // blank days up to yesterday already spent their shields; today isn't over yet
        val missedNow = maxOf(0L, today - last - 1)
        return if (missedNow > shields) State(0, longest, 0, false)
        else State(current, longest, shields - missedNow.toInt(), last == today)
    }
}

/** Anki-ready CSV: Anki reads the `#` header lines; spreadsheets just show them as text rows. */
fun vocabularyCsv(words: List<Word>, columns: String): String = buildString {
    append("#separator:Comma\n#html:false\n#columns:$columns\n")
    words.forEach { w ->
        append(listOf(w.original, w.translated, w.example.orEmpty(), w.bookTitle.orEmpty()).joinToString(",", transform = ::csvField)).append('\n')
    }
}

private fun csvField(s: String) = if (s.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + s.replace("\"", "\"\"") + "\"" else s

enum class ReminderTime(@StringRes val label: Int, val hour: Int?) {
    MORNING(R.string.reminder_morning, 8),
    AFTERNOON(R.string.reminder_afternoon, 13),
    EVENING(R.string.reminder_evening, 20),
    OFF(R.string.reminder_off, null),
}

enum class Mark { OK, MISSING, WRONG }

data class Marked(val text: String, val mark: Mark)

/** [score] is the share of the expected words heard right, 0 to 100. */
data class Dictation(val words: List<Marked>, val score: Int)

/**
 * Word-by-word comparison of what was heard with what was said (dictation and shadowing). Case, accents and punctuation don't
 * count; the longest common subsequence decides which words match, the rest are missing (expected) or wrong (typed).
 */
fun checkDictation(expected: String, typed: String): Dictation {
    fun key(w: String) = Normalizer.normalize(w.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}"), "").filter { it.isLetterOrDigit() }
    fun words(s: String) = s.split(Regex("\\s+")).filter { key(it).isNotEmpty() }
    val e = words(expected)
    val t = words(typed)
    val ek = e.map(::key)
    val tk = t.map(::key)
    val lcs = Array(e.size + 1) { IntArray(t.size + 1) }
    for (i in e.indices.reversed()) for (j in t.indices.reversed()) {
        lcs[i][j] = if (ek[i] == tk[j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
    }
    val out = ArrayList<Marked>()
    var i = 0
    var j = 0
    while (i < e.size || j < t.size) {
        when {
            i < e.size && j < t.size && ek[i] == tk[j] -> out += Marked(e[i++], Mark.OK).also { j++ }
            j < t.size && (i == e.size || lcs[i][j + 1] >= lcs[i + 1][j]) -> out += Marked(t[j++], Mark.WRONG)
            else -> out += Marked(e[i++], Mark.MISSING)
        }
    }
    return Dictation(out, if (e.isEmpty()) 100 else out.count { it.mark == Mark.OK } * 100 / e.size)
}

/** Lifetime numbers that XP and achievements come from. */
data class Totals(
    val readingMinutes: Int = 0,
    val savedWords: Int = 0,
    val learnedWords: Int = 0,
    val booksCompleted: Int = 0,
    val dictations: Int = 0,
    val goalDays: Int = 0,
    val longestStreak: Int = 0,
) {
    val xp get() = readingMinutes + savedWords * 5 + learnedWords * 10 + booksCompleted * 100 + dictations * 3 + goalDays * 20
}

/** Level n starts at 50·n·(n−1) XP (0, 100, 300, 600…), so each level takes a little longer than the last. */
object Levels {
    fun start(level: Int) = 50 * level * (level - 1)

    fun of(xp: Int): Int {
        var level = 1
        while (start(level + 1) <= xp) level++
        return level
    }
}

enum class Achievement(@StringRes val title: Int, @StringRes val text: Int, val target: Int, val value: (Totals) -> Int) {
    FIRST_GOAL(R.string.ach_first_goal, R.string.ach_first_goal_text, 1, { it.goalDays }),
    WEEK_STREAK(R.string.ach_week_streak, R.string.ach_week_streak_text, 7, { it.longestStreak }),
    MONTH_STREAK(R.string.ach_month_streak, R.string.ach_month_streak_text, 30, { it.longestStreak }),
    WORDS_50(R.string.ach_words_50, R.string.ach_words_50_text, 50, { it.savedWords }),
    WORDS_250(R.string.ach_words_250, R.string.ach_words_250_text, 250, { it.savedWords }),
    LEARNED_25(R.string.ach_learned_25, R.string.ach_learned_25_text, 25, { it.learnedWords }),
    FIRST_BOOK(R.string.ach_first_book, R.string.ach_first_book_text, 1, { it.booksCompleted }),
    FIVE_BOOKS(R.string.ach_five_books, R.string.ach_five_books_text, 5, { it.booksCompleted }),
    DICTATIONS_20(R.string.ach_dictations, R.string.ach_dictations_text, 20, { it.dictations }),
    TEN_HOURS(R.string.ach_ten_hours, R.string.ach_ten_hours_text, 10, { it.readingMinutes / 60 }),
    ;

    fun unlocked(t: Totals) = value(t) >= target
}
