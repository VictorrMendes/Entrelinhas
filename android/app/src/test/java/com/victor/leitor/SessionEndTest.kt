package com.victor.leitor

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class SessionEndTest {
    @get:Rule
    val compose = createComposeRule()

    private val stats = listOf(SessionStat(12, "palavras"), SessionStat(95, "% de acerto"))

    /** As the summaries show it: at the top of their scrolling column. */
    private fun show(content: @Composable () -> Unit) =
        compose.setContent { MaterialTheme { Column(Modifier.verticalScroll(rememberScrollState())) { content() } } }

    @Test
    fun statsCountAccuracyAndRoundMinutesUp() {
        var round = emptyList<SessionStat>()
        var short = emptyList<SessionStat>()
        compose.setContent {
            round = sessionStats(20, 19, 61)
            short = sessionStats(1, 0, 0)
        }
        assertEquals(listOf(20, 95, 2), round.map { it.value })
        assertEquals(listOf("palavras", "% de acerto", "min"), round.map { it.label })
        assertEquals(listOf(1, 0, 1), short.map { it.value })
        assertEquals("palavra", short[0].label)
    }

    @Test
    fun buttonsCallTheirCallbacks() {
        var more = 0
        var done = 0
        show { SessionEnd("Rodada concluída!", stats, emptyList(), 0, { more++ }, { done++ }) }
        compose.onNodeWithText("Mais 5 min").performScrollTo().performClick()
        compose.onNodeWithText("Concluir").performScrollTo().performClick()
        assertEquals(1, more)
        assertEquals(1, done)
    }

    @Test
    fun comboCountsRightAnswersInARowAndKeepsTheRecord() {
        val prefs = Prefs(RuntimeEnvironment.getApplication())
        val combo = ComboCounter()
        combo.answer(true)
        combo.answer(false)
        assertEquals(0, combo.lost) // under COMBO_MIN nothing was lost
        repeat(3) { combo.answer(true) }
        combo.answer(false)
        assertEquals(0, combo.current)
        assertEquals(3, combo.lost)
        combo.answer(true)
        assertEquals(0, combo.lost)
        assertEquals(3, combo.best)
        assertTrue(Accolade.COMBO_RECORD in combo.finish(prefs))
        assertEquals(3, prefs.bestCombo)

        // tying the record isn't a new one
        val again = ComboCounter()
        repeat(3) { again.answer(true) }
        assertFalse(Accolade.COMBO_RECORD in again.finish(prefs))
        assertEquals(3, prefs.bestCombo)
    }

    @Test
    fun noMoreButtonWithoutOnMore() {
        show { SessionEnd("Rodada concluída!", stats, emptyList(), 0, null, {}) }
        compose.onNodeWithText("Mais 5 min").assertDoesNotExist()
        compose.onNodeWithText("Concluir").assertExists()
    }

    @Test
    fun numbersCountUpAndAccoladesShow() {
        show { SessionEnd("Rodada concluída!", stats, listOf(Accolade.COMBO_RECORD), 7, {}, {}) }
        compose.mainClock.advanceTimeBy(3000)
        compose.onNodeWithText("12").assertExists()
        compose.onNodeWithText("95").assertExists()
        // every combo variant names the record, whichever one was picked
        compose.onNodeWithText("7 seguidas", substring = true).assertExists()
    }
}
