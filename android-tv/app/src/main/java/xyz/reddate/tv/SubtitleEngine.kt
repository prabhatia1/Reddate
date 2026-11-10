package xyz.reddate.tv

import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Online subtitles read here (not by the video player): picking one never restarts the picture, and the delay can be nudged. */
class SubtitleEngine {
    class Cue(val start: Long, val end: Long, val text: String)

    @Volatile var cues: List<Cue> = emptyList()
        private set
    @Volatile var url: String = ""
        private set
    @Volatile var lastError: String = ""

    /** Download and read a subtitle file (SRT or WebVTT). Call off the main thread. */
    fun load(u: String): Boolean {
        var c: HttpURLConnection? = null
        return try {
            c = (URL(u).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000; readTimeout = 12000; instanceFollowRedirects = true
                setRequestProperty("User-Agent", "ReddateTV")
            }
            val bytes = c.inputStream.use { it.readBytes() }
            if (bytes.size > 3_000_000) return false
            val list = parse(decode(bytes))
            if (list.isEmpty()) { lastError = "no cues in ${bytes.size} bytes"; return false }
            cues = list
            url = u
            true
        } catch (e: Exception) { lastError = e.toString().take(160); false } finally { c?.disconnect() }
    }

    fun clear() { cues = emptyList(); url = "" }

    fun useText(text: String, key: String): Boolean {
        if (text.toByteArray(Charsets.UTF_8).size > 5 * 1024 * 1024) return false
        val parsed = parse(text)
        if (parsed.isEmpty()) return false
        cues = parsed; url = key
        return true
    }

    fun asVtt(): String {
        fun timestamp(ms: Long): String = String.format(java.util.Locale.ROOT, "%02d:%02d:%02d.%03d", ms / 3600000, ms / 60000 % 60, ms / 1000 % 60, ms % 1000)
        return "WEBVTT\n\n" + cues.joinToString("\n\n") { "${timestamp(it.start)} --> ${timestamp(it.end)}\n${it.text}" }
    }

    /** The text to show at [posMs] (already shifted by the delay), or "". */
    fun textAt(posMs: Long): String {
        val list = cues
        if (list.isEmpty()) return ""
        // Binary search for the last cue starting at or before posMs, then check a few before it (overlaps).
        var lo = 0; var hi = list.size - 1; var idx = -1
        while (lo <= hi) { val mid = (lo + hi) ushr 1; if (list[mid].start <= posMs) { idx = mid; lo = mid + 1 } else hi = mid - 1 }
        if (idx < 0) return ""
        val sb = StringBuilder()
        var i = idx
        while (i >= 0 && i > idx - 4) {
            val c = list[i]
            if (posMs < c.end) { if (sb.isNotEmpty()) sb.insert(0, "\n"); sb.insert(0, c.text) }
            i--
        }
        return sb.toString()
    }

    private fun decode(b: ByteArray): String {
        var off = 0
        if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte()) off = 3
        return try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(b, off, b.size - off)).toString()
        } catch (_: Exception) { String(b, off, b.size - off, charset("windows-1252")) }
    }

    private val timeRe = Regex("""(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})""")

    private fun ms(h: String, m: String, s: String, f: String): Long =
        (h.ifEmpty { "0" }.toLong() * 3600 + m.toLong() * 60 + s.toLong()) * 1000 + f.padEnd(3, '0').take(3).toLong()

    fun parse(text: String): List<Cue> {
        val out = ArrayList<Cue>()
        val blocks = text.replace("\r\n", "\n").replace('\r', '\n').split(Regex("\n{2,}"))
        for (blk in blocks) {
            val lines = blk.split('\n')
            val ti = lines.indexOfFirst { it.contains("-->") }
            if (ti < 0) continue
            val m = timeRe.find(lines[ti]) ?: continue
            val g = m.groupValues
            val body = lines.drop(ti + 1).joinToString("\n")
                .replace(Regex("<[^>]+>"), "").replace(Regex("\\{\\\\[^}]*\\}"), "")
                .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&quot;", "\"")
                .trim()
            if (body.isEmpty()) continue
            out += Cue(ms(g[1], g[2], g[3], g[4]), ms(g[5], g[6], g[7], g[8]), body)
        }
        out.sortBy { it.start }
        return out
    }
}
