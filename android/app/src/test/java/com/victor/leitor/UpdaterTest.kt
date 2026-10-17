package com.victor.leitor

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** org.json only works on the JVM through Robolectric. */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class UpdaterTest {
    private fun release(tag: String, apk: String = "entrelinhas-$tag.apk", draft: Boolean = false) =
        """{"tag_name":"$tag","draft":$draft,"assets":[{"name":"notes.txt","browser_download_url":"https://x/notes"},
           {"name":"$apk","browser_download_url":"https://github.com/o/r/releases/download/$tag/$apk"}]}"""

    private val releases = "[" + listOf(
        release("homolog-v0.1-12"), release("v0.1-11"), release("v0.1-13", draft = true), release("v0.1-9"), release("v0.1-4"),
    ).joinToString(",") + "]"

    @Test
    fun productionTakesTheNewestPublishedReleaseOfItsChannel() {
        val r = newestRelease(releases, "production", current = 8)!!
        assertEquals(11, r.versionCode)
        assertEquals("0.1-11", r.name)
        assertEquals("https://github.com/o/r/releases/download/v0.1-11/entrelinhas-v0.1-11.apk", r.apkUrl)
    }

    @Test
    fun homologOnlyLooksAtHomologReleases() {
        assertEquals(12, newestRelease(releases, "homolog", current = 8)!!.versionCode)
    }

    @Test
    fun nothingWhenThisBuildIsAlreadyTheNewestOrHasNoApk() {
        assertNull(newestRelease(releases, "production", current = 11))
        assertNull(newestRelease("[" + release("v0.1-20", apk = "notes.zip") + "]", "production", current = 8))
    }
}
