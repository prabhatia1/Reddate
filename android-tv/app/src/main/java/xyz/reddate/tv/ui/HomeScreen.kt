package xyz.reddate.tv.ui

import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Check
import androidx.tv.material3.Border
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.runtime.DisposableEffect
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Share
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** Room the collapsed side menu takes on the left; screens start their content after it. */
val RAIL = 76.dp

/** The menu asks the screen beside it to take focus back (and show what it was on). */
class EnterHook { var fn: (() -> Unit)? = null }
val LocalEnterHook = androidx.compose.runtime.compositionLocalOf { EnterHook() }

/** Left padding screens keep for the side menu (pictures may run under it; text and focusable things don't). */
val LocalRailInset = androidx.compose.runtime.compositionLocalOf { RAIL }
private val RAIL_OPEN = 236.dp
/** Poster width on Home: sized so two full rows (plus the banner) fit on a 1080p screen. */
private val emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)
// Collapsed: no bar at all, just a soft shade so the icons read over the artwork behind them.
private val railShade = Brush.horizontalGradient(0.0f to Color(0xE60D0B0A), 0.7f to Color(0x800D0B0A), 1.0f to Color(0x000D0B0A))

/** Left and right margin of screens that have no side menu. */
val SIDE = 40.dp

/**
 * The side menu. Collapsed: a column of icons floating over the artwork, the current screen marked
 * with an accent bar. Focused: it opens into a rounded panel with labels; Right gives focus back to
 * what you were on.
 */
@OptIn(ExperimentalTvMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
fun WithRail(model: AppModel, current: String, content: @Composable () -> Unit) {
    val info = model.info
    var railFocused by remember { mutableStateOf(false) }
    val open = railFocused && model.dialog == null
    val width by animateDpAsState(if (open) RAIL_OPEN else RAIL, tween(240, easing = emphasized), label = "railWidth")
    val panel by animateFloatAsState(if (open) 1f else 0f, tween(if (open) 200 else 140), label = "railPanel")
    val contentFocus = remember { FocusRequester() }
    val hook = remember { EnterHook() }
    val appCtx = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(Unit) { model.checkUpdate(xyz.reddate.tv.Updater.installedCode(appCtx)) }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    val railScope = rememberCoroutineScope()

    LaunchedEffect(model.refocusTick) {
        if (model.refocusTick == 0) return@LaunchedEffect
        kotlinx.coroutines.delay(120)
        val back = hook.fn
        if (back != null) back() else try { contentFocus.requestFocus() } catch (_: Exception) { }
    }

    // The menu only opens when you press Left into it. If focus lands there by itself (the thing you were on
    // disappeared, a list reloaded), it goes straight back to the screen instead of opening "Switch profile".
    var lastLeftAt by remember { mutableStateOf(0L) }
    var strayTick by remember { mutableStateOf(0) }
    LaunchedEffect(strayTick) {
        if (strayTick == 0) return@LaunchedEffect
        val back = hook.fn
        if (back != null) back() else try { contentFocus.requestFocus() } catch (_: Exception) { }
    }
    // Opening the menu always lands on the screen you're on, never on whatever row happened to be level with you.
    val currentReq = remember { FocusRequester() }
    val target = if (current in listOf("home", "search", "mylist", "calendar", "addons", "account", "profiles")) current else if (current == "report") "account" else "home"
    fun req(key: String): FocusRequester? = if (key == target) currentReq else null
    Box(Modifier.fillMaxSize().dpadThrottle().onPreviewKeyEvent { e ->
        if (e.type == KeyEventType.KeyDown && (e.key == Key.DirectionLeft || e.key == Key.DirectionUp || e.key == Key.DirectionDown || e.key == Key.DirectionRight || e.key == Key.Back || e.key == Key.Menu)) lastLeftAt = System.currentTimeMillis()
        false
    }) {
        Box(Modifier.fillMaxSize().focusRequester(contentFocus)
            // At the top or bottom of a screen, Up and Down just stop. Only Left goes to the menu.
            .focusProperties { exit = { d -> if (d == FocusDirection.Up || d == FocusDirection.Down) FocusRequester.Cancel else FocusRequester.Default } }
            .focusGroup()) {
            CompositionLocalProvider(LocalRailInset provides RAIL, LocalEnterHook provides hook) { content() }
        }
        // The time, top right, from the TV's own clock (it follows the TV's time zone and 12/24-hour setting).
        Box(Modifier.align(Alignment.TopEnd).padding(top = 22.dp, end = 32.dp)) { ClockText() }
        // Shade behind the collapsed icons; when the menu opens the whole screen dims behind it.
        if (current == "home") Box(Modifier.fillMaxHeight().width(RAIL + 40.dp).alpha(1f - panel).background(railShade)) // only over a picture
        if (panel > 0.01f) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f * panel)))

        Column(
            Modifier
                .fillMaxHeight()
                .width(width)
                .padding(if (open) 10.dp else 0.dp)
                .then(if (panel > 0.01f) Modifier.alpha(1f).clip(RoundedCornerShape(22.dp)).background(C.paper2.copy(alpha = 0.98f * panel)) else Modifier)
                .onFocusChanged {
                    if (it.hasFocus && !railFocused) {
                        if (System.currentTimeMillis() - lastLeftAt > 800) { strayTick++; return@onFocusChanged }
                        model.refreshInfo()
                    }
                    railFocused = it.hasFocus
                }
                .onPreviewKeyEvent { e ->
                    // Right from the menu: back to the poster you were on, with its row on screen.
                    if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft) return@onPreviewKeyEvent true // nothing further left
                    // Right or Back: out of the menu, always. Back to the poster you were on if it's still there,
                    // otherwise to the screen itself (a poster that was rebuilt meanwhile used to leave you stuck here).
                    if (e.key == Key.DirectionRight || e.key == Key.Back) {
                        if (e.type == KeyEventType.KeyDown) {
                            try { hook.fn?.invoke() } catch (_: Exception) { }
                            railScope.launch {
                                kotlinx.coroutines.delay(80)
                                if (railFocused) try { contentFocus.requestFocus() } catch (_: Exception) { }
                                kotlinx.coroutines.delay(80)
                                if (railFocused) focusManager.moveFocus(FocusDirection.Right)
                            }
                        }
                        true
                    } else false
                }
                .focusProperties { enter = { currentReq } }
                .focusGroup()
                .padding(horizontal = if (open) 8.dp else 14.dp, vertical = if (open) 14.dp else 24.dp),
            verticalArrangement = Arrangement.spacedBy(if (info.inRoom) 0.dp else 4.dp)
        ) {
            // The Reddate mark always; the name only in the open panel.
            Row(Modifier.padding(start = 12.dp, bottom = 12.dp).height(30.dp), verticalAlignment = Alignment.CenterVertically) {
                RedMark(26.dp); Spacer(Modifier.width(10.dp))
                Text("Reddate", color = C.ink, style = MaterialTheme.typography.titleLarge, maxLines = 1, softWrap = false, modifier = Modifier.alpha(panel))
            }
            RailRow(info.profile.ifEmpty { "Profile" }, panel, current == "profiles", sub = "Switch profile", requester = req("profiles"),
                lead = { Avatar(info.profile.ifEmpty { "?" }, 30.dp) }, onClick = { model.go(Screen.Profiles) })
            Spacer(Modifier.height(if (info.inRoom) 2.dp else 8.dp))
            RailRow("Search", panel, current == "search", icon = Icons.Default.Search, requester = req("search")) { if (current != "search") model.go(Screen.Search) }
            RailRow("Home", panel, current == "home", icon = Icons.Default.Home, requester = req("home")) { model.home() }
            RailRow("My List", panel, current == "mylist", icon = Icons.Default.Favorite, requester = req("mylist")) { if (current != "mylist") model.go(Screen.MyList) }
            // Leaving the player already ends the room, so there's no "Now playing" to go back to. Only a room
            // that has no video yet (a lobby you opened) needs a way out here.
            // A room with a video you stepped out of (to pick another, say): a way back to it, and a way out.
            if (info.inRoom && info.nowPlaying.isNotEmpty()) RailRow("Back to the video", panel, false, icon = Icons.Default.PlayArrow) { model.resume() }
            if (info.inRoom) RailRow(if (info.isGuest) "Leave the party" else "Leave room", panel, false, icon = Icons.Default.Close) { model.leaveRoom() }
            if (info.inRoom) RailRow(if (model.chatUnread > 0) "Chat · ${model.chatUnread}" else "Chat", panel, false, icon = Icons.Default.Email, live = model.chatUnread > 0) { model.openChat() }
            RailRow("Calendar", panel, current == "calendar", icon = Icons.Default.DateRange, requester = req("calendar")) { if (current != "calendar") model.go(Screen.Calendar) }
            RailRow("Tonight's Pick", panel, current == "pick", icon = Icons.Default.Refresh) { if (current != "pick") model.go(Screen.Pick) }
            if (!info.inRoom) RailRow("Party", panel, false, icon = Icons.Default.Share) { model.dialog = Dlg.Together }
            RailRow("Addons", panel, current == "addons", icon = Icons.Default.Add, requester = req("addons")) { if (current != "addons") model.go(Screen.Addons) }
            // The rest sits at the bottom, out of the way of everyday use.
            Spacer(Modifier.weight(1f))
            if (model.update != null) RailRow("Update available", panel, false, icon = Icons.Default.KeyboardArrowDown, live = true) { model.dialog = Dlg.Update }
            RailRow("Account", panel, current == "account" || current == "report", icon = Icons.Default.Settings, requester = req("account")) { if (current != "account") model.go(Screen.Account) }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun RailRow(
    label: String, labels: Float, selected: Boolean, sub: String? = null,
    icon: ImageVector? = null, lead: (@Composable () -> Unit)? = null, live: Boolean = false, requester: FocusRequester? = null, onClick: () -> Unit
) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(if (sub != null) 54.dp else 46.dp).then(if (requester != null) Modifier.focusRequester(requester) else Modifier).onFocusChanged { focused = it.isFocused },
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1f),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = if (selected) C.ink else C.muted,
            focusedContainerColor = C.ink, focusedContentColor = C.paper,
            pressedContainerColor = C.ink, pressedContentColor = C.paper
        )
    ) {
        Box(Modifier.fillMaxSize()) {
            // The screen you're on: a small accent bar at the left edge.
            if (selected && !focused) Box(Modifier.align(Alignment.CenterStart).width(3.dp).height(20.dp).clip(RoundedCornerShape(2.dp)).background(C.accent))
            Row(Modifier.fillMaxSize().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(30.dp), contentAlignment = Alignment.Center) {
                    if (lead != null) lead() else if (icon != null) Icon(icon, contentDescription = label, modifier = Modifier.size(24.dp))
                    if (live) Box(Modifier.align(Alignment.TopEnd).size(8.dp).clip(androidx.compose.foundation.shape.CircleShape).background(C.accent))
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.alpha(labels).clipToBounds()) {
                    Text(label, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Clip, softWrap = false)
                    if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, maxLines = 1, softWrap = false)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
/** Height of the details area above the single row (the backdrop behind fills the whole screen). */
private const val HERO_H = 390
/** While browsing the rows: the details shrink to a strip at the top, leaving room for two rows. */
private const val HERO_COMPACT_H = 150

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun HomeScreen(model: AppModel) {
    val inset = LocalRailInset.current
    // Whenever Home comes back into view (from a title, the player, another screen), refresh Continue watching.
    LaunchedEffect(Unit) { model.loadContinue() }
    LaunchedEffect(model.info.profileId) { model.loadMyList() }
    val rows = model.rows
    // Focus changes are read only inside effects, never in composition, so moving the remote
    // doesn't recompose the whole screen.
    val focused = remember { mutableStateOf<Meta?>(null) }
    val hero = remember { mutableStateOf<Meta?>(null) }
    // In the rows (not on the banner's buttons): the banner shrinks to a details strip and slides up.
    val inRows = remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { snapshotFlow { inRows.value }.collect { model.chromeHidden = it } }
    LaunchedEffect(Unit) {
        snapshotFlow { focused.value }.collectLatest { m ->
            if (m != null) { kotlinx.coroutines.delay(420); hero.value = m } // after the remote settles
        }
    }
    val first = rows.firstOrNull()?.items?.value?.firstOrNull()
    val firstFocus = remember { FocusRequester() }
    val appContext = androidx.compose.ui.platform.LocalContext.current
    var focusedOnce by remember { mutableStateOf(false) }
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(Unit) {
        snapshotFlow { inRows.value }.collect { r -> if (!r && listState.firstVisibleItemIndex + listState.firstVisibleItemScrollOffset > 0) listState.glideTo(0) }
    }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val requesters = remember { HashMap<String, FocusRequester>() }
    // One row at a time, as big as the space under the folded banner allows (Nuvio / Google TV style).
    val screenH = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp
    // Reserve space for row headings, focus rings and card captions. Rows can grow for larger text.
    val rowHeight = ((screenH - 14 - HERO_COMPACT_H) / 2f).coerceAtLeast(180f)
    val posterW = ((rowHeight - 96f) / 1.5f).coerceIn(80f, 136f)
    val cwW = (posterW * 1.5f * 16f / 9f).coerceAtMost(300f)
    val cwOffset0 = if (model.continueItems.isNotEmpty()) 1 else 0
    // Rows from addons start after Continue watching and My List (when there's anything in them).
    val cwOffset = cwOffset0 + if (model.myList.isNotEmpty()) 1 else 0
    // The list never drifts to follow focus; landing on a row brings that whole row up, alone.
    fun goRow(i: Int) {
        if (listState.firstVisibleItemIndex == i && listState.firstVisibleItemScrollOffset == 0) return
        scope.launch { listState.glideTo(i) }
    }
    val last = remember { arrayOf(model.homeLastRow, model.homeLastPoster) } // row key, poster id
    val hook = LocalEnterHook.current
    androidx.compose.runtime.DisposableEffect(rows) {
        hook.fn = {
            scope.launch {
                val idx = rows.indexOfFirst { it.row.key == last[0] }
                val req = requesters["${last[0]}|${last[1]}"]
                if (idx >= 0 && req != null) {
                    // Put that row on screen first, then focus the poster.
                    listState.glideTo(idx + cwOffset)
                    kotlinx.coroutines.delay(60)
                    try { req.requestFocus() } catch (_: Exception) { try { firstFocus.requestFocus() } catch (_: Exception) { } }
                } else {
                    try { firstFocus.requestFocus() } catch (_: Exception) { }
                }
            }
        }
        onDispose { if (hook.fn != null) hook.fn = null }
    }

    Box(Modifier.fillMaxSize().background(C.paper)) {
        HeroBackdrop(hero, first, inRows)
        Column(Modifier.fillMaxSize()) {
        // The banner stays put; the rows glide underneath it, the focused row always first.
        HeroText(hero, first, model.rowsLoading, firstFocus, model, inRows)
        NoFollow { LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().weight(1f).padding(start = inset).clipToBounds(),
            contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            if (!model.rowsLoading && rows.isEmpty()) item(key = "empty") {
                Column(Modifier.padding(start = 28.dp, end = 40.dp)) {
                    Text("Home is empty. Add a catalog addon to choose what shows here.", color = C.muted)
                    Spacer(Modifier.height(12.dp))
                    PillButton("Add addons", { model.go(Screen.Addons) }, primary = true)
                }
            }
            val cw = model.continueItems
            if (cw.isNotEmpty()) item(key = "continue") {
                Column(Modifier.heightIn(min = rowHeight.dp).padding(bottom = 12.dp)) {
                    Row(Modifier.padding(start = 28.dp), verticalAlignment = Alignment.Bottom) {
                        SectionTitle("Continue watching")
                        Text("  ·  Hold OK for options", style = MaterialTheme.typography.labelMedium, color = C.muted, modifier = Modifier.padding(bottom = 11.dp))
                    }
                    Spacer(Modifier.height(10.dp))
                    HorizontalPin { LazyRow(
                        modifier = Modifier.onPreviewKeyEvent { e ->
                            if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionUp) {
                                inRows.value = false
                                scope.launch { kotlinx.coroutines.delay(40); try { firstFocus.requestFocus() } catch (_: Exception) { } }
                                true
                            } else false
                        },
                        contentPadding = PaddingValues(start = 28.dp, end = 40.dp, top = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        items(cw, key = { it.key }) { c -> ContinueCard(c, onFocus = {
                            inRows.value = true
                            focused.value = Meta(c.show.ifEmpty { c.id }, c.type, c.name, c.art, c.art, "", c.subtitle, "")
                            goRow(0)
                        }, onLong = { model.dialog = Dlg.RemoveContinue(c) }, width = cwW.dp) { model.resume(c) } }
                    } }
                }
            }
            val saved = model.myList.toList()
            if (saved.isNotEmpty()) item(key = "mylist") {
                Column(Modifier.heightIn(min = rowHeight.dp).padding(bottom = 12.dp)) {
                    SectionTitle("My List", Modifier.padding(start = 28.dp))
                    Spacer(Modifier.height(10.dp))
                    HorizontalPin { LazyRow(contentPadding = PaddingValues(start = 28.dp, end = 40.dp, top = 8.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(saved, key = { "ml:" + it.id }) { m ->
                            PosterCard(m, onClick = { model.go(Screen.Title(m)) }, width = posterW.dp, showTitle = true, onFocus = { inRows.value = true; focused.value = m; goRow(cwOffset0) })
                        }
                    } }
                }
            }
            itemsIndexed(rows, key = { _, it -> it.row.key }) { rowIndex, rd ->
                LaunchedEffect(rd.row.key) { model.ensureRow(rd) } // loads when it's composed (near the screen)
                val items = rd.items.value
                if (rd.failed.value) return@itemsIndexed
                Column(Modifier.heightIn(min = rowHeight.dp).padding(bottom = 12.dp)) {
                    Row(Modifier.padding(start = 28.dp), verticalAlignment = Alignment.CenterVertically) {
                        val logo = rd.logo.value
                        if (logo.isNotEmpty()) {
                            Img(logo, Modifier.padding(bottom = 10.dp, end = 10.dp).size(26.dp).clip(RoundedCornerShape(6.dp)), scale = androidx.compose.ui.layout.ContentScale.Fit)
                        }
                        SectionTitle(rd.row.title)
                    }
                    Spacer(Modifier.height(10.dp))
                    val mem = remember(rd.row.key) { RowMemory() }
                    HorizontalPin { LazyRow(
                        modifier = Modifier.restoreFocus(mem).then(if (rows.firstOrNull() === rd && model.continueItems.isEmpty()) Modifier.onPreviewKeyEvent { e ->
                            // Up from the first row: unfold the banner, then focus its Play button.
                            if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionUp) {
                                inRows.value = false
                                scope.launch { kotlinx.coroutines.delay(40); try { firstFocus.requestFocus() } catch (_: Exception) { } }
                                true
                            } else false
                        } else Modifier),
                        contentPadding = PaddingValues(start = 28.dp, end = 40.dp, top = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        if (items.isEmpty()) {
                            items(List(8) { it }) { Box(Modifier.width(posterW.dp).height((posterW * 1.5f).dp).clip(RoundedCornerShape(10.dp)).background(C.paper2)) }
                        } else {
                            items(items, key = { it.id }) { m ->
                                val k = "${rd.row.key}|${m.id}"
                                val req = remember(k) { requesters.getOrPut(k) { FocusRequester() } }
                                PosterCard(
                                    m, onClick = { model.go(Screen.Title(m)) }, width = posterW.dp, showTitle = true,
                                    onFocus = {
                                        goRow(rowIndex + cwOffset)
                                        inRows.value = true; focused.value = m; last[0] = rd.row.key; last[1] = m.id; model.homeLastRow = rd.row.key; model.homeLastPoster = m.id; mem.last = m.id
                                        // Fetch the big pictures of the neighbours now, so they're ready when the remote gets there.
                                        val i = items.indexOf(m)
                                        for (j in listOf(i + 1, i - 1, i + 2)) items.getOrNull(j)?.heroImage?.takeIf { it.startsWith("http") }?.let { u ->
                                            coil.Coil.imageLoader(appContext).enqueue(coil.request.ImageRequest.Builder(appContext).data(u).build())
                                        }
                                    },
                                    modifier = Modifier.focusRequester(req).also { mem.requesters[m.id] = req }
                                )
                            }
                        }
                    } }
                }
            }
            if (rows.isNotEmpty()) item(key = "customize") {
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                    // Only once every row has its posters: while rows are still loading this button was the one thing focus
                    // could land on, and Down from the banner threw the whole page to the bottom.
                    val allLoaded = rows.all { it.items.value.isNotEmpty() || it.failed.value }
                    PillButton("Customize Home: addons and rows", { model.go(Screen.Addons) }, icon = Icons.Default.Add,
                        modifier = Modifier.focusProperties { down = FocusRequester.Cancel; canFocus = allLoaded }.onFocusChanged { if (it.isFocused) scope.launch { listState.glideTo(rows.size + cwOffset) } })
                }
            }
        } }
        }
    }
    // Open on the poster you were last on (coming back from a title), else on the banner's Play button.
    // Retried: the target may not be attached for a frame or two.
    val wantedRow = rows.firstOrNull { it.row.key == model.homeLastRow }
    val wantedReady = wantedRow == null || wantedRow.items.value.isNotEmpty() || wantedRow.failed.value
    LaunchedEffect(first != null, wantedReady) {
        if (first == null || focusedOnce || !wantedReady) return@LaunchedEffect // only ever waits for the row you were on
        val wantRow = model.homeLastRow
        val idx = if (wantRow.isNotEmpty()) rows.indexOfFirst { it.row.key == wantRow } else -1
        if (idx >= 0) listState.scrollToItem(idx + cwOffset)
        repeat(15) {
            kotlinx.coroutines.delay(80)
            val req = if (idx >= 0) requesters["$wantRow|${model.homeLastPoster}"] else null
            try { (req ?: firstFocus).requestFocus(); focusedOnce = true; return@LaunchedEffect } catch (_: Exception) { }
        }
    }
}

/** The big picture behind everything; changes with a soft crossfade, and only reads state itself. */
@Composable
private fun HeroBackdrop(hero: State<Meta?>, first: Meta?, inRows: State<Boolean>) {
    val shown = hero.value ?: first
    val h = 1f // the picture fills the screen; the row sits on its lower edge
    // Keep the current picture until the next one has downloaded, so moving along a row never flashes dark.
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val want = shown?.heroImage ?: ""
    var showing by remember { mutableStateOf("") }
    LaunchedEffect(want) {
        if (want.isEmpty()) return@LaunchedEffect
        kotlinx.coroutines.delay(120) // not for every poster the remote flicks past
        val r = coil.Coil.imageLoader(ctx).execute(coil.request.ImageRequest.Builder(ctx).data(want).build())
        if (r is coil.request.SuccessResult) showing = want
    }
    // Like Nuvio: the picture is a big rectangle in the top-right corner that melts into the dark page on its left
    // and bottom edges; the text and the rows sit on plain dark, never on the picture.
    Box(Modifier.fillMaxSize()) {
        // The picture fills the whole screen; dark falls in from the left (behind the text) and the bottom (behind the rows).
        Crossfade(targetState = showing, animationSpec = tween(520, easing = emphasized), label = "hero", modifier = Modifier.fillMaxSize()) { url ->
            Img(url, Modifier.fillMaxSize(), alignment = Alignment.TopCenter)
        }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to C.paper.copy(alpha = 0.96f), 0.34f to C.paper.copy(alpha = 0.78f), 0.68f to C.paper.copy(alpha = 0.08f))))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.42f to C.paper.copy(alpha = 0f), 0.72f to C.paper.copy(alpha = 0.82f), 1f to C.paper)))
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun HeroText(hero: State<Meta?>, first: Meta?, loading: Boolean, firstFocus: FocusRequester, model: AppModel, inRows: androidx.compose.runtime.MutableState<Boolean>) {
    val shown = hero.value ?: first
    val compact = inRows.value
    val height by animateDpAsState(if (compact) HERO_COMPACT_H.dp else HERO_H.dp, tween(420, easing = emphasized), label = "heroH")
    val buttons by animateFloatAsState(if (compact) 0f else 1f, tween(260), label = "heroButtons")
    val titleSize by animateFloatAsState(if (compact) 30f else 64f, tween(420, easing = emphasized), label = "titleSize")
    // Starts near the top of the screen: the text hugs the top edge, and the rows below move up with it.
    Column(Modifier.padding(start = LocalRailInset.current + 22.dp, top = 14.dp, end = 40.dp).height(height).padding(bottom = 18.dp).clipToBounds(), verticalArrangement = if (compact) Arrangement.Top else Arrangement.Bottom) {
        if (shown != null) {
            // Little tags above the title: its rank when it's in a Top 10, and what kind of title it is.
            Row(Modifier.padding(start = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (shown.rank > 0) HeroTag("#${shown.rank} in Top 10 today", accent = true)
                HeroTag(when { shown.isSeries -> "Series"; shown.type == "movie" -> "Movie"; shown.type == "tv" -> "Live TV"; shown.type == "channel" -> "Channel"; else -> shown.type.replaceFirstChar { it.uppercase() }.take(14).ifEmpty { "Video" } })
                if (model.inMyList(shown.id)) HeroTag("✓ In My List")
            }
            Spacer(Modifier.height(10.dp))
            Text(shown.name, style = MaterialTheme.typography.displayLarge.copy(fontSize = titleSize.sp, lineHeight = (titleSize + 2).sp), color = C.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 6.dp).widthIn(max = 760.dp))
            if (shown.facts.isNotEmpty()) Text(shown.facts, style = MaterialTheme.typography.bodyMedium, color = C.muted, modifier = Modifier.padding(start = 6.dp, top = 6.dp))
            if (shown.description.isNotEmpty()) Text(shown.description, style = MaterialTheme.typography.bodyMedium, color = C.ink, maxLines = if (compact) 2 else 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 6.dp).widthIn(max = 560.dp).padding(top = 6.dp))
            // Folds away while you browse the rows; Up from the first row brings it back.
            Row(Modifier.padding(top = (14 * buttons).dp).height((64 * buttons).dp).alpha(buttons).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // While folded away they can't take focus (Left from a row goes to the menu, not here).
                val back = Modifier.onFocusChanged { if (it.isFocused) inRows.value = false }.focusProperties { canFocus = !compact }
                PillButton("Play", { model.go(Screen.Title(shown, autoPlay = true)) }, primary = true, icon = Icons.Default.PlayArrow, modifier = Modifier.focusRequester(firstFocus).then(back))
                PillButton("Watch together", { model.dialog = Dlg.Together }, icon = Icons.Default.Share, modifier = back)
                val saved = model.inMyList(shown.id)
                PillButton(if (saved) "In My List" else "My List", { model.toggleMyList(shown) }, icon = if (saved) Icons.Default.Check else Icons.Default.Add, modifier = back)
                PillButton("Pick for me", { model.go(Screen.Pick) }, icon = Icons.Default.Refresh, modifier = back)
                PillButton("Details", { model.go(Screen.Title(shown)) }, icon = Icons.Default.Info, modifier = back)
            }
        } else if (loading) {
            Text("Loading…", color = C.muted)
        }
    }
}

@Composable
private fun HeroTag(text: String, accent: Boolean = false) {
    Text(text, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), color = if (accent) C.accentInk else C.ink,
        modifier = Modifier.clip(RoundedCornerShape(7.dp)).background(if (accent) C.accent else C.ink.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp))
}

/** The local time as "21:40" (or "9:40 PM" when the TV is set to 12-hour); it ticks on the minute. */
@Composable
private fun ClockText() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var now by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        while (true) {
            val is24 = android.text.format.DateFormat.is24HourFormat(ctx)
            val fmt = java.text.SimpleDateFormat(if (is24) "HH:mm" else "h:mm a", java.util.Locale.getDefault())
            val t = System.currentTimeMillis()
            now = fmt.format(java.util.Date(t))
            kotlinx.coroutines.delay(60_000L - t % 60_000L + 50L) // wake just after the next minute begins
        }
    }
    Text(now, style = MaterialTheme.typography.titleMedium.copy(fontSize = 18.sp), color = C.ink.copy(alpha = 0.9f))
}
