package com.victor.leitor

import androidx.annotation.StringRes
import java.security.MessageDigest
import java.text.Normalizer
import kotlin.random.Random

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
    val longestWeeks: Int = 0,
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

enum class AchievementGroup(@StringRes val title: Int) {
    STREAKS(R.string.ach_group_streaks),
    VOCABULARY(R.string.ach_group_vocabulary),
    READING(R.string.ach_group_reading),
}

enum class Achievement(@StringRes val title: Int, @StringRes val text: Int, val target: Int, val group: AchievementGroup, val value: (Totals) -> Int) {
    FIRST_GOAL(R.string.ach_first_goal, R.string.ach_first_goal_text, 1, AchievementGroup.STREAKS, { it.goalDays }),
    STREAK_3(R.string.ach_streak_3, R.string.ach_streak_3_text, 3, AchievementGroup.STREAKS, { it.longestStreak }),
    WEEK_STREAK(R.string.ach_week_streak, R.string.ach_week_streak_text, 7, AchievementGroup.STREAKS, { it.longestStreak }),
    MONTH_STREAK(R.string.ach_month_streak, R.string.ach_month_streak_text, 30, AchievementGroup.STREAKS, { it.longestStreak }),
    STREAK_100(R.string.ach_streak_100, R.string.ach_streak_100_text, 100, AchievementGroup.STREAKS, { it.longestStreak }),
    WEEKS_4(R.string.ach_weeks_4, R.string.ach_weeks_4_text, 4, AchievementGroup.STREAKS, { it.longestWeeks }),
    WEEKS_12(R.string.ach_weeks_12, R.string.ach_weeks_12_text, 12, AchievementGroup.STREAKS, { it.longestWeeks }),
    WORDS_50(R.string.ach_words_50, R.string.ach_words_50_text, 50, AchievementGroup.VOCABULARY, { it.savedWords }),
    WORDS_250(R.string.ach_words_250, R.string.ach_words_250_text, 250, AchievementGroup.VOCABULARY, { it.savedWords }),
    LEARNED_25(R.string.ach_learned_25, R.string.ach_learned_25_text, 25, AchievementGroup.VOCABULARY, { it.learnedWords }),
    LEARNED_100(R.string.ach_learned_100, R.string.ach_learned_100_text, 100, AchievementGroup.VOCABULARY, { it.learnedWords }),
    DICTATIONS_20(R.string.ach_dictations, R.string.ach_dictations_text, 20, AchievementGroup.VOCABULARY, { it.dictations }),
    FIRST_BOOK(R.string.ach_first_book, R.string.ach_first_book_text, 1, AchievementGroup.READING, { it.booksCompleted }),
    FIVE_BOOKS(R.string.ach_five_books, R.string.ach_five_books_text, 5, AchievementGroup.READING, { it.booksCompleted }),
    TEN_HOURS(R.string.ach_ten_hours, R.string.ach_ten_hours_text, 10, AchievementGroup.READING, { it.readingMinutes / 60 }),
    FIFTY_HOURS(R.string.ach_fifty_hours, R.string.ach_fifty_hours_text, 50, AchievementGroup.READING, { it.readingMinutes / 60 }),
    ;

    fun unlocked(t: Totals) = value(t) >= target
}

enum class PracticeStage { CHOICE, WRITTEN }

/** CHOICE: pick the meaning of [word] among [options]. WRITTEN: type the word itself from its meaning. */
data class PracticeQuestion(val word: Word, val stage: PracticeStage, val options: List<String> = emptyList())

/** Up to [n] words for a round: due today first, then the least known, then the rest. */
fun practiceWords(all: List<Word>, due: List<Word>, n: Int = 8, random: Random = Random.Default): List<Word> =
    (due.shuffled(random) + all.filter { !it.learned }.sortedBy { it.box } + all.filter { it.learned }.shuffled(random))
        .distinctBy { it.id }.take(n).shuffled(random)

/** The meaning of [word] among three others from the same language, or nothing when the vocabulary is too small for that. */
fun practiceChoices(word: Word, pool: List<Word>, random: Random = Random.Default): List<String> {
    val right = word.translated.trim()
    val wrong = pool.filter { it.id != word.id && it.source == word.source }
        .map { it.translated.trim() }
        .filter { it.isNotEmpty() && !it.equals(right, ignoreCase = true) }
        .distinctBy { it.lowercase() }
        .shuffled(random).take(3)
    return if (wrong.size < 3) emptyList() else (wrong + right).shuffled(random)
}

/**
 * A typed answer is right despite case, accents, punctuation, text in parentheses and one typo (two in long words);
 * any of the alternatives in "ojeada, vistazo" counts.
 */
fun closeEnough(expected: String, typed: String): Boolean {
    fun key(s: String) = Normalizer.normalize(s.replace(Regex("\\([^)]*\\)"), " ").lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}"), "").replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()
    val answer = key(typed)
    if (answer.isEmpty()) return false
    return expected.split(',', ';', '/').map(::key).filter { it.isNotEmpty() }.any { e ->
        val allowed = when {
            e.length >= 9 -> 2
            e.length >= 4 -> 1
            else -> 0
        }
        e == answer || editDistance(e, answer) <= allowed
    }
}

private fun editDistance(a: String, b: String): Int {
    var prev = IntArray(b.length + 1) { it }
    for (i in a.indices) {
        val cur = IntArray(b.length + 1).also { it[0] = i + 1 }
        for (j in b.indices) cur[j + 1] = minOf(prev[j + 1] + 1, cur[j] + 1, prev[j] + if (a[i] == b[j]) 0 else 1)
        prev = cur
    }
    return prev[b.length]
}

/**
 * A practice round: every word is first recognized (multiple choice), later recalled (written). A miss sends the question
 * to the back of the queue and marks the word, so it goes back to the review queue when the round ends.
 */
class PracticeRound(words: List<Word>, pool: List<Word>, random: Random = Random.Default) {
    private val queue = ArrayDeque<PracticeQuestion>()
    val missed = LinkedHashSet<Long>()
    val words = words.toList()
    var done = 0
        private set
    val total: Int

    init {
        for (w in words) {
            val options = practiceChoices(w, pool, random)
            queue += if (options.isEmpty()) PracticeQuestion(w, PracticeStage.WRITTEN) else PracticeQuestion(w, PracticeStage.CHOICE, options)
        }
        total = queue.sumOf { if (it.stage == PracticeStage.CHOICE) 2 else 1 }
    }

    val current get() = queue.firstOrNull()
    val finished get() = queue.isEmpty()

    fun answer(correct: Boolean) {
        val q = queue.removeFirst()
        if (!correct) {
            missed += q.word.id
            queue.addLast(q)
            return
        }
        done++
        // recall comes after the other words, so it isn't answered from short-term memory
        if (q.stage == PracticeStage.CHOICE) queue.addLast(PracticeQuestion(q.word, PracticeStage.WRITTEN))
    }
}

enum class TestKind { CHOICE, WRITTEN, TRUE_FALSE }

/** A test question about [word]. TRUE_FALSE asks whether [shown] is its meaning. Answers are text; true/false ones "true" or "false". */
data class TestQuestion(val word: Word, val kind: TestKind, val options: List<String> = emptyList(), val shown: String = "") {
    fun isRight(answer: String): Boolean = when (kind) {
        TestKind.CHOICE -> answer.trim() == word.translated.trim()
        TestKind.WRITTEN -> closeEnough(word.original, answer)
        TestKind.TRUE_FALSE -> answer == (shown == word.translated.trim()).toString()
    }
}

/**
 * [count] questions over [words], taking turns through [kinds]. Choice and true/false need three other meanings in the same
 * language; without them a question is written.
 */
fun buildTest(words: List<Word>, pool: List<Word>, count: Int, kinds: Set<TestKind>, random: Random = Random.Default): List<TestQuestion> {
    val order = TestKind.entries.filter { it in kinds }.ifEmpty { listOf(TestKind.WRITTEN) }
    return words.shuffled(random).take(count).mapIndexed { i, w ->
        val options = practiceChoices(w, pool, random)
        val kind = order[i % order.size].takeIf { it == TestKind.WRITTEN || options.isNotEmpty() } ?: TestKind.WRITTEN
        when (kind) {
            TestKind.CHOICE -> TestQuestion(w, kind, options)
            TestKind.WRITTEN -> TestQuestion(w, kind)
            // half the time the meaning shown is someone else's
            TestKind.TRUE_FALSE -> TestQuestion(w, kind, shown = if (random.nextBoolean()) w.translated.trim() else options.first { it != w.translated.trim() })
        }
    }
}

/** A Combinar tile: a word or a meaning; the two tiles with the same [pair] go together. */
data class MatchTile(val pair: Long, val text: String)

/** Up to [pairs] words and their meanings, shuffled. Twin words or meanings would make two right answers, so one of each stays out. */
fun matchTiles(words: List<Word>, pairs: Int = 6, random: Random = Random.Default): List<MatchTile> =
    words.shuffled(random)
        .distinctBy { it.original.trim().lowercase() }
        .distinctBy { it.translated.trim().lowercase() }
        .take(pairs)
        .flatMap { listOf(MatchTile(it.id, it.original.trim()), MatchTile(it.id, it.translated.trim())) }
        .shuffled(random)

/**
 * Weeks in a row with at least one reading day. Gentler than the daily streak: a week isn't lost until it ends, so the
 * current week only adds to the count once it has a reading day.
 */
object WeekStreak {
    data class State(val current: Int, val longest: Int, val thisWeek: Boolean)

    /** [firstDow]: 0 Sunday … 6 Saturday. 1970-01-01, epoch day 0, was a Thursday. */
    fun week(day: Long, firstDow: Int): Long = Math.floorDiv(day + 4 - firstDow, 7L)

    fun compute(days: List<Long>, today: Long, firstDow: Int): State {
        val weeks = days.mapTo(sortedSetOf()) { week(it, firstDow) }
        var longest = 0
        var run = 0
        var previous: Long? = null
        for (w in weeks) {
            run = if (previous != null && w == previous + 1) run + 1 else 1
            longest = maxOf(longest, run)
            previous = w
        }
        val now = week(today, firstDow)
        val thisWeek = now in weeks
        var current = 0
        var w = if (thisWeek) now else now - 1
        while (w in weeks) {
            current++
            w--
        }
        return State(current, longest, thisWeek)
    }
}

/** A month as calendar cells: blanks up to its first weekday, then every day (epoch days). [firstDow]: 0 Sunday … 6 Saturday. */
fun monthCells(firstDay: Long, length: Int, firstDow: Int): List<Long?> {
    val weekday = Math.floorMod(firstDay + 4, 7L).toInt()
    return List(Math.floorMod(weekday - firstDow, 7)) { null } + (0 until length).map { firstDay + it }
}

/** The device's first day of the week: 0 Sunday … 6 Saturday. */
fun firstDayOfWeek(): Int = java.util.Calendar.getInstance().firstDayOfWeek - 1

/** One word for the whole [day], a different one the next day; mastered words only when nothing else is left. */
fun wordOfDay(words: List<Word>, day: Long): Word? {
    val pool = words.filter { !it.learned }.ifEmpty { words }.sortedBy { it.id }
    return pool.getOrNull(Math.floorMod(day, pool.size.coerceAtLeast(1).toLong()).toInt())
}

