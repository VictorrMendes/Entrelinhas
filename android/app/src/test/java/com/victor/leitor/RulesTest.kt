package com.victor.leitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RulesTest {
    @Test
    fun leitnerClimbsBoxesAndResets() {
        assertEquals(1 to 11L, Leitner.next(0, known = true, today = 10))
        assertEquals(2 to 13L, Leitner.next(1, known = true, today = 10))
        assertEquals(6 to 100L, Leitner.next(5, known = true, today = 10))
        assertEquals(Leitner.MASTERED to null, Leitner.next(6, known = true, today = 10))
        assertEquals(0 to 10L, Leitner.next(4, known = false, today = 10))
    }

    @Test
    fun streakCountsConsecutiveDays() {
        assertEquals(Streak.State(3, 3, 2, true), Streak.compute(listOf(8, 9, 10), today = 10))
        // today not read yet: the streak is still alive
        assertEquals(Streak.State(3, 3, 2, false), Streak.compute(listOf(8, 9, 10), today = 11))
    }

    @Test
    fun blankDaysSpendShieldsThenBreak() {
        // day 11 blank -> one shield spent, streak continues on day 12
        assertEquals(Streak.State(4, 4, 1, true), Streak.compute(listOf(8, 9, 10, 12), today = 12))
        // three blank days > two shields -> restart, and the 3 lost days can be earned back
        assertEquals(Streak.State(1, 3, 2, true, Streak.Recovery(3, 1)), Streak.compute(listOf(8, 9, 10, 14), today = 14))
        // nothing since day 10 and two whole days missed (11, 12): shields cover it
        assertEquals(Streak.State(3, 3, 0, false), Streak.compute(listOf(8, 9, 10), today = 13))
        // three whole days missed: broken
        assertEquals(Streak.State(0, 3, 0, false, Streak.Recovery(3, 0)), Streak.compute(listOf(8, 9, 10), today = 14))
    }

    @Test
    fun dictationIgnoresCaseAccentsAndPunctuation() {
        val perfect = checkDictation("Olá, mundo! Tudo bem?", "ola mundo tudo bem")
        assertEquals(100, perfect.score)
        assertEquals(listOf(Mark.OK, Mark.OK, Mark.OK, Mark.OK), perfect.words.map { it.mark })
    }

    @Test
    fun dictationMarksWrongAndMissingWords() {
        val r = checkDictation("The cold wind blew hard", "the cold went blew")
        assertEquals(
            listOf(
                Marked("The", Mark.OK), Marked("cold", Mark.OK), Marked("went", Mark.WRONG), Marked("wind", Mark.MISSING),
                Marked("blew", Mark.OK), Marked("hard", Mark.MISSING),
            ),
            r.words,
        )
        assertEquals(60, r.score)
        assertEquals(0, checkDictation("Some words here", "").score)
    }

    // the same cases as rules.test.ts, so the two apps grade alike
    @Test
    fun speakingAWordIsRightAlmostOrWrong() {
        assertEquals(Spoken(SpeakGrade.RIGHT, "sheep"), speakGrade("sheep", listOf("sheep")))
        assertEquals(Spoken(SpeakGrade.RIGHT, "Cafe!"), speakGrade("café", listOf("Cafe!")))
        assertEquals(Spoken(SpeakGrade.RIGHT, "think"), speakGrade("think", listOf("sink", "think")))
        assertEquals(Spoken(SpeakGrade.ALMOST, "thing"), speakGrade("think", listOf("thing")))
        // two letters off in a five-letter word is too far for closeEnough: the vowel itself was wrong
        assertEquals(Spoken(SpeakGrade.WRONG, "ship"), speakGrade("sheep", listOf("ship", "chip")))
        assertEquals(Spoken(SpeakGrade.WRONG, ""), speakGrade("sheep", emptyList()))
        assertEquals(Spoken(SpeakGrade.WRONG, ""), speakGrade("sheep", listOf("", " ")))
    }

    @Test
    fun speakingAnExpressionCountsItsWords() {
        assertEquals(Spoken(SpeakGrade.RIGHT, "Look up!"), speakGrade("look up", listOf("Look up!")))
        assertEquals(Spoken(SpeakGrade.ALMOST, "give up"), speakGrade("give up on", listOf("give up")))
        assertEquals(Spoken(SpeakGrade.WRONG, "look"), speakGrade("look up to", listOf("book", "look")))
    }

    @Test
    fun vocabularyCsvQuotesWhenNeeded() {
        val w = Word(1, "bright", "claro", "The \"Quiet\" Library", "A bright, cold day.", 0, 10, "en")
        val csv = vocabularyCsv(listOf(w), "Palavra,Tradução,Exemplo,Livro")
        assertEquals("bright,claro,\"A bright, cold day.\",\"The \"\"Quiet\"\" Library\"", csv.lines()[3])
    }

    @Test
    fun shieldComesBackEverySevenDays() {
        // day 3 blank spends one shield; reaching 7 streak days returns it
        val days = listOf(1L, 2L, 4L, 5L, 6L, 7L, 8L, 9L)
        assertEquals(Streak.State(8, 8, 2, true), Streak.compute(days, today = 9))
    }
    @Test
    fun xpClimbsLevelsThatGrowLonger() {
        assertEquals(1, Levels.of(0))
        assertEquals(1, Levels.of(99))
        assertEquals(2, Levels.of(100))
        assertEquals(3, Levels.of(300))
        // 30 min + 3 words × 5 + 5 dictations × 3 + 1 goal day × 20 + 1 book × 100
        assertEquals(180, Totals(readingMinutes = 30, savedWords = 3, dictations = 5, goalDays = 1, booksCompleted = 1).xp)
        val t = Totals(savedWords = 50, readingMinutes = 599)
        assertTrue(Achievement.WORDS_50.unlocked(t))
        assertFalse(Achievement.TEN_HOURS.unlocked(t))
    }
}
