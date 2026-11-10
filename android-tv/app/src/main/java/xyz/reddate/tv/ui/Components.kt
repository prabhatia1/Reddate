package xyz.reddate.tv.ui

import androidx.compose.runtime.remember
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import coil.request.ImageRequest

@Composable
fun Img(url: String, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Crop, alignment: Alignment = Alignment.Center) {
    if (url.isEmpty()) { Box(modifier.background(C.paper3)); return }
    AsyncImage(
        model = ImageRequest.Builder(LocalContext.current).data(url).crossfade(140).build(),
        contentDescription = null,
        contentScale = scale,
        alignment = alignment,
        modifier = modifier
    )
}

private val focusRing = BorderStroke(3.dp, C.ink)
/** Under a focused card: a soft light, as if the card had lifted off the screen. */
@OptIn(ExperimentalTvMaterial3Api::class)
private val focusGlow = androidx.tv.material3.Glow(elevationColor = Color(0x59F6F1EA), elevation = 18.dp)

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PosterCard(meta: Meta, onClick: () -> Unit, onFocus: () -> Unit = {}, width: Dp = 124.dp, modifier: Modifier = Modifier, showTitle: Boolean = false) {
    if (meta.rank > 0) {
        Column(Modifier.width(width + if (meta.rank >= 10) 78.dp else 54.dp)) {
            RankedPoster(meta, onClick, onFocus, width, modifier)
            if (showTitle) PosterCaption(meta.name)
        }
        return
    }
    // A YouTube channel: its round picture, the name and subscribers under it.
    if (meta.id.startsWith("ytc:")) {
        val d = width * 1.3f
        Column(Modifier.width(d), horizontalAlignment = Alignment.CenterHorizontally) {
            Card(
                onClick = onClick,
                modifier = modifier.size(d).onFocusChanged { if (it.isFocused) onFocus() },
                shape = CardDefaults.shape(androidx.compose.foundation.shape.CircleShape),
                scale = CardDefaults.scale(focusedScale = 1.08f),
            glow = CardDefaults.glow(focusedGlow = focusGlow),
                border = CardDefaults.border(focusedBorder = Border(focusRing, shape = androidx.compose.foundation.shape.CircleShape)),
                colors = CardDefaults.colors(containerColor = C.paper3)
            ) { PosterFace(meta) }
            Text(meta.name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
            if (meta.releaseInfo.isNotEmpty()) Text(meta.releaseInfo, style = MaterialTheme.typography.bodySmall, color = C.muted, maxLines = 1)
        }
        return
    }
    // Same height as a poster, 16:9 wide: YouTube thumbnails fill the card instead of being cropped.
    val w = if (meta.wide) width * 1.5f * 16f / 9f else width
    Column(Modifier.width(w)) {
        Card(
            onClick = onClick,
            modifier = modifier.width(w).aspectRatio(if (meta.wide) 16f / 9f else 2f / 3f).onFocusChanged { if (it.isFocused) onFocus() },
            shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
            scale = CardDefaults.scale(focusedScale = 1.08f),
            glow = CardDefaults.glow(focusedGlow = focusGlow),
            border = CardDefaults.border(focusedBorder = Border(focusRing, shape = RoundedCornerShape(10.dp))),
            colors = CardDefaults.colors(containerColor = C.paper3)
        ) { PosterFace(meta) }
        if (showTitle) PosterCaption(meta.name)
    }
}

@Composable
private fun PosterCaption(name: String) {
    Text(name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 2, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = 8.dp).heightIn(min = 40.dp))
}

/** The picture, or (when an addon sent none) the title on a plain card. */
@Composable
private fun PosterFace(meta: Meta) {
    // A YouTube video (Reddate YT): views bottom-left, length bottom-right, as on YouTube.
    if (meta.id.startsWith("yt:") && meta.poster.isNotEmpty()) {
        Box(Modifier.fillMaxSize()) {
            Img(meta.poster, Modifier.fillMaxSize())
            if (meta.releaseInfo.isNotEmpty()) VideoBadge(meta.releaseInfo, Modifier.align(Alignment.BottomStart))
            if (meta.runtime.isNotEmpty()) VideoBadge(meta.runtime, Modifier.align(Alignment.BottomEnd))
        }
        return
    }
    if (meta.poster.isNotEmpty()) Img(meta.poster, Modifier.fillMaxSize())
    else Box(Modifier.fillMaxSize().background(C.paper3).padding(10.dp), contentAlignment = Alignment.Center) {
        Text(meta.name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 5, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun VideoBadge(text: String, modifier: Modifier) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = androidx.compose.ui.graphics.Color.White, maxLines = 1,
        modifier = modifier.padding(8.dp).clip(RoundedCornerShape(6.dp)).background(androidx.compose.ui.graphics.Color(0xD10A0807)).padding(horizontal = 7.dp, vertical = 2.dp))
}

/** A Top 10 card: a big outlined number behind the poster. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun RankedPoster(meta: Meta, onClick: () -> Unit, onFocus: () -> Unit, width: Dp, modifier: Modifier) {
    val numberW = if (meta.rank >= 10) 78.dp else 54.dp
    Box(Modifier.width(width + numberW)) {
        Text(
            meta.rank.toString(),
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = Display, fontSize = 122.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold, letterSpacing = (-8).sp,
                color = Color(0xFFF6F1EA),
                drawStyle = androidx.compose.ui.graphics.drawscope.Stroke(width = 5f, join = androidx.compose.ui.graphics.StrokeJoin.Round)
            ),
            modifier = Modifier.align(Alignment.BottomStart).offset(x = 0.dp, y = 14.dp)
        )
        Card(
            onClick = onClick,
            modifier = modifier.padding(start = numberW).width(width).aspectRatio(2f / 3f).onFocusChanged { if (it.isFocused) onFocus() },
            shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
            scale = CardDefaults.scale(focusedScale = 1.08f),
            glow = CardDefaults.glow(focusedGlow = focusGlow),
            border = CardDefaults.border(focusedBorder = Border(focusRing, shape = RoundedCornerShape(10.dp))),
            colors = CardDefaults.colors(containerColor = C.paper3)
        ) { PosterFace(meta) }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun EpisodeCard(ep: Episode, selected: Boolean, modifier: Modifier = Modifier, video: Boolean = false, onClick: () -> Unit) {
    Column(Modifier.width(220.dp)) {
        Card(
            onClick = onClick,
            modifier = modifier.width(220.dp).aspectRatio(16f / 9f),
            shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
            scale = CardDefaults.scale(focusedScale = 1.08f),
            glow = CardDefaults.glow(focusedGlow = focusGlow),
            border = CardDefaults.border(
                border = if (selected) Border(BorderStroke(2.dp, C.accent), shape = RoundedCornerShape(10.dp)) else Border.None,
                focusedBorder = Border(focusRing, shape = RoundedCornerShape(10.dp))
            ),
            colors = CardDefaults.colors(containerColor = C.paper3)
        ) {
            Box(Modifier.fillMaxSize()) {
                Img(ep.thumbnail, Modifier.fillMaxSize())
                if (!video) Text(
                    "E${ep.number}", style = MaterialTheme.typography.labelMedium, color = C.ink,
                    modifier = Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xB30D0B0A)).padding(horizontal = 6.dp, vertical = 2.dp)
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(ep.title, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (ep.facts.isNotEmpty()) Text(ep.facts, style = MaterialTheme.typography.bodySmall, color = C.muted, maxLines = 1)
        if (ep.overview.isNotEmpty()) Text(ep.overview, style = MaterialTheme.typography.bodySmall, color = C.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun StreamCard(s: Stream, modifier: Modifier = Modifier, warn: String = "", probe: xyz.reddate.tv.StreamProbe.Result? = null, width: androidx.compose.ui.unit.Dp = 332.dp, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.width(width).height(150.dp),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f),
        colors = ClickableSurfaceDefaults.colors(containerColor = C.paper2, contentColor = C.ink, focusedContainerColor = C.ink, focusedContentColor = C.paper),
        glow = ClickableSurfaceDefaults.glow(focusedGlow = focusGlow)
    ) {
        Row(Modifier.padding(12.dp)) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // The addon's own picture, or its first letter.
                Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF3A322E)), contentAlignment = Alignment.Center) {
                    if (s.logo.startsWith("http")) Img(s.logo, Modifier.fillMaxSize(), scale = ContentScale.Fit)
                    else Text(s.addon.trim().take(1).uppercase(), style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.width(8.dp))
                if (s.quality.isNotEmpty()) {
                    Text(s.quality, style = MaterialTheme.typography.labelMedium, color = C.accentInk,
                        modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(C.accent).padding(horizontal = 6.dp, vertical = 1.dp))
                    Spacer(Modifier.width(8.dp))
                }
                Text(s.addon.ifEmpty { s.name }, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(6.dp))
            Spacer(Modifier.height(5.dp))
            // Connection check and "same as last time".
            Row(verticalAlignment = Alignment.CenterVertically) {
                NetBadge(probe, s.bitrate)
                if (s.remembered) {
                    Spacer(Modifier.width(8.dp))
                    Text("★ Your usual", style = MaterialTheme.typography.labelMedium, color = C.accent, maxLines = 1)
                }
            }
            TagRow(s)
            Spacer(Modifier.height(3.dp))
            if (warn.isNotEmpty()) Text("May not play: $warn", style = MaterialTheme.typography.labelMedium, color = C.accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text((s.title.ifEmpty { s.name }).replace('\n', ' '), style = MaterialTheme.typography.bodySmall, maxLines = if (warn.isNotEmpty()) 1 else 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(10.dp))
        DeviceColumn(remember(s.url, warn) { playsOn(s, tvOk = warn.isEmpty()) })
        }
    }
}

/** What a stream's release name says about picture, sound and source, drawn like the format logos. */
private class Fmt(val kind: String, val label: String = "")

private fun streamFormats(s: Stream): List<Fmt> {
    val t = (s.title + " " + s.name + " " + s.filename).lowercase()
    val out = ArrayList<Fmt>()
    val uhd = Regex("2160p|\\b4k\\b|\\buhd\\b").containsMatchIn(t)
    val hdrPlus = Regex("hdr10\\+|hdr10plus").containsMatchIn(t)
    val hdr = hdrPlus || t.contains("hdr")
    val dv = Regex("dolby.?vision|\\bdovi\\b|\\bdv\\b").containsMatchIn(t)
    if (uhd && hdr) out += Fmt("uhdhdr", if (hdrPlus) "HDR10+" else "HDR")
    else {
        if (uhd) out += Fmt("uhd")
        if (hdr) out += Fmt("hdr", if (hdrPlus) "HDR10+" else "HDR")
    }
    if (dv) out += Fmt("dolby", "VISION")
    when {
        t.contains("atmos") -> out += Fmt("dolby", "ATMOS")
        Regex("ddp|dd\\+|eac3|e-ac-3").containsMatchIn(t) -> out += Fmt("dolby", "DIGITAL+")
        t.contains("truehd") -> out += Fmt("dolby", "TRUEHD")
        t.contains("dts") -> out += Fmt("dts", if (t.contains("dts-hd") || t.contains("dts.hd")) "DTS-HD" else "DTS")
    }
    if (t.contains("7.1")) out += Fmt("chip", "7.1") else if (t.contains("5.1")) out += Fmt("chip", "5.1")
    when {
        t.contains("remux") -> out += Fmt("source", "REMUX")
        Regex("blu-?ray|bdrip").containsMatchIn(t) -> out += Fmt("source", "BLURAY")
        Regex("web-?dl").containsMatchIn(t) -> out += Fmt("source", "WEB-DL")
    }
    if (Regex("hevc|x265|h\\.?265").containsMatchIn(t)) out += Fmt("source", "HEVC") else if (t.contains("av1")) out += Fmt("source", "AV1")
    if (Regex("\\bcam\\b|hdcam|telesync|\\bts\\b").containsMatchIn(t)) out += Fmt("cam", "CAM")
    return out.take(4)
}

private val chipBlack = Color(0xFF0B0B0B)
private val chipEdge = Color(0xFF8A8078)

/** Two back-to-back D shapes, the way the Dolby mark is drawn. */
@Composable
private fun DoubleD(h: Dp, tint: Color) {
    androidx.compose.foundation.Canvas(Modifier.size(width = h * 2.1f, height = h)) {
        val hh = size.height
        val r = hh / 2
        val gap = size.width - 2 * hh * 0.82f
        // left D: round on the left, flat on the right
        drawArc(tint, 90f, 180f, true, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Size(hh, hh))
        drawRect(tint, androidx.compose.ui.geometry.Offset(r, 0f), androidx.compose.ui.geometry.Size(hh * 0.32f, hh))
        // right D: flat on the left, round on the right
        val x0 = size.width - (hh * 0.32f + r)
        drawRect(tint, androidx.compose.ui.geometry.Offset(x0, 0f), androidx.compose.ui.geometry.Size(hh * 0.32f, hh))
        drawArc(tint, -90f, 180f, true, androidx.compose.ui.geometry.Offset(size.width - hh, 0f), androidx.compose.ui.geometry.Size(hh, hh))
    }
}

@Composable
private fun FormatLogo(f: Fmt) {
    val shape = RoundedCornerShape(4.dp)
    when (f.kind) {
        "uhd" -> Column(
            Modifier.clip(shape).background(chipBlack).border(1.dp, chipEdge, shape).padding(horizontal = 5.dp, vertical = 1.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("4K", fontSize = 11.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, color = Color.White, lineHeight = 11.sp)
            Text("ULTRA HD", fontSize = 5.sp, letterSpacing = 0.6.sp, color = Color(0xFFD9D2C9), lineHeight = 5.sp)
        }
        "uhdhdr" -> Row(Modifier.clip(shape).background(chipBlack).border(1.dp, chipEdge, shape).padding(horizontal = 5.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("4K", fontSize = 11.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, color = Color.White, lineHeight = 11.sp)
            Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(10.dp).background(chipEdge))
            Text(f.label, fontSize = 10.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, color = Color(0xFFFFD166), lineHeight = 10.sp)
        }
        "hdr" -> Box(Modifier.clip(shape).background(chipBlack).border(1.dp, chipEdge, shape).padding(horizontal = 5.dp, vertical = 2.dp)) {
            Text(f.label, fontSize = 10.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, color = Color(0xFFFFD166), lineHeight = 10.sp)
        }
        "dolby" -> Row(Modifier.clip(shape).background(chipBlack).border(1.dp, chipEdge, shape).padding(horizontal = 5.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            DoubleD(9.dp, Color.White)
            Spacer(Modifier.width(4.dp))
            Text(f.label, fontSize = 8.sp, letterSpacing = 0.8.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = Color.White, lineHeight = 8.sp)
        }
        "dts" -> Box(Modifier.clip(shape).background(chipBlack).border(1.dp, chipEdge, shape).padding(horizontal = 5.dp, vertical = 2.dp)) {
            Text(f.label, fontSize = 10.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, color = Color(0xFF59C2FF), lineHeight = 10.sp)
        }
        "cam" -> Text("CAM", fontSize = 9.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, color = Color.White,
            modifier = Modifier.clip(shape).background(Color(0xFFEF5350)).padding(horizontal = 5.dp, vertical = 2.dp))
        else -> Text(f.label, fontSize = 9.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = Color(0xFFF6F1EA), letterSpacing = 0.4.sp, lineHeight = 9.sp,
            modifier = Modifier.clip(shape).background(Color(0xFF3A322E)).padding(horizontal = 5.dp, vertical = 3.dp))
    }
}

// ---- where a stream will play: this TV, a phone, a computer's browser ----
// 2 = should play, 1 = might (depends on the exact device and browser), 0 = won't
private class Where(val tv: Int, val phone: Int, val pc: Int)

/**
 * An honest estimate from the link and the release name; only the TV's answer comes from the device itself.
 * Browsers are judged strictly: blue only when the name shows picture AND sound a browser plays (H.264 with
 * AAC/MP3/Opus, or an MP4/WebM/HLS file). Surround formats a browser plays silently, HEVC, AV1, 10-bit/HDR and 4K
 * are "won't play"; anything the name doesn't say is "might".
 */
private fun playsOn(s: Stream, tvOk: Boolean): Where {
    val t = (s.title + " " + s.name + " " + s.filename + " " + s.url.substringBefore('?')).lowercase()
    val insecure = s.url.startsWith("http://")          // a browser on an https page refuses these outright
    val hevc = Regex("hevc|x265|h\\.?265").containsMatchIn(t)
    val av1 = Regex("\\bav1\\b").containsMatchIn(t)
    val tenBit = Regex("10.?bit|hi10|hdr|dolby.?vision|\\bdv\\b").containsMatchIn(t)
    val uhd = Regex("2160p|\\b4k\\b|\\buhd\\b").containsMatchIn(t)
    // Sound a browser can't decode: it plays the picture silently.
    val badAudio = Regex("ac-?3|eac-?3|e-ac-3|\\bddp|dd\\+|\\bdd\\b|dd ?[257]\\.[01]|dolby.?digital|atmos|truehd|\\bdts|\\bflac\\b|\\bpcm\\b|\\blpcm\\b").containsMatchIn(t)
    val oddContainer = Regex("\\.(avi|wmv|flv|rmvb?)\\b|\\b(avi|xvid|divx)\\b").containsMatchIn(t)
    val mkv = Regex("\\bmkv\\b|\\.mkv").containsMatchIn(t)
    val goodVideo = Regex("h\\.?264|x264|\\bavc\\b|\\bvp9\\b").containsMatchIn(t)
    val goodAudio = Regex("\\baac\\b|\\bmp3\\b|\\bopus\\b").containsMatchIn(t)
    val webFile = Regex("\\.(mp4|m4v|webm|m3u8)\\b|\\bhls\\b").containsMatchIn(t)
    fun level(mkvBad: Boolean): Int = when {
        insecure || hevc || av1 || tenBit || uhd || badAudio || oddContainer -> 0
        mkvBad && mkv -> 0
        (goodVideo && goodAudio) || (webFile && !mkv) -> 2
        else -> 1
    }
    return Where(if (tvOk) 2 else 0, level(mkvBad = true), level(mkvBad = false))
}

private val deviceBlue = Color(0xFF1E3A8A)
private val deviceGrey = Color(0xFF3A322E)

@Composable
private fun DeviceIcon(kind: String, state: Int, size: Dp = 26.dp) {
    val bg = if (state == 2) deviceBlue else deviceGrey
    val fg = when (state) { 2 -> Color.White; 1 -> Color(0xFFA9B8E8); else -> Color(0xFF7A716A) }
    val edge = if (state == 1) Modifier.border(2.dp, Color(0xFF3B5BDB), RoundedCornerShape(8.dp)) else Modifier
    Box(Modifier.size(size + 12.dp).clip(RoundedCornerShape(8.dp)).background(bg).then(edge), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.Canvas(Modifier.size(size)) {
            val w = this.size.width; val h = this.size.height
            val st = androidx.compose.ui.graphics.drawscope.Stroke(width = w * 0.09f)
            when (kind) {
                "tv" -> {
                    drawRoundRect(fg, androidx.compose.ui.geometry.Offset(0f, h * 0.12f), androidx.compose.ui.geometry.Size(w, h * 0.62f), androidx.compose.ui.geometry.CornerRadius(w * 0.08f), style = st)
                    drawLine(fg, androidx.compose.ui.geometry.Offset(w * 0.3f, h * 0.9f), androidx.compose.ui.geometry.Offset(w * 0.7f, h * 0.9f), strokeWidth = w * 0.09f)
                }
                "phone" -> {
                    drawRoundRect(fg, androidx.compose.ui.geometry.Offset(w * 0.26f, 0f), androidx.compose.ui.geometry.Size(w * 0.48f, h), androidx.compose.ui.geometry.CornerRadius(w * 0.1f), style = st)
                    drawCircle(fg, w * 0.04f, androidx.compose.ui.geometry.Offset(w * 0.5f, h * 0.86f))
                }
                else -> {
                    drawRoundRect(fg, androidx.compose.ui.geometry.Offset(0f, h * 0.08f), androidx.compose.ui.geometry.Size(w, h * 0.6f), androidx.compose.ui.geometry.CornerRadius(w * 0.06f), style = st)
                    drawLine(fg, androidx.compose.ui.geometry.Offset(w * 0.5f, h * 0.68f), androidx.compose.ui.geometry.Offset(w * 0.5f, h * 0.84f), strokeWidth = w * 0.09f)
                    drawLine(fg, androidx.compose.ui.geometry.Offset(w * 0.28f, h * 0.9f), androidx.compose.ui.geometry.Offset(w * 0.72f, h * 0.9f), strokeWidth = w * 0.09f)
                }
            }
            if (state == 0) drawLine(Color(0xFFB5524B), androidx.compose.ui.geometry.Offset(0f, h), androidx.compose.ui.geometry.Offset(w, 0f), strokeWidth = w * 0.09f) // crossed out
        }
    }
}

@Composable
private fun DeviceColumn(w: Where) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        DeviceIcon("tv", w.tv)
        DeviceIcon("phone", w.phone)
        DeviceIcon("pc", w.pc)
    }
}

@Composable
private fun TagRow(s: Stream) {
    // Worked out once per stream, not on every redraw (these are regex scans of the release name).
    val (flags, formats) = remember(s.url) {
        val text = "${s.title} ${s.name} ${s.filename}"
        val langs = (xyz.reddate.tv.Langs.flagsInText(text) + xyz.reddate.tv.Langs.scan(text).map { xyz.reddate.tv.Langs.flag(it) }.filter { it.isNotEmpty() }).distinct()
        val multi = xyz.reddate.tv.Langs.isMulti(text)
        val fl = (if (multi && langs.size < 2) listOf(xyz.reddate.tv.Langs.globe()) else emptyList()) + langs
        fl to streamFormats(s).take(if (fl.isEmpty()) 4 else 3)
    }
    if (formats.isEmpty() && flags.isEmpty()) return
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 5.dp).height(22.dp)) {
        formats.forEach { FormatLogo(it) }
        if (flags.isNotEmpty()) Text(flags.take(5).joinToString(""), fontSize = 13.sp, maxLines = 1)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PillButton(text: String, onClick: () -> Unit, primary: Boolean = false, icon: ImageVector? = null, modifier: Modifier = Modifier) {
    Button(
        onClick = onClick,
        modifier = modifier.height(46.dp),
        contentPadding = PaddingValues(horizontal = 22.dp, vertical = 0.dp),
        // The orange one is always the main action, focused or not. Any other button turns light when focused,
        // so where you are is never in doubt; both get a white ring and lift a little.
        colors = ButtonDefaults.colors(
            containerColor = if (primary) C.accent else C.paper3,
            contentColor = if (primary) C.accentInk else C.ink,
            focusedContainerColor = if (primary) Color(0xFFFF7D4B) else C.ink,
            focusedContentColor = if (primary) C.accentInk else C.paper,
            pressedContainerColor = if (primary) C.accent else C.ink,
            pressedContentColor = if (primary) C.accentInk else C.paper
        ),
        border = ButtonDefaults.border(focusedBorder = Border(BorderStroke(3.dp, C.ink), shape = RoundedCornerShape(50))),
        glow = ButtonDefaults.glow(focusedGlow = focusGlow),
        scale = ButtonDefaults.scale(focusedScale = 1.08f, pressedScale = 0.96f)
    ) {
        if (icon != null) { Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp))
    }
}

@Composable
fun Avatar(name: String, size: Dp = 32.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(C.accent), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = C.accentInk, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = C.ink, modifier = modifier.padding(top = 4.dp, bottom = 6.dp))
}

@Composable
fun Toast(msg: String, modifier: Modifier = Modifier) {
    Box(modifier.clip(RoundedCornerShape(50)).background(C.ink).padding(horizontal = 22.dp, vertical = 12.dp)) {
        Text(msg, color = C.paper, style = MaterialTheme.typography.titleSmall)
    }
}

/** Fills the width with a dark-to-clear fade, for text over pictures. */
fun Modifier.fadeLeft(): Modifier = this.background(
    androidx.compose.ui.graphics.Brush.horizontalGradient(0f to Color(0xF20D0B0A), 0.55f to Color(0x990D0B0A), 1f to Color(0x000D0B0A))
)
fun Modifier.fadeUp(): Modifier = this.background(
    androidx.compose.ui.graphics.Brush.verticalGradient(0f to Color(0x000D0B0A), 0.7f to Color(0xCC0D0B0A), 1f to Color(0xFF0D0B0A))
)


/** Green / yellow / red dot with the response time and speed from the connection check. */
@Composable
fun NetBadge(r: xyz.reddate.tv.StreamProbe.Result?, bitrate: Double) {
    val (color, text) = when (r?.grade) {
        null -> Color(0xFF6E6560) to "Checking…"
        xyz.reddate.tv.StreamProbe.Grade.GOOD -> Color(0xFF3DDC84) to "${r.ms} ms · ${fmtMbps(r.mbps)}"
        xyz.reddate.tv.StreamProbe.Grade.OK -> Color(0xFFF5C542) to "${r.ms} ms · ${fmtMbps(r.mbps)}"
        xyz.reddate.tv.StreamProbe.Grade.BAD -> Color(0xFFFF5A4E) to "${r.ms} ms · ${fmtMbps(r.mbps)}${if (bitrate > 0) " (needs ${fmtMbps(bitrate)})" else ""}"
        xyz.reddate.tv.StreamProbe.Grade.FAILED -> Color(0xFFFF5A4E) to "Not responding"
        xyz.reddate.tv.StreamProbe.Grade.PINGED -> Color(0xFF9AA39F) to "${r.ms} ms"
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).clip(androidx.compose.foundation.shape.CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}
private fun fmtMbps(m: Double) = if (m >= 10) "${m.toInt()} Mbps" else "${"%.1f".format(m)} Mbps"

/** A Continue watching card: the artwork, a progress bar, the title and how much is left. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ContinueCard(c: CwItem, onFocus: () -> Unit, onLong: () -> Unit = {}, width: Dp = 250.dp, onClick: () -> Unit) {
    Column(Modifier.width(width)) {
        Card(
            onClick = onClick,
            onLongClick = onLong,
            modifier = Modifier.width(width).aspectRatio(16f / 9f).onFocusChanged { if (it.isFocused) onFocus() },
            shape = CardDefaults.shape(RoundedCornerShape(10.dp)),
            scale = CardDefaults.scale(focusedScale = 1.08f),
            glow = CardDefaults.glow(focusedGlow = focusGlow),
            border = CardDefaults.border(focusedBorder = Border(focusRing, shape = RoundedCornerShape(10.dp))),
            colors = CardDefaults.colors(containerColor = C.paper3)
        ) {
            Box(Modifier.fillMaxSize()) {
                Img(c.art.replace("/w1280/", "/w780/"), Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(0.5f to Color(0x00000000), 1f to Color(0xCC000000))))
                if (c.next) Text("UP NEXT", style = MaterialTheme.typography.labelMedium, color = C.accentInk,
                    modifier = Modifier.align(Alignment.TopStart).padding(8.dp).clip(RoundedCornerShape(5.dp)).background(C.accent).padding(horizontal = 6.dp, vertical = 1.dp))
                if (c.progress > 0f) Box(Modifier.align(Alignment.BottomStart).fillMaxSize().padding(10.dp), contentAlignment = Alignment.BottomStart) {
                    Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x55FFFFFF)))
                    Box(Modifier.fillMaxWidth(c.progress).height(4.dp).clip(RoundedCornerShape(2.dp)).background(C.accent))
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(c.name, style = MaterialTheme.typography.titleSmall, color = C.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.heightIn(min = 40.dp))
        Text(c.subtitle, style = MaterialTheme.typography.bodySmall, color = C.muted, maxLines = 1)
    }
}

/** The Reddate mark: two overlapping screens, orange behind cream, the overlap a deeper red. */
@Composable
fun RedMark(size: Dp) {
    androidx.compose.foundation.Canvas(Modifier.size(width = size, height = size * 56f / 64f)) {
        val u = this.size.width / 64f
        val r = androidx.compose.ui.geometry.CornerRadius(8 * u)
        val back = androidx.compose.ui.geometry.Size(52 * u, 36 * u)
        drawRoundRect(Color(0xFFFF7A3C), androidx.compose.ui.geometry.Offset(0f, 0f), back, r)
        drawRoundRect(Color(0xFFF6F1EA), androidx.compose.ui.geometry.Offset(12 * u, 20 * u), back, r)
        // the part of the front screen that covers the back one
        drawRoundRect(Color(0xFFFF3B1F), androidx.compose.ui.geometry.Offset(12 * u, 20 * u), androidx.compose.ui.geometry.Size(40 * u, 16 * u),
            androidx.compose.ui.geometry.CornerRadius(8 * u))
    }
}
