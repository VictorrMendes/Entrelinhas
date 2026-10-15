package com.victor.leitor

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** An HTTP error from our backend, with its error code. Network failures stay IOExceptions. */
class ApiException(val status: Int, val code: String, message: String) : Exception(message)

/** Every install has an anonymous device account (translation quota); email sign-in swaps it for the account sync uses. */
class Backend(private val prefs: Prefs) {
    suspend fun json(method: String, path: String, body: JSONObject? = null, authed: Boolean = true): JSONObject =
        JSONObject(String(call(method, path, body?.toString()?.toByteArray(), JSON, authed)))

    /** On 401 an anonymous session re-registers and retries; an expired email session signs out and sync reports it. */
    suspend fun call(method: String, path: String, body: ByteArray? = null, contentType: String = JSON, authed: Boolean = true): ByteArray =
        withContext(Dispatchers.IO) {
            var (status, bytes) = exchange(method, path, body, contentType, if (authed) token() else null)
            if (status == 401 && authed) {
                val hadAccount = prefs.accountEmail != null
                signOut()
                if (hadAccount && path.startsWith("/sync")) throw ApiException(401, "SESSION_EXPIRED", "session expired") // App.sync shows the localized message
                exchange(method, path, body, contentType, token()).let { status = it.first; bytes = it.second }
            }
            if (status >= 400) {
                val err = runCatching { JSONObject(String(bytes)).optJSONObject("error") }.getOrNull()
                throw ApiException(status, err?.optString("code").orEmpty().ifEmpty { "HTTP_$status" }, err?.optString("message").orEmpty())
            }
            bytes
        }

    /** Creates the account when [name] is given, otherwise signs in. */
    suspend fun signIn(email: String, password: String, name: String? = null) {
        val body = JSONObject().put("email", email).put("password", password)
        if (name != null) body.put("name", name)
        adopt(json("POST", if (name != null) "/auth/signup" else "/auth/login", body, authed = false).getJSONObject("data"))
    }

    /** Emails a 6-digit code; the answer is the same whether the email has an account or not. */
    suspend fun requestPasswordReset(email: String) {
        json("POST", "/auth/password/forgot", JSONObject().put("email", email), authed = false)
    }

    /** Sets the new password with the emailed code and signs in; other sessions of the account stop working. */
    suspend fun resetPassword(email: String, code: String, password: String) {
        val body = JSONObject().put("email", email).put("code", code).put("password", password)
        adopt(json("POST", "/auth/password/reset", body, authed = false).getJSONObject("data"))
    }

    private fun adopt(session: JSONObject) {
        prefs.token = session.getString("token")
        prefs.accountEmail = session.getString("email")
        prefs.accountName = if (session.isNull("name")) null else session.getString("name") // accounts made before names existed
    }

    fun signOut() {
        prefs.token = null
        prefs.accountEmail = null
        prefs.accountName = null
    }

    private suspend fun token(): String = prefs.token ?: json(
        "POST", "/auth/device", JSONObject().put("deviceId", prefs.userId).put("secret", prefs.deviceSecret), authed = false,
    ).getJSONObject("data").getString("token").also { prefs.token = it }

    private fun exchange(method: String, path: String, body: ByteArray?, contentType: String, token: String?): Pair<Int, ByteArray> {
        val c = URL(BuildConfig.BACKEND_URL.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 10_000
            c.readTimeout = 60_000
            c.setRequestProperty("X-Client-Platform", "android")
            token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", contentType)
                c.setFixedLengthStreamingMode(body.size)
                c.outputStream.use { it.write(body) }
            }
            val status = c.responseCode
            return status to ((if (status < 400) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0))
        } finally {
            c.disconnect()
        }
    }

    private companion object {
        const val JSON = "application/json; charset=utf-8"
    }
}

/** Crashes are saved to files and sent on the next start: the dying process can't be trusted with a network call. */
object CrashReports {
    private const val MAX_CHARS = 20_000

    private fun dir(ctx: android.content.Context) = java.io.File(ctx.filesDir, "crashes")

    fun install(ctx: android.content.Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching {
                val report = "${e.stackTraceToString()}\nthread: ${thread.name}\n" +
                    "android: ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT}), device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
                dir(ctx).apply { mkdirs() }.resolve("${System.currentTimeMillis()}.txt").writeText(report.take(MAX_CHARS))
            }
            previous?.uncaughtException(thread, e)
        }
    }

    suspend fun upload(app: App) = withContext(Dispatchers.IO) {
        val files = dir(app).listFiles()?.sortedBy { it.name } ?: return@withContext
        for (f in files) {
            try {
                app.backend.json("POST", "/crash", JSONObject().put("report", f.readText()).put("appVersion", BuildConfig.VERSION_NAME))
                f.delete()
            } catch (e: ApiException) {
                if (e.status == 400) f.delete() else return@withContext // a report the server refuses would block the queue forever
            } catch (e: Exception) {
                android.util.Log.w("CrashReports", "upload failed, will retry", e)
                return@withContext
            }
        }
    }
}
