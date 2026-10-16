package com.victor.leitor

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
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
    fun achievementsCountWhatIsUnlockedAndShowProgress() {
        compose.setContent { MaterialTheme { Achievements(Totals(savedWords = 60, dictations = 4)) } }
        compose.onNodeWithText("1/16").assertIsDisplayed()
        // grouped by theme, the vocabulary badges sit below the streak ones, past the first screen
        compose.onNodeWithText("Colecionador").assertExists()
        compose.onNodeWithText("4/20").assertExists()
    }
}
