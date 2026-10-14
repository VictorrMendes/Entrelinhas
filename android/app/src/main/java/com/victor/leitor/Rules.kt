package com.victor.leitor

import androidx.annotation.StringRes
import java.security.MessageDigest

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
