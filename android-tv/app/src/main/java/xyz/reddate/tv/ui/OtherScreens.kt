package xyz.reddate.tv.ui

import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.blur
import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Add
import androidx.tv.material3.Icon
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items as lazyItems
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import xyz.reddate.tv.Engine
import xyz.reddate.tv.objects
import xyz.reddate.tv.str

/** A text box for the TV: OK opens the on-screen keyboard; "Search" / "Go" on the keyboard submits. */
@Composable
fun TvTextField(value: String, onChange: (String) -> Unit, hint: String, onSubmit: () -> Unit, modifier: Modifier = Modifier, url: Boolean = false) {
    var focused by remember { mutableStateOf(false) }
    val fm = androidx.compose.ui.platform.LocalFocusManager.current
    val kb = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    // Keep the caret position so Left/Right only leave the box at its edges.
    var tfv by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(value)) }
    if (tfv.text != value) tfv = androidx.compose.ui.text.input.TextFieldValue(value, androidx.compose.ui.text.TextRange(value.length))
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (focused) C.paper3 else C.paper2)
            .border(BorderStroke(if (focused) 3.dp else 2.dp, if (focused) C.ink else C.paper3), RoundedCornerShape(14.dp))
            .padding(horizontal = 18.dp, vertical = 13.dp)
    ) {
        if (value.isEmpty()) Text(hint, color = C.muted, style = MaterialTheme.typography.bodyMedium)
        BasicTextField(
            value = tfv,
            onValueChange = { tfv = it; if (it.text != value) onChange(it.text) },
            singleLine = true,
            textStyle = TextStyle(color = C.ink, fontSize = 17.sp, fontFamily = TextFace),
            cursorBrush = SolidColor(C.accent),
            keyboardOptions = KeyboardOptions(keyboardType = if (url) KeyboardType.Uri else KeyboardType.Text, imeAction = if (url) ImeAction.Go else ImeAction.Search),
            keyboardActions = KeyboardActions(onGo = { kb?.hide(); onSubmit() }, onSearch = { kb?.hide(); onSubmit() }, onDone = { kb?.hide(); onSubmit() }),
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }
                .onPreviewKeyEvent { e ->
                    if (e.type != androidx.compose.ui.input.key.KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    val sel = tfv.selection
                    when (e.key) {
                        androidx.compose.ui.input.key.Key.DirectionDown -> { kb?.hide(); fm.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) }
                        androidx.compose.ui.input.key.Key.DirectionUp -> { kb?.hide(); fm.moveFocus(androidx.compose.ui.focus.FocusDirection.Up) }
                        androidx.compose.ui.input.key.Key.DirectionLeft -> if (sel.collapsed && sel.start == 0) { kb?.hide(); fm.moveFocus(androidx.compose.ui.focus.FocusDirection.Left) } else false
                        androidx.compose.ui.input.key.Key.DirectionRight -> if (sel.collapsed && sel.end == tfv.text.length) { kb?.hide(); fm.moveFocus(androidx.compose.ui.focus.FocusDirection.Right) } else false
                        else -> false
                    }
                }
        )
    }
}

@Composable
fun SearchScreen(model: AppModel) {
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val box = remember { FocusRequester() }
    val q = model.searchQ
    val results = if (model.searchQ.isBlank()) null else model.searchResults // an empty box shows your recent searches, not old results
    val requesters = remember { HashMap<String, FocusRequester>() }
    val kb = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val colState = androidx.compose.foundation.lazy.rememberLazyListState()
    val rowStates = remember { HashMap<String, androidx.compose.foundation.lazy.LazyListState>() }
    fun run() {
        val text = q.trim()
        if (text.length < 2 || (text == model.searchFor && model.searchResults != null)) return
        busy = true
        scope.launch {
            val r = try { model.search(text) } catch (_: Exception) { emptyList() }
            model.searchResults = r; model.searchFor = text; busy = false
            if (r.isNotEmpty()) model.addRecent(text) // only searches that found something
        }
    }
    LaunchedEffect(Unit) { model.loadRecents() }
    // Search as you type (after a pause), like the phone app. Coming back with results already there does nothing.
    LaunchedEffect(q) { if (q.trim().length >= 2 && q.trim() != model.searchFor) { delay(600); run() } }
    // Back from a title: the results you left, with the one you opened focused. Otherwise the search box.
    LaunchedEffect(Unit) {
        delay(80)
        val last = if (model.searchResults != null) model.searchLastId else ""
        val all = model.searchResults.orEmpty()
        var done = false
        if (last.isNotEmpty() && all.any { it.id == last }) {
            val groupsNow = searchGroups(all)
            val gi = groupsNow.indexOfFirst { g -> g.second.any { it.id == last } }.coerceAtLeast(0)
            val idx = groupsNow.getOrNull(gi)?.second?.indexOfFirst { it.id == last } ?: 0
            try { colState.scrollToItem(gi) } catch (_: Exception) { }
            delay(120)
            try { rowStates[groupsNow.getOrNull(gi)?.first ?: "Series"]?.scrollToItem(idx.coerceAtLeast(0)) } catch (_: Exception) { }
            for (attempt in 0 until 8) { // the card composes a moment after the scroll
                delay(100)
                val req = requesters[last]
                if (req != null) { try { req.requestFocus(); done = true } catch (_: Exception) { } }
                if (done) break
            }
        }
        if (done) { delay(60); kb?.hide() } else try { box.requestFocus() } catch (_: Exception) { }
    }
    Column(Modifier.fillMaxSize().background(C.paper).padding(start = LocalRailInset.current + 28.dp, end = 40.dp, top = 32.dp)) {
        Text("Search", style = MaterialTheme.typography.displaySmall, color = C.ink)
        Spacer(Modifier.height(14.dp))
        Row(Modifier.widthIn(max = 780.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TvTextField(q, { model.searchQ = it }, "Movies and shows", ::run, Modifier.weight(1f).focusRequester(box))
            Spacer(Modifier.width(12.dp))
            // Not every keyboard has a search or enter key: a button does the same thing.
            PillButton("Search", { kb?.hide(); run() }, primary = true, icon = Icons.Default.Search)
        }
        Spacer(Modifier.height(18.dp))
        val list = results
        val showRecents = q.isBlank() && model.recentSearches.isNotEmpty()
        if (showRecents) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Recent searches", style = MaterialTheme.typography.titleMedium, color = C.ink, modifier = Modifier.weight(1f))
                PillButton("Clear all", { model.clearRecents() })
            }
            Spacer(Modifier.height(10.dp))
            androidx.compose.foundation.lazy.LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 80.dp)) {
                lazyItems(model.recentSearches.toList(), key = { it }) { term ->
                    Row(Modifier.widthIn(max = 640.dp), verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            onClick = { model.searchQ = term },
                            modifier = Modifier.weight(1f),
                            shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
                            colors = ClickableSurfaceDefaults.colors(containerColor = C.paper2, focusedContainerColor = C.paper3, contentColor = C.ink, focusedContentColor = C.ink),
                            border = ClickableSurfaceDefaults.border(focusedBorder = Border(BorderStroke(2.dp, C.ink), shape = RoundedCornerShape(12.dp)))
                        ) {
                            Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Search, contentDescription = null, tint = C.muted, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(12.dp))
                                Text(term, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                            }
                        }
                        Spacer(Modifier.width(10.dp))
                        PillButton("Delete", { model.removeRecent(term) }, icon = Icons.Default.Delete)
                    }
                }
            }
        }
        when {
            showRecents -> {}
            busy && list == null -> Text("Searching…", color = C.muted)
            list != null && list.isEmpty() -> Text(if (busy) "Searching…" else "Nothing found. Try other words.", color = C.muted)
            list != null -> {
                // Series and movies in their own rows (series first: a show's name is usually what you typed).
                val groups = searchGroups(list)
                VerticalPin(pin = 0.2f) { androidx.compose.foundation.lazy.LazyColumn(
                    state = colState,
                    contentPadding = PaddingValues(bottom = 200.dp, top = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp)
                ) {
                    lazyItems(groups, key = { it.first }) { (title, metas) ->
                        Column {
                            SectionTitle("$title  ·  ${metas.size}")
                            HorizontalPin { androidx.compose.foundation.lazy.LazyRow(state = rowStates.getOrPut(title) { androidx.compose.foundation.lazy.LazyListState() }, horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(end = 40.dp)) {
                                lazyItems(metas, key = { it.id }) { m ->
                                    val req = requesters.getOrPut(m.id) { FocusRequester() }
                                    PosterCard(m, onClick = { model.searchLastId = m.id; kb?.hide(); model.go(Screen.Title(m)) }, modifier = Modifier.focusRequester(req))
                                }
                            } }
                        }
                    }
                } }
            }
        }
    }
}

@Composable
fun LinkScreen(model: AppModel) {
    var url by remember { mutableStateOf("") }
    val box = remember { FocusRequester() }
    LaunchedEffect(Unit) { try { box.requestFocus() } catch (_: Exception) { } }
    Column(Modifier.fillMaxSize().background(C.paper).padding(start = LocalRailInset.current + 28.dp, end = 40.dp, top = 32.dp)) {
        Text("YouTube & links", style = MaterialTheme.typography.displaySmall, color = C.ink)
        Spacer(Modifier.height(6.dp))
        Text("Paste a YouTube link, or a direct video link (.mp4, .m3u8…). It plays for everyone in the room.", color = C.muted, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            TvTextField(url, { url = it }, "https://youtube.com/watch?v=…", { if (url.isNotBlank()) model.startLink(url) }, Modifier.width(560.dp).focusRequester(box), url = true)
            Spacer(Modifier.width(12.dp))
            PillButton("Play", { if (url.isNotBlank()) model.startLink(url) }, primary = true, icon = Icons.Default.PlayArrow)
        }
        Spacer(Modifier.height(14.dp))
        Text("Tip: typing a link with the remote is slow. Paste it on your phone in the room instead, and the TV plays it.", color = C.muted, style = MaterialTheme.typography.bodySmall)
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ProfilesScreen(model: AppModel) {
    val first = remember { FocusRequester() }
    var editing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { try { first.requestFocus() } catch (_: Exception) { } }
    // Behind it: tonight's first picture, blurred and dark, so the screen feels like the app before you're in it.
    val art = model.rows.firstOrNull()?.items?.value?.firstOrNull()?.heroImage ?: ""
    Box(Modifier.fillMaxSize().background(C.paper)) {
    if (art.isNotEmpty()) Img(art, Modifier.fillMaxSize().blur(28.dp).graphicsLayer { alpha = 0.45f })
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(0f to C.paper.copy(alpha = 0.55f), 1f to C.paper)))
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Row(verticalAlignment = Alignment.CenterVertically) { RedMark(28.dp); Spacer(Modifier.width(10.dp)); Text("Reddate", style = MaterialTheme.typography.titleLarge, color = C.ink) }
        Spacer(Modifier.height(30.dp))
        Text(if (editing) "Edit profiles" else "Who’s watching?", style = MaterialTheme.typography.displayLarge, color = C.ink)
        Spacer(Modifier.height(8.dp))
        Text(
            if (editing) "Pick a profile to rename or delete it." else "Every profile keeps its own Continue watching and history.",
            color = C.muted, style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(44.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(40.dp)) {
            model.info.profiles.forEachIndexed { i, p ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Surface(
                        onClick = { if (editing) model.dialog = Dlg.EditProfile(p) else model.chooseProfile(p) },
                        modifier = Modifier.size(140.dp).then(if (p.id == model.info.profileId || (model.info.profileId.isEmpty() && i == 0)) Modifier.focusRequester(first) else Modifier),
                        shape = ClickableSurfaceDefaults.shape(CircleShape),
                        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.1f),
                        glow = ClickableSurfaceDefaults.glow(focusedGlow = androidx.tv.material3.Glow(Color(0x59F6F1EA), 22.dp)),
                        // Every person keeps one colour (the same one the player and chat give them).
                        colors = ClickableSurfaceDefaults.colors(containerColor = personColor(p.name, i), focusedContainerColor = personColor(p.name, i), contentColor = C.accentInk, focusedContentColor = C.accentInk),
                        border = ClickableSurfaceDefaults.border(
                            border = if (p.id == model.info.profileId) Border(BorderStroke(3.dp, C.paper3), shape = CircleShape) else Border.None,
                            focusedBorder = Border(BorderStroke(3.dp, C.ink), shape = CircleShape)
                        )
                    ) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(p.name.take(1).uppercase(), style = MaterialTheme.typography.displayLarge, color = C.accentInk) } }
                    Spacer(Modifier.height(16.dp))
                    Text(p.name, color = C.ink, style = MaterialTheme.typography.titleLarge, maxLines = 1)
                    if (p.id == model.info.profileId && !editing) Text("Watching now", color = C.muted, style = MaterialTheme.typography.bodySmall)
                    if (editing) Text(if (p.main) "Main" else "Edit", color = C.muted, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (model.info.profiles.size < 6) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Surface(
                        onClick = { model.dialog = Dlg.EditProfile(null) },
                        modifier = Modifier.size(140.dp),
                        shape = ClickableSurfaceDefaults.shape(CircleShape),
                        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.1f),
                        colors = ClickableSurfaceDefaults.colors(containerColor = C.paper2, focusedContainerColor = C.paper3, contentColor = C.ink, focusedContentColor = C.ink),
                        border = ClickableSurfaceDefaults.border(border = Border(BorderStroke(2.dp, C.paper3), shape = CircleShape), focusedBorder = Border(BorderStroke(3.dp, C.ink), shape = CircleShape))
                    ) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Icon(Icons.Default.Add, contentDescription = "Add a profile", modifier = Modifier.size(40.dp)) } }
                    Spacer(Modifier.height(16.dp))
                    Text("Add profile", color = C.muted, style = MaterialTheme.typography.titleLarge, maxLines = 1)
                }
            }
        }
        Spacer(Modifier.height(44.dp))
        PillButton(if (editing) "Done" else "Edit profiles", { editing = !editing })
    }
    }
}

/** One colour per person, the same palette the player uses for chat and Who's here; the main profile stays orange. */
fun personColor(name: String, index: Int): Color {
    if (index == 0) return C.accent
    val c = longArrayOf(0xFF9AD1FF, 0xFFFFE08A, 0xFFC9F27A, 0xFFE0A6FF, 0xFF8FE3C9, 0xFFFFB27A)
    return Color(c[(name.lowercase().fold(0) { a, ch -> a * 31 + ch.code } and 0x7fffffff) % c.size])
}

/** Add a profile, or rename / delete one. The main profile can be renamed but not deleted. */
@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ProfileDialog(model: AppModel, profile: Profile?) {
    var name by remember { mutableStateOf(profile?.name ?: "") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var armed by remember { mutableStateOf(false) }
    val box = remember { FocusRequester() }
    fun save() {
        if (name.trim().isEmpty()) { error = "Give the profile a name."; return }
        if (busy) return
        busy = true; error = ""
        model.saveProfile(profile?.id, name.trim()) { msg -> busy = false; if (msg != null) error = msg }
    }
    LaunchedEffect(armed) { if (armed) { delay(3500); armed = false } }
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.width(560.dp).clip(RoundedCornerShape(16.dp)).background(C.paper2).padding(28.dp)) {
            Text(if (profile == null) "New profile" else "Edit profile", style = MaterialTheme.typography.headlineSmall, color = C.ink)
            Text(
                if (profile == null) "It starts with your main profile’s addons, and keeps its own Continue watching and history."
                else "Its Continue watching and history stay its own.",
                color = C.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)
            )
            Spacer(Modifier.height(18.dp))
            TvTextField(name, { name = it.take(24); error = "" }, "Name", ::save, Modifier.fillMaxWidth().focusRequester(box))
            if (error.isNotEmpty()) Text(error, color = C.accent, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton(if (busy) "Saving…" else "Save", { save() }, primary = true)
                if (profile != null && !profile.main) {
                    PillButton(if (armed) "Press again to delete" else "Delete profile", {
                        if (!armed) { armed = true; return@PillButton }
                        if (!busy) { busy = true; model.deleteProfile(profile.id) { msg -> busy = false; if (msg != null) error = msg } }
                    }, icon = Icons.Default.Delete)
                }
                PillButton("Cancel", { model.dialog = null })
            }
            if (profile != null && profile.main) Text("The main profile can’t be deleted.", color = C.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 12.dp))
        }
    }
    LaunchedEffect(Unit) { delay(50); try { box.requestFocus() } catch (_: Exception) { } }
}

/** "How do you want to watch?" */
@Composable
private fun Text(text: String, color: Color, fontSizeOverride: Int, modifier: Modifier = Modifier) {
    androidx.tv.material3.Text(text, color = color, fontSize = fontSizeOverride.sp, letterSpacing = 3.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, modifier = modifier)
}

fun qrBitmap(text: String, size: Int): Bitmap? = try {
    if (text.isEmpty()) null else {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 0))
        val px = IntArray(m.width * m.height) { i -> if (m.get(i % m.width, i / m.width)) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
        Bitmap.createBitmap(px, m.width, m.height, Bitmap.Config.ARGB_8888)
    }
} catch (_: Exception) { null }

/** Someone invited you? Type their party's code. */
@Composable
fun JoinCodeDialog(model: AppModel) {
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val box = remember { FocusRequester() }
    fun go() {
        if (busy) return
        if (code.isBlank()) { error = "Enter the 5-character code or invite link your friend sent you."; return }
        busy = true; error = ""
        model.joinCode(code) { msg -> busy = false; if (msg != null) error = msg }
    }
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.width(520.dp).clip(RoundedCornerShape(16.dp)).background(C.paper2).padding(28.dp)) {
            Text("Someone invited you?", style = MaterialTheme.typography.headlineSmall, color = C.ink)
            Text("Enter a 5-character code or paste an invite link. Phones, browsers and TVs join the same party.", color = C.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(18.dp))
            TvTextField(code, { code = it.take(2048); error = "" }, "A7B2C or invite link", ::go, Modifier.fillMaxWidth().focusRequester(box))
            if (error.isNotEmpty()) Text(error, color = C.accent, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp))
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton(if (busy) "Joining…" else "Join the party", { if (!busy) go() }, primary = true, icon = Icons.Default.Share)
                PillButton("Cancel", { model.dialog = null })
            }
        }
    }
    LaunchedEffect(Unit) { delay(50); try { box.requestFocus() } catch (_: Exception) { } }
}

/** "Watch together": start a party and share its code, or join a friend's with theirs. */
@Composable
fun TogetherDialog(model: AppModel) {
    val first = remember { FocusRequester() }
    var roomCode by remember { mutableStateOf("") }
    var codeError by remember { mutableStateOf("") }
    Dialog(onDismissRequest = { model.dialog = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.width(480.dp).clip(RoundedCornerShape(16.dp)).background(C.paper2).padding(28.dp)) {
            Text("Watch together", style = MaterialTheme.typography.headlineSmall, color = C.ink)
            Text("Watch in sync with friends, on any screen.", color = C.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(16.dp))
            TvTextField(roomCode, { roomCode = it.uppercase().take(5); codeError = "" }, "Your code (optional)", {}, Modifier.fillMaxWidth())
            Text("Leave blank to generate a 5-character code.", color = C.muted, style = MaterialTheme.typography.bodySmall)
            if (codeError.isNotEmpty()) Text(codeError, color = C.accent, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Start a party", {
                    if (roomCode.isNotEmpty() && !Regex("^[A-Z0-9]{5}$").matches(roomCode)) codeError = "Use exactly 5 letters or numbers."
                    else { model.dialog = null; model.together(roomCode) }
                }, primary = true, icon = Icons.Default.Share, modifier = Modifier.focusRequester(first))
                PillButton("Join with a code", { model.dialog = Dlg.JoinCode })
            }
        }
    }
    LaunchedEffect(Unit) { delay(50); try { first.requestFocus() } catch (_: Exception) { } }
}

/** Search results in rows: series, movies, YouTube channels, YouTube videos, then anything else. */
internal fun searchGroups(all: List<Meta>): List<Pair<String, List<Meta>>> {
    val yt = { m: Meta -> m.id.startsWith("yt:") }
    val channels = all.filter { it.type == "channel" }
    val videos = all.filter { yt(it) && it.type != "channel" }
    val series = all.filter { (it.type == "series" || it.type == "anime") && !yt(it) }
    val movies = all.filter { it.type == "movie" && !yt(it) }
    val other = all.filter { it !in channels && it !in videos && it !in series && it !in movies }
    return listOf("Series" to series, "Movies" to movies, "Channels" to channels, "YouTube" to videos, "Other" to other).filter { it.second.isNotEmpty() }
}
