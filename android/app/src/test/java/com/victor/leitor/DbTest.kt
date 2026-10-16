package com.victor.leitor

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class DbTest {
    @Test
    fun aHiddenParagraphTranslationDoesNotComeBack() {
        val db = Db(RuntimeEnvironment.getApplication())
        val book = db.insertBook("file:///book.epub", "Book", "epub", "en", 10, null)
        db.saveParagraphTranslation(book, 3, "en", "pt", "olá")
        db.saveParagraphTranslation(book, 4, "en", "pt", "mundo")
        db.saveParagraphTranslation(book, 3, "en", "es", "hola")

        db.deleteParagraphTranslation(book, 3, "en", "pt")

        assertEquals(mapOf(4 to "mundo"), db.paragraphTranslations(book, "en", "pt"))
        assertEquals(mapOf(3 to "hola"), db.paragraphTranslations(book, "en", "es"))
    }
}
