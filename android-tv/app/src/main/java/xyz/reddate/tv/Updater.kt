package xyz.reddate.tv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates from the app itself: asks the server which version is current, downloads the new APK,
 * checks it, and hands it to Android's installer (the TV asks you to confirm).
 */
object Updater {
    data class Info(val code: Int, val name: String, val url: String, val size: Long, val sha256: String, val notes: String)

    /** The address the app loads from (the server that also tells us the current version). */
    private fun base(): String {
        val u = Uri.parse(BuildConfig.START_URL)
        return "${u.scheme}://${u.authority}"
    }

    fun installedCode(ctx: Context): Int = try {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else @Suppress("DEPRECATION") pi.versionCode
    } catch (_: Exception) { 0 }

    fun installedName(ctx: Context): String = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

    /** The newest version the server offers, whether or not it is newer than this one. Null if it can't be reached. */
    suspend fun latest(): Info? = withContext(Dispatchers.IO) {
        try {
            val c = URL(base() + "/api/app-version").openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 8000
            val body = c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            c.disconnect()
            val o = JSONObject(body)
            // Use the site's stable download route; it chooses the current APK and follows release redirects.
            val url = base() + "/get"
            Info(o.optInt("versionCode"), o.optString("versionName"), url, o.optLong("size"), o.optString("sha256"), o.optString("notes"))
        } catch (_: Exception) { null }
    }

    /** Download to the cache, reporting 0..1; verifies the checksum when the server gave one. Throws on failure. */
    suspend fun download(ctx: Context, info: Info, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val out = File(dir, "reddate-tv-${info.name}.apk")
        val c = URL(info.url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 20000
        val total = (c.contentLengthLong.takeIf { it > 0 } ?: info.size).coerceAtLeast(1)
        val md = MessageDigest.getInstance("SHA-256")
        var done = 0L
        c.inputStream.use { input ->
            out.outputStream().use { o ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    o.write(buf, 0, n); md.update(buf, 0, n); done += n
                    onProgress((done.toFloat() / total).coerceIn(0f, 1f))
                }
            }
        }
        c.disconnect()
        val got = md.digest().joinToString("") { "%02x".format(it) }
        if (info.sha256.isNotEmpty() && !got.equals(info.sha256, true)) { out.delete(); throw IllegalStateException("The download was damaged. Try again.") }
        out
    }

    fun canInstall(ctx: Context): Boolean = Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    /** One-time: lets this app install updates (Android's "Install unknown apps" for Reddate TV). */
    fun openInstallPermission(ctx: Context) {
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Exception) { ctx.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    fun install(ctx: Context, apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", apk)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
    }
}
