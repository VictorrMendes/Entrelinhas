package com.victor.leitor

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class StudyModesTest {
    private fun word(id: Long, original: String, translated: String) = Word(id, original, translated, null, null, 0, null, "en")

    private val words = listOf(
        word(1, "house", "casa"), word(2, "river", "rio"), word(3, "bank", "margem"), word(4, "bright", "claro"),
        word(5, "clock", "relógio"), word(6, "home", "casa"), word(7, "window", "janela"),
    )

    @Test
    fun aTestMixesTheChosenKindsAndCountsRightAnswers() {
        val test = buildTest(words, words, count = 6, kinds = TestKind.entries.toSet(), random = Random(1))
        assertEquals(6, test.size)
        assertEquals(TestKind.entries.toSet(), test.map { it.kind }.toSet())
        for (q in test) {
            val right = when (q.kind) {
                TestKind.CHOICE -> q.word.translated
                TestKind.WRITTEN -> q.word.original.uppercase()
                TestKind.TRUE_FALSE -> (q.shown == q.word.translated).toString()
            }
            assertTrue(q.isRight(right))
            assertFalse(q.isRight(""))
        }
    }

    @Test
    fun trueFalseShowsAWrongMeaningSometimes() {
        val shown = (1..20).flatMap { seed ->
            buildTest(words, words, 7, setOf(TestKind.TRUE_FALSE), Random(seed)).map { it.shown == it.word.translated }
        }
        assertTrue(true in shown && false in shown)
    }

    @Test
    fun withTooFewMeaningsATestFallsBackToWritten() {
        val test = buildTest(words.take(2), words.take(2), 2, setOf(TestKind.CHOICE), Random(3))
        assertTrue(test.all { it.kind == TestKind.WRITTEN })
    }

    @Test
    fun matchUsesPairsWithoutTwinMeanings() {
        val tiles = matchTiles(words, pairs = 6, random = Random(4))
        assertEquals(12, tiles.size)
        assertTrue(tiles.groupBy { it.pair }.values.all { it.size == 2 })
        // "house" and "home" both mean "casa": only one of them may be on the board
        assertEquals(1, tiles.count { it.text == "casa" })
    }
}
