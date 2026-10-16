package com.victor.leitor

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Screens rendered on the JVM; a plain Application keeps App.onCreate (ML Kit, database) out of the way. */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class UiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun dictationShowsWhatWasHeardWrongAndMissed() {
        compose.setContent { MaterialTheme { MarkedWords(checkDictation("The cat sat down", "the dog sat")) } }
        compose.onNodeWithText("The dog cat sat down").assertIsDisplayed()
    }

    @Test
    fun levelCardShowsXpAndWhatIsLeft() {
        compose.setContent { MaterialTheme { LevelCard(Totals(readingMinutes = 150)) } }
        compose.onNodeWithText("Nível 2").assertIsDisplayed()
        compose.onNodeWithText("150 XP").assertIsDisplayed()
        compose.onNodeWithText("Faltam 150 XP para o nível 3").assertIsDisplayed()
    }

    @Test
    fun holdingAWordAndDraggingSelectsWholeWords() {
        val phrase = "possessed of a good fortune"
        var selected: IntRange? = null
        var held: Int? = null
        var tapped: Int? = null
        compose.setContent {
            MaterialTheme {
                TappableText(AnnotatedString(phrase), TextStyle(fontSize = 16.sp), onTap = { tapped = it }, onLongPress = { held = it }, onSelect = { s, e -> selected = s until e })
            }
        }
        val text = compose.onNodeWithText(phrase)
        // from inside "possessed" to inside "fortune": the whole words, not the touched letters
        text.performTouchInput { down(Offset(width * 0.1f, centerY)); advanceEventTime(1000); moveTo(Offset(width * 0.9f, centerY)); up() }
        assertEquals(phrase.indices, selected)
        assertNull(held)
        // holding without dragging is still the sentence, and a tap still the word
        text.performTouchInput { down(Offset(2f, centerY)); advanceEventTime(1000); up() }
        assertEquals(0, held)
        assertNull(tapped)
        text.performTouchInput { click(Offset(2f, centerY)) }
        assertEquals(0, tapped)
    }

    @Test
    fun achievementsCountWhatIsUnlockedAndShowProgress() {
        compose.setContent { MaterialTheme { Achievements(Totals(savedWords = 60, dictations = 4)) } }
        compose.onNodeWithText("1/16").assertIsDisplayed()
        // grouped by theme, the vocabulary badges sit below the streak ones, past the first screen
        compose.onNodeWithText("Colecionador").assertExists()
        compose.onNodeWithText("4/20").assertExists()
    }
}
