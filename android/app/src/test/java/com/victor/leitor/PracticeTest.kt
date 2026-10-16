package com.victor.leitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class PracticeTest {
    private fun word(id: Long, original: String, translated: String, source: String = "en", box: Int = 0) =
        Word(id, original, translated, null, null, box, null, source)

    private val pool = listOf(
        word(1, "house", "casa"), word(2, "river", "rio"), word(3, "bank", "margem"), word(4, "bright", "claro"),
        word(5, "maison", "casa", source = "fr"), word(6, "home", "Casa"),
    )

    @Test
    fun choicesMixTheMeaningWithOtherWordsOfTheSameLanguage() {
        val options = practiceChoices(pool[0], pool, Random(1))
        assertEquals(4, options.size)
        assertTrue("casa" in options)
        assertEquals(options.size, options.map { it.lowercase() }.distinct().size) // "Casa" of another word isn't a second right answer
        assertTrue(options.toSet().containsAll(listOf("rio", "margem", "claro")))
    }

    @Test
    fun tooFewWordsMeansNoMultipleChoice() {
        assertTrue(practiceChoices(pool[0], pool.take(3), Random(1)).isEmpty())
    }

    @Test
    fun writtenAnswersForgiveCaseAccentsAndOneTypo() {
        assertTrue(closeEnough("café", "Cafe"))
        assertTrue(closeEnough("gave up", "gave  up!"))
        assertTrue(closeEnough("thunder", "thuner"))
        assertTrue(closeEnough("glance (quick look)", "glance"))
        assertTrue(closeEnough("ojeada, vistazo", "vistazo"))
        assertFalse(closeEnough("car", "cat"))
        assertFalse(closeEnough("thunder", "thin"))
    }

    @Test
    fun aRoundAsksEachWordTwiceAndBringsMissesBack() {
        val round = PracticeRound(pool.take(4), pool, Random(2))
        assertEquals(8, round.total)
        val first = round.current!!
        assertEquals(PracticeStage.CHOICE, first.stage)
        round.answer(correct = false)
        assertTrue(first.word.id in round.missed)
        assertEquals(0, round.done)
        repeat(20) { if (!round.finished) round.answer(correct = true) }
        assertTrue(round.finished)
        assertEquals(8, round.done)
        assertNull(round.current)
        assertEquals(setOf(first.word.id), round.missed)
    }

    @Test
    fun withoutChoicesAWordIsOnlyWritten() {
        val round = PracticeRound(listOf(pool[0]), listOf(pool[0]), Random(3))
        assertEquals(1, round.total)
        assertEquals(PracticeStage.WRITTEN, round.current!!.stage)
    }

    @Test
    fun dueAndStillLearningWordsComeFirst() {
        val learned = word(7, "fair", "justo", box = Leitner.MASTERED)
        val picked = practiceWords(listOf(learned, pool[1], pool[2]), due = listOf(pool[2]), n = 2, random = Random(4))
        assertEquals(setOf(2L, 3L), picked.map { it.id }.toSet())
    }
}
