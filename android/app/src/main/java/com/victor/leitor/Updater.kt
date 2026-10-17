package com.victor.leitor

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

private const val RELEASES = "https://api.github.com/repos/VictorrMendes/Entrelinhas/releases?per_page=20"

/** A published build newer than this one. [name] is what people see, e.g. 0.1-12. */
data class Release(val versionCode: Int, val name: String, val apkUrl: String)

/**
 * The newest release of [channel] above [current], from the GitHub releases list. The Android workflow tags master builds
 * `v<name>-<run>` and homolog builds `homolog-v<name>-<run>`; the run number is also the APK's versionCode.
 */
fun newestRelease(json: String, channel: String, current: Int): Release? {
    val prefix = if (channel == "homolog") "homolog-v" else "v"
    val releases = JSONArray(json)
    return (0 until releases.length()).map { releases.getJSONObject(it) }
        .filter { !it.optBoolean("draft") && it.getString("tag_name").startsWith(prefix) }
        .mapNotNull { r ->
            val tag = r.getString("tag_name")
            val code = tag.substringAfterLast('-').toIntOrNull() ?: return@mapNotNull null
            val assets = r.getJSONArray("assets")
            val apk = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.getString("name").endsWith(".apk") }
                ?: return@mapNotNull null
            Release(code, tag.removePrefix(prefix), apk.getString("browser_download_url"))
        }
        .filter { it.versionCode > current }
        .maxByOrNull { it.versionCode }
}

/** Raised with a message the UI can show as it is; [retry] is false when trying again can't help. */
class UpdateException(message: String, val retry: Boolean = true) : Exception(message)

/**
 * Updates without the Play Store: every build CI publishes becomes a GitHub release; the app finds the newer one, downloads
 * the APK and hands it to the system installer, which asks for a single tap. Android only installs it over this app when both
 * are signed with the same key, so CI must sign with the release key (ANDROID_KEYSTORE_* secrets).
 */
class Updater(private val app: App) {
    /** Local and debug builds have no channel and never update themselves. */
    val enabled get() = BuildConfig.UPDATE_CHANNEL.isNotEmpty()

    suspend fun check(): Release? = withContext(Dispatchers.IO) {
        if (!enabled) return@withContext null
        val c = URL(RELEASES).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 10_000
            c.readTimeout = 20_000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            if (c.responseCode != 200) throw UpdateException(app.getString(R.string.update_check_failed))
            newestRelease(c.inputStream.use { String(it.readBytes()) }, BuildConfig.UPDATE_CHANNEL, BuildConfig.VERSION_CODE)
        } finally {
            c.disconnect()
        }
    }

    suspend fun install(release: Release) {
        val apk = withContext(Dispatchers.IO) {
            val dir = File(app.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
            val file = File(dir, "entrelinhas-${release.versionCode}.apk")
            val c = URL(release.apkUrl).openConnection() as HttpURLConnection // GitHub redirects to its file host, https to https
            try {
                c.connectTimeout = 15_000
                c.readTimeout = 60_000
                if (c.responseCode != 200) throw UpdateException(app.getString(R.string.update_failed))
                c.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            } finally {
                c.disconnect()
            }
            file
        }
        val pm = app.packageManager
        val archive = pm.getPackageArchiveInfo(apk.path, SIGNERS) ?: throw UpdateException(app.getString(R.string.update_failed))
        if (archive.packageName != app.packageName) throw UpdateException(app.getString(R.string.update_failed))
        val theirs = signers(archive)
        val ours = signers(pm.getPackageInfo(app.packageName, SIGNERS))
        // some Android versions can't read an archive's signers; then the installer is the one that checks
        if (theirs.isNotEmpty() && ours.isNotEmpty() && theirs != ours) throw UpdateException(app.getString(R.string.update_other_key), retry = false)
        val uri = FileProvider.getUriForFile(app, "${app.packageName}.updates", apk)
        app.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    private companion object {
        @Suppress("DEPRECATION")
        val SIGNERS = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

        @Suppress("DEPRECATION")
        fun signers(p: PackageInfo): Set<String> =
            (if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else p.signatures).orEmpty()
                .mapTo(HashSet()) { sha256Hex(it.toByteArray()) }
    }
}
