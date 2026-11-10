package xyz.reddate.tv.ui

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONArray
import org.json.JSONObject
import xyz.reddate.tv.Engine
import xyz.reddate.tv.objects
import xyz.reddate.tv.str

sealed class Screen {
    object Home : Screen()
    data class Title(val meta: Meta, val autoPlay: Boolean = false, val episodeId: String = "", val startAt: Int = 0) : Screen()
    object Search : Screen()
    object Link : Screen()
    object Profiles : Screen()
    object Addons : Screen()
    object Account : Screen()
    object Report : Screen()
    /** Titles you saved with "My List", for this profile on this TV. */
    object MyList : Screen()
    /** What is coming out: cinemas, digital / VOD, new TV episodes. */
    object Calendar : Screen()
    /** Trakt, WeTrakr and Simkl: connect with a code, choose whether what you watch is reported. */
    object Services : Screen()
    /** Tonight's Pick: the TV spins through your titles and lands on one. */
    object Pick : Screen()
    /** An actor or crew member: their picture and the titles of theirs your catalog has. */
    data class Actor(val name: String, val photo: String = "", val role: String = "") : Screen()
}

sealed class Dlg {
    /** "Watch alone or together?" before the first video starts a room. */
    data class WatchChoice(val label: String, val payload: JSONObject) : Dlg()
    object Invite : Dlg()
    /** "Invited? Enter the code to join the party." */
    object JoinCode : Dlg()
    /** Long press on a Continue watching card. */
    data class RemoveContinue(val item: CwItem) : Dlg()
    /** Check for and install a new version of the app. */
    object Update : Dlg()
    /** You picked something to watch while in someone else's watch party. */
    data class LeaveToPlay(val label: String, val payload: JSONObject) : Dlg()
    /** "Watch together": start a party, or join one with a code. */
    object Together : Dlg()
    /** An addon's own message (donate, Discord…): its link as a QR code to open on the phone. */
    data class AddonNote(val note: StreamNote) : Dlg()
    /** Add a profile (null) or rename / delete one. */
    data class EditProfile(val profile: Profile?) : Dlg()
}

/** A full-screen "working on it" card: the poster breathing, and what's happening. */
data class Busy(val art: String, val title: String, val text: String, val owner: String = "")

data class Person(val name: String, val role: String, val photo: String)
data class Credits(val cast: List<Person>, val crew: List<Pair<String, List<String>>>)

data class StreamNote(val addon: String, val logo: String, val title: String, val text: String, val link: String)

class RowData(val row: Row) {
    val items: MutableState<List<Meta>> = mutableStateOf(emptyList())
    val failed: MutableState<Boolean> = mutableStateOf(false)
    /** A service's own logo, for its Top 10 rows. */
    val logo: MutableState<String> = mutableStateOf("")
    val ranked get() = row.url.contains("/top10/")
}

/** Everything the native screens show, and what they can do. */
class AppModel(private val scope: CoroutineScope) {
    var info by mutableStateOf(AppInfo())
    var rows by mutableStateOf<List<RowData>>(emptyList())
    var continueItems by mutableStateOf<List<CwItem>>(emptyList())
    var rowsLoading by mutableStateOf(true)
    val stack = mutableStateListOf<Screen>(Screen.Home)
    // Search lives here, not in the screen, so coming back from a title shows the same results.
    // What you searched for lately (newest first, up to 12), kept per profile on this TV. You can remove one or all.
    val recentSearches = mutableStateListOf<String>()
    private fun recentKey() = "recent:${info.profileId.ifEmpty { "default" }}"
    private fun recentPrefs() = xyz.reddate.tv.ReddateApp.instance.getSharedPreferences("search", android.content.Context.MODE_PRIVATE)
    fun loadRecents() {
        val raw = recentPrefs().getString(recentKey(), "") ?: ""
        recentSearches.clear()
        recentSearches.addAll(raw.split('\n').map { it.trim() }.filter { it.isNotEmpty() }.take(12))
    }
    private fun saveRecents() { recentPrefs().edit().putString(recentKey(), recentSearches.joinToString("\n")).apply() }
    fun addRecent(q: String) {
        val t = q.trim().replace('\n', ' ')
        if (t.length < 2) return
        recentSearches.removeAll { it.equals(t, ignoreCase = true) }
        recentSearches.add(0, t)
        while (recentSearches.size > 12) recentSearches.removeAt(recentSearches.size - 1)
        saveRecents()
    }
    fun removeRecent(q: String) { recentSearches.remove(q); saveRecents() }
    fun clearRecents() { recentSearches.clear(); saveRecents() }

    // My List: titles saved for later, per profile, newest first. Kept on this TV (like recent searches).
    val myList = mutableStateListOf<Meta>()
    private fun listKey() = "mylist:${info.profileId.ifEmpty { "default" }}"
    private fun listPrefs() = xyz.reddate.tv.ReddateApp.instance.getSharedPreferences("mylist", android.content.Context.MODE_PRIVATE)
    fun loadMyList() {
        val raw = listPrefs().getString(listKey(), "[]") ?: "[]"
        myList.clear()
        try { myList.addAll(JSONArray(raw).objects().map { metaFromJson(it) }) } catch (_: Exception) { }
    }
    fun inMyList(id: String) = myList.any { it.id == id }
    fun toggleMyList(m: Meta) {
        if (inMyList(m.id)) { myList.removeAll { it.id == m.id }; say("Removed from My List") }
        else { myList.add(0, m.copy(episodes = emptyList(), similar = emptyList())); say("Added to My List") }
        listPrefs().edit().putString(listKey(), JSONArray(myList.map { metaToJson(it) }).toString()).apply()
    }
    /** Home hides the top bar while you browse its rows (it comes back with Up), like the big streaming apps. */
    var chromeHidden by mutableStateOf(false)

    var searchQ by mutableStateOf("")
    var searchFor by mutableStateOf("")             // the text the results below are for
    var searchResults by mutableStateOf<List<Meta>?>(null)
    var searchLastId by mutableStateOf("")          // the result you opened last: focus returns to it
    var busy by mutableStateOf<Busy?>(null)
    /** The title's picture kept behind the "How do you want to watch?" question and until the player opens, so Home doesn't show through. */
    var backdrop by mutableStateOf<Busy?>(null)
    var backdropHold = false
    private var busyJob: Job? = null
    /** Back on the loading card: stop what it was doing. */
    fun cancelBusy() { busyJob?.cancel(); busyJob = null; busy = null }

    var dialog by mutableStateOf<Dlg?>(null)
    var toast by mutableStateOf<String?>(null)
    private var toastJob: Job? = null

    val screen: Screen get() = stack.last()

    /** Where you were on Home (row key, poster id), so coming back lands on the same poster. */
    var homeLastRow: String = ""
    var homeLastPoster: String = ""

    /** A newer version of the app than the installed one, when the server has one. */
    var update by mutableStateOf<xyz.reddate.tv.Updater.Info?>(null)
    private var lastUpdateCheck = 0L
    fun checkUpdate(installed: Int, force: Boolean = false) = scope.launch {
        if (!force && System.currentTimeMillis() - lastUpdateCheck < 20 * 60_000L) return@launch
        lastUpdateCheck = System.currentTimeMillis()
        val l = xyz.reddate.tv.Updater.latest() ?: return@launch
        update = if (l.code > installed) l else null
    }

    // Chat while you're not in the player (it shows chat itself): a short line on screen and a count on the rail.
    var chatUnread by mutableStateOf(0)
    fun onChat(user: String, text: String, self: Boolean) {
        if (self || text.isBlank() || xyz.reddate.tv.PlayerActivity.current != null) return
        chatUnread++
        say("${user.ifBlank { "Someone" }.take(24)}: ${text.take(120)}")
    }
    fun openChat() { chatUnread = 0; openWeb("chat") }

    fun say(msg: String) {
        toast = msg
        toastJob?.cancel()
        toastJob = scope.launch { delay(3500); toast = null }
    }

    fun refreshInfo() = scope.launch {
        try {
            (Engine.call("state") as? JSONObject)?.let {
                info = parseInfo(it)
                xyz.reddate.tv.ReddateApp.instance.getSharedPreferences("session", android.content.Context.MODE_PRIVATE).edit().putString("pid", info.profileId).apply()
            }
        } catch (_: Exception) { }
    }

    /** Back on screen or woken up: pick up what was saved from the phone while the TV wasn't looking. */
    fun refreshVault() = scope.launch { try { Engine.call("refreshVault", timeoutMs = 25_000) } catch (_: Exception) { } }

    fun loadContinue() = scope.launch {
        continueItems = try {
            (Engine.call("continueRow") as? JSONArray).objects().map {
                CwItem(it.str("k"), it.str("id"), it.str("t"), it.str("sh"), it.str("n"), it.str("a"), it.optInt("p"), it.optInt("d"), it.optInt("next") == 1)
            }.filter { it.key.isNotEmpty() && it.id.isNotEmpty() }
        } catch (_: Exception) { continueItems }
    }

    /** Leave the room on purpose (ends "Now playing"). */
    fun leaveRoom(then: (() -> Unit)? = null) = scope.launch {
        try { Engine.call("leaveRoom") } catch (_: Exception) { }
        delay(300)
        refreshInfo().join()
        if (then != null) then() else say("You left the room")
    }

    fun forgetContinue(item: CwItem) = scope.launch {
        try { Engine.call("forgetContinue", JSONObject().put("k", item.key)) } catch (_: Exception) { }
        continueItems = continueItems.filter { it.key != item.key }
        say("Removed from Continue watching")
    }

    /** Continue watching: same kind of stream as last time, starting where you stopped. */
    /** Open a Continue watching item's streams to pick another one; it carries on from the same place. */
    fun chooseStream(item: CwItem) {
        val isShow = item.show.isNotEmpty()
        val m = Meta(
            id = if (isShow) item.show else item.id, type = if (isShow) "series" else item.type.ifEmpty { "movie" },
            name = item.name, poster = "", background = item.art, description = "", releaseInfo = "", rating = ""
        )
        go(Screen.Title(m, episodeId = if (isShow) item.id else "", startAt = item.pos))
    }

    /**
     * Continue watching: ask for the streams that match what was chosen before (same addon, quality, language,
     * source), check which of the closest few actually answer right now, and start the first one that does,
     * from the same place. The rest stay as fallbacks if it stalls.
     */
    fun resume(item: CwItem) {
        busyJob?.cancel()
        busyJob = scope.launch {
            busy = Busy(item.art, item.name, "Finding your stream…", "resume")
            try {
                val r = Engine.call("resolveResume", JSONObject().put("k", item.key), timeoutMs = 45_000) as? JSONObject ?: return@launch
                val payload = r.optJSONObject("payload") ?: return@launch
                val label = r.str("label").ifEmpty { item.name }
                val cands = r.optJSONArray("candidates").objects().map(::parseStream)
                var pick = cands.firstOrNull()
                if (cands.size > 1) {
                    busy = busy?.copy(text = "Checking the link…")
                    // Quick ranged request to each of the closest few, all at once: a dead link answers with an
                    // error or not at all, a live one with data within a second or two.
                    val top = cands.take(5)
                    val results = java.util.concurrent.ConcurrentHashMap<String, xyz.reddate.tv.StreamProbe.Result>()
                    kotlinx.coroutines.withTimeoutOrNull(4_000) {
                        xyz.reddate.tv.StreamProbe.probeAll(top.map { it.url to it.bitrate }, sampleBytes = 48 * 1024) { u, res -> results[u] = res }
                    }
                    val good = { s: Stream -> results[s.url]?.grade.let { it != null && it != xyz.reddate.tv.StreamProbe.Grade.FAILED } }
                    pick = top.firstOrNull(good) ?: top.firstOrNull { results[it.url] == null } ?: cands.first()
                }
                val chosen = pick ?: run { say("No streams found for this right now"); return@launch }
                val ordered = listOf(chosen) + cands.filter { it.url != chosen.url }
                val content = payload.optJSONObject("content")
                attempt = Attempt(ordered, 0, label, content?.str("type").orEmpty().ifEmpty { item.type }, content?.str("id").orEmpty().ifEmpty { item.id },
                    content?.str("art").orEmpty(), content?.str("show").orEmpty(), startAt = item.pos)
                payload.put("src", chosen.url)
                toast = null
                backdropHold = false
                backdrop = Busy(content?.str("art").orEmpty().ifEmpty { item.art }, label, "")
                start(label, payload)
                kotlinx.coroutines.delay(1500) // the player (or the question) is about to cover this
            } catch (e: kotlinx.coroutines.CancellationException) { throw e
            } catch (e: Exception) { say(e.message ?: "Couldn’t resume that")
            } finally { busy = null }
        }
    }

    var rowsVersion by mutableStateOf(0)
    fun loadRows() = scope.launch {
        rowsVersion++
        loadContinue()
        rowsLoading = true
        val list = try { (Engine.call("rows") as? JSONArray).objects().map { Row(it.str("key"), it.str("title"), it.str("type"), it.str("url")) }.distinctBy { it.key } } catch (_: Exception) { emptyList() }
        // Same rows as on screen: keep them (and the remote's place) instead of rebuilding Home.
        if (list.isNotEmpty() && list == rows.map { it.row } && rows.none { it.failed.value }) { rowsLoading = false; return@launch }
        val data = list.map { RowData(it) }
        rows = data
        rowsLoading = false
        // Only the top rows now; each lower row loads when it comes near the screen (ensureRow), so
        // dozens of addons' rows don't all fetch at launch.
        rowStarted.clear()
        data.take(6).forEach { ensureRow(it) }
    }

    private val rowGate = Semaphore(4)
    private val rowStarted = HashSet<String>()

    /** Fetch a row's posters (once). Called for the first rows, then as each row scrolls toward the screen. */
    fun ensureRow(rd: RowData) {
        if (!rowStarted.add(rd.row.key)) return
        scope.launch {
            rowGate.withPermit {
                try {
                    val o = Engine.getJson(rd.row.url) as? JSONObject
                    rd.logo.value = o?.optString("logo", "")?.takeIf { it.startsWith("https://") } ?: ""
                    val metas = (o?.optJSONArray("metas")).objects()
                        .map { parseMeta(it, rd.row.type) }.filter { it.id.isNotEmpty() && it.name != "Untitled" }.distinctBy { it.id }.take(30)
                    rd.items.value = metas
                    if (metas.isEmpty()) rd.failed.value = true
                } catch (_: Exception) { rd.failed.value = true }
            }
        }
    }

    fun go(s: Screen) { stack.add(s) }
    fun back(): Boolean {
        if (dialog != null) { dialog = null; return true }
        if (stack.size > 1) { stack.removeAt(stack.size - 1); return true }
        return false
    }
    fun home() { while (stack.size > 1) stack.removeAt(stack.size - 1) }

    suspend fun meta(m: Meta): Meta = try {
        (Engine.call("meta", JSONObject().put("type", m.type).put("id", m.id)) as? JSONObject)?.let { parseMeta(it, m.type) } ?: m
    } catch (_: Exception) { m }

    /** Streams for a title; [key] is the show (or movie) whose remembered choice they're compared with. */
    /** Cast (with photos) and the main crew, from our server (TMDB), by IMDb id. */
    suspend fun credits(type: String, id: String): Credits? = try {
        val u = android.net.Uri.parse(xyz.reddate.tv.BuildConfig.START_URL)
        val o = Engine.getJson("${u.scheme}://${u.authority}/api/credits/$type/${java.net.URLEncoder.encode(id, "UTF-8")}") as? JSONObject
        o?.let {
            Credits(
                it.optJSONArray("cast").objects().map { p -> Person(p.str("name"), p.str("role"), p.str("photo")) }.filter { p -> p.name.isNotEmpty() },
                it.optJSONArray("crew").objects().map { g -> g.str("job") to (0 until (g.optJSONArray("names")?.length() ?: 0)).map { i -> g.optJSONArray("names")!!.optString(i) } }
            )
        }
    } catch (_: Exception) { null }

    /** An actor's picture, what they're known for, and their best-known titles (our server, TMDB). */
    suspend fun person(name: String): Triple<String, String, List<Meta>>? = try {
        val u = android.net.Uri.parse(xyz.reddate.tv.BuildConfig.START_URL)
        val o = Engine.getJson("${u.scheme}://${u.authority}/api/person?name=${java.net.URLEncoder.encode(name, "UTF-8")}") as? JSONObject
        o?.let { Triple(it.str("photo"), it.str("known"), it.optJSONArray("metas").objects().map { m -> parseMeta(m) }.filter { m -> m.poster.isNotEmpty() }) }
    } catch (_: Exception) { null }

    /** Why a lookup came back empty: how many addons were asked, and how many only had torrents. */
    suspend fun streamWhy(type: String, id: String): String = try {
        val o = Engine.call("streamInfo", JSONObject().put("type", type).put("id", id)) as? JSONObject
        when {
            o == null -> ""
            o.optInt("torrents") > 0 && o.optInt("answered") == o.optInt("torrents") + o.optInt("messages") ->
                "${o.optInt("torrents")} torrent-only source${if (o.optInt("torrents") == 1) "" else "s"} found. Torrents need a debrid service (TorBox, Real-Debrid…) to play, and none of your stream addons turns them into a link."
            o.optInt("asked") == 0 -> "None of your stream addons answers for this kind of title (${o.optInt("enabledStreamAddons")} stream addon${if (o.optInt("enabledStreamAddons") == 1) "" else "s"} on). Check Addons. Anything you add on your phone shows up there by itself."
            else -> "${o.optInt("asked")} stream addon${if (o.optInt("asked") == 1) "" else "s"} checked, none had a playable link for this."
        }
    } catch (_: Exception) { "" }

    suspend fun streamNotes(type: String, id: String): List<StreamNote> = try {
        (Engine.call("streamNotes", JSONObject().put("type", type).put("id", id)) as? JSONArray).objects().map {
            StreamNote(it.str("addon"), it.str("logo"), it.str("title"), it.str("text"), it.str("link"))
        }.filter { it.title.isNotEmpty() || it.text.isNotEmpty() }
    } catch (_: Exception) { emptyList() }

    private fun parseStream(it: JSONObject) = Stream(it.str("url"), it.str("addon"), it.str("name"), it.str("title"), it.str("quality"), it.str("filename"), it.str("logo"),
        it.optDouble("bitrate", 0.0), it.optInt("match", 0), it.str("matchWhy"), it.optBoolean("matchExact"))

    /** What slower addons have answered since the list was first shown, and how many are still working. */
    suspend fun streamsMore(type: String, id: String, key: String = ""): Pair<List<Stream>, Int>? = try {
        val o = Engine.call("streamsMore", JSONObject().put("type", type).put("id", id).put("key", key), timeoutMs = 20_000) as? JSONObject
        o?.let { (it.optJSONArray("streams").objects().map(::parseStream)).let { l -> markUsual(l) } to it.optInt("pending") }
    } catch (_: Exception) { null }

    suspend fun streams(type: String, id: String, key: String = ""): List<Stream> =
        markUsual((Engine.call("streams", JSONObject().put("type", type).put("id", id).put("key", key), timeoutMs = 45_000) as? JSONArray).objects().map(::parseStream))

    /** "Your usual" is the closest match to what you chose before: at most two streams, never "everything similar". */
    private fun markUsual(list: List<Stream>): List<Stream> {
        val best = list.filter { it.matchExact }.maxOfOrNull { it.match } ?: 0
        var starred = 0
        return list.map { s ->
            if (s.matchExact && best >= 14 && s.match == best && starred < 2) { starred++; s.copy(usual = true) } else s
        }
    }

    // ---- network check ----
    /** Each stream's connection test, by url (filled in as the tests finish). */
    val probes = androidx.compose.runtime.mutableStateMapOf<String, xyz.reddate.tv.StreamProbe.Result>()
    /**
     * The quick check first: every stream (up to 60) is pinged at once, so the list can be ordered by reply time within about a
     * second. Returns when done or after [budgetMs]; the speed tests follow in [probeRest].
     */
    suspend fun probe(list: List<Stream>, max: Int = 60, budgetMs: Long = 2200) {
        val urls = rank(list).take(max).map { it.url }.filter { probes[it] == null }
        kotlinx.coroutines.withTimeoutOrNull(budgetMs) {
            xyz.reddate.tv.StreamProbe.pingAll(urls) { url, r -> if (probes[url]?.grade.let { it == null || it == xyz.reddate.tv.StreamProbe.Grade.PINGED }) probes[url] = r }
        }
    }

    /** After the quick check: the speed test for the quickest streams first, then the rest, so none stays "Checking…". */
    suspend fun probeRest(list: List<Stream>) {
        // Anything not pinged yet (slow addons, a long list), then the speed tests: fastest replies first.
        val unpinged = rank(list).filter { probes[it.url] == null }.take(60).map { it.url }
        if (unpinged.isNotEmpty()) xyz.reddate.tv.StreamProbe.pingAll(unpinged) { url, r -> if (probes[url] == null) probes[url] = r }
        fun ms(s: Stream) = probes[s.url]?.takeIf { it.grade != xyz.reddate.tv.StreamProbe.Grade.FAILED }?.ms ?: Int.MAX_VALUE
        val order = list.distinctBy { it.url }.filter { probes[it.url]?.grade == xyz.reddate.tv.StreamProbe.Grade.PINGED }.sortedBy { ms(it) }.take(40).map { it.url to it.bitrate }
        xyz.reddate.tv.StreamProbe.probeAll(order, sampleBytes = 192 * 1024) { url, r -> probes[url] = r }
    }
    // Speed-tested ones by how they graded, a quick reply alone ("pinged") counts as fine until the speed test says otherwise.
    private fun gradeScore(s: Stream) = when (probes[s.url]?.grade) {
        xyz.reddate.tv.StreamProbe.Grade.GOOD -> 3
        xyz.reddate.tv.StreamProbe.Grade.OK -> 2
        xyz.reddate.tv.StreamProbe.Grade.PINGED -> 2
        null -> 1
        xyz.reddate.tv.StreamProbe.Grade.BAD -> 0
        xyz.reddate.tv.StreamProbe.Grade.FAILED -> -1
    }

    suspend fun search(q: String): List<Meta> =
        (Engine.call("search", JSONObject().put("q", q)) as? JSONArray).objects().map { parseMeta(it) }.distinctBy { it.id }

    /** Play a stream: asks "alone or together" first when no room is running yet. */
    fun playStream(s: Stream, label: String, type: String, contentId: String, art: String, show: String = "", keepAttempt: Boolean = false, startAt: Int = 0) {
        if (!keepAttempt) attempt = Attempt(listOf(s), 0, label, type, contentId, art, show) // picked by hand: no swapping
        start(label, payloadFor(s, label, type, contentId, art, show).apply { if (startAt > 30) put("startAt", startAt) })
    }

    fun start(label: String, payload: JSONObject) = scope.launch {
        refreshInfo().join() // the room may have started or ended since we last asked
        when {
            info.inRoom && info.isGuest -> dialog = Dlg.LeaveToPlay(label, payload) // only the host picks what plays
            info.inRoom -> send(payload, together = false)
            else -> dialog = Dlg.WatchChoice(label, payload)
        }
    }

    // ---- picking streams ----
    /** Streams this TV can play first (best quality first), then the rest. */
    fun rank(list: List<Stream>): List<Stream> {
        val fits = list.associateWith { xyz.reddate.tv.DeviceCaps.fit("${it.name} ${it.title} ${it.filename}") }
        // Best first, but 1080p beats 4K: a 4K file is 30-60 Mbps and keeps a party's slower screens buffering.
        val score = { s: Stream -> val h = fits[s]!!.height; when { h == 1080 -> 5; h == 720 -> 4; h in 1081..1440 -> 3; h > 1440 -> 2; h == 0 -> 1; else -> 0 } }
        // Order: plays on this TV; then the connection test (green, yellow, untested, red, failed);
        // then "the same as last time"; then quality.
        // Order: plays on this TV; connection not bad; "the same as last time" (closest first);
        // then the connection test (green, yellow, untested); then quality.
        return list.sortedWith(
            compareByDescending<Stream> { fits[it]!!.ok }
                .thenByDescending { gradeScore(it) >= 1 }
                .thenByDescending { if (it.remembered) it.match else 0 }
                .thenByDescending { gradeScore(it) }
                .thenByDescending(score)
        )
    }
    /**
     * The order streams are listed in: plays on this TV, then the quickest reply first. Streams still being checked come after
     * every one that has answered, and failed ones last. "Your usual" stays on top only while it is nearly as quick as the best.
     */
    fun byLatency(list: List<Stream>): List<Stream> {
        val fits = list.associateWith { xyz.reddate.tv.DeviceCaps.fit("${it.name} ${it.title} ${it.filename}").ok }
        fun ms(s: Stream) = probes[s.url]?.takeIf { it.grade != xyz.reddate.tv.StreamProbe.Grade.FAILED }?.ms ?: Int.MAX_VALUE
        // 0 answered fine, 1 answered but too slow to play smoothly, 2 still checking, 3 failed
        fun band(s: Stream) = when (probes[s.url]?.grade) {
            xyz.reddate.tv.StreamProbe.Grade.GOOD, xyz.reddate.tv.StreamProbe.Grade.OK, xyz.reddate.tv.StreamProbe.Grade.PINGED -> 0
            xyz.reddate.tv.StreamProbe.Grade.BAD -> 1
            null -> 2
            xyz.reddate.tv.StreamProbe.Grade.FAILED -> 3
        }
        val best = list.filter { fits[it] == true && band(it) == 0 }.minOfOrNull { ms(it) } ?: Int.MAX_VALUE
        fun usualFirst(s: Stream) = s.remembered && band(s) == 0 && (best == Int.MAX_VALUE || ms(s) <= maxOf(best * 8 / 5, best + 250))
        return list.sortedWith(
            compareByDescending<Stream> { fits[it] == true }
                .thenByDescending { usualFirst(it) }
                .thenBy { band(it) }
                .thenBy { ms(it) }
                .thenByDescending { if (it.remembered) it.match else 0 }
        )
    }
    fun fits(s: Stream) = xyz.reddate.tv.DeviceCaps.fit("${s.name} ${s.title} ${s.filename}")

    /** Which quality group a stream belongs to: "4K", "1080p", "720p", "SD" or "Other" (not stated). */
    fun tierOf(s: Stream): String {
        val q = s.quality.lowercase()
        val h = when {
            "4k" in q || "2160" in q -> 2160
            "1080" in q -> 1080
            "720" in q -> 720
            "480" in q || "576" in q || q == "sd" -> 480
            else -> fits(s).height
        }
        return when {
            h >= 1440 -> "4K"
            h == 1080 -> "1080p"
            h == 720 -> "720p"
            h in 1..719 -> "SD"
            else -> "Other"
        }
    }

    private fun text(s: Stream) = "${s.name} ${s.title} ${s.filename}".lowercase()

    /** Straight from a disc: Blu-ray, UHD Blu-ray, BDRip or a remux. */
    fun isBluray(s: Stream) = Regex("blu-?ray|bdrip|brrip|\\bbd\\b|remux|\\buhd\\b.?bd").containsMatchIn(text(s))
    fun isRemux(s: Stream) = text(s).contains("remux")

    /** File size in GB, from what the addon says ("💾 10 GB", "📦 4.3 GB", "186 MB", "Size: 2.1 GiB"); 0 if it doesn't say. */
    fun sizeGb(s: Stream): Double {
        val m = Regex("(\\d+(?:[.,]\\d+)?)\\s*(gb|gib|mb|mib|tb)\\b", RegexOption.IGNORE_CASE).find("${s.name}\n${s.title}") ?: return 0.0
        val n = m.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return 0.0
        return when (m.groupValues[2].lowercase()) { "tb" -> n * 1000; "gb", "gib" -> n; else -> n / 1000 }
    }

    /** Mbps the file really carries: size over runtime (or the addon's own figure). 0 when it can't be told. */
    fun mbps(s: Stream, runtimeMin: Int): Double {
        if (s.bitrate > 0.5) return s.bitrate
        val gb = sizeGb(s)
        return if (gb > 0 && runtimeMin > 20) gb * 8000.0 / (runtimeMin * 60.0) else 0.0
    }

    /**
     * How good a file really is: how much picture data it carries (size / runtime), which is what separates a 2 GB
     * and a 30 GB "1080p", with resolution as the base and the release words only breaking ties.
     */
    fun qualityScore(s: Stream, runtimeMin: Int = 0): Int {
        val t = text(s)
        val res = when (tierOf(s)) { "4K" -> 4000; "1080p" -> 3000; "720p" -> 2000; "SD" -> 1000; else -> 0 }
        val rate = mbps(s, runtimeMin)
        val gb = sizeGb(s)
        // Within a resolution the rate decides (capped so a mislabelled 200 GB file can't beat everything).
        val data = if (rate > 0) minOf(rate, 90.0).toInt() * 10 else (minOf(gb, 60.0) * 6).toInt()
        val words = (if (isRemux(s)) 12 else if (isBluray(s)) 8 else 0) + (if (isHdr(s)) 5 else 0) +
            (if (Regex("truehd|dts-?hd|atmos|dts:x").containsMatchIn(t)) 3 else 0)
        return res + data + words
    }

    /** HDR10, HDR10+ or Dolby Vision, from the release name. */
    fun isHdr(s: Stream) = Regex("hdr|dolby.?vision|\\bdv\\b|\\bdovi\\b").containsMatchIn("${s.name} ${s.title} ${s.filename}".lowercase())

    /** The last stream list we played from, so a stream that won't play can be swapped for the next one. */
    private class Attempt(val list: List<Stream>, var index: Int, val label: String, val type: String, val id: String, val art: String, val show: String, var tries: Int = 0, val startAt: Int = 0)
    private var attempt: Attempt? = null

    /** Play: the best stream from [list] this TV can handle; if it fails, the next ones are tried. */
    fun playBest(list: List<Stream>, label: String, type: String, contentId: String, art: String, show: String = "") {
        val ranked = rank(list)
        if (ranked.isEmpty()) return
        attempt = Attempt(ranked, 0, label, type, contentId, art, show)
        playStream(ranked[0], label, type, contentId, art, show, keepAttempt = true)
    }

    fun onPlayFailed(src: String, host: Boolean, posSec: Int = 0) {
        val a = attempt ?: return
        if (!host || a.list.getOrNull(a.index)?.url != src || a.tries >= 5 || a.index + 1 >= a.list.size) return
        a.index++; a.tries++
        say("That stream didn’t answer. Trying another…")
        val s = a.list[a.index]
        // From the same place: where it got to, or where this resume started.
        val from = if (posSec > 30) posSec else a.startAt
        val payload = payloadFor(s, a.label, a.type, a.id, a.art, a.show).apply { if (from > 30) put("startAt", from) }
        scope.launch { try { Engine.call("play", JSONObject().put("payload", payload)) } catch (_: Exception) { } }
    }

    private fun payloadFor(s: Stream, label: String, type: String, contentId: String, art: String, show: String) = JSONObject()
        .put("kind", "direct").put("src", s.url).put("title", label)
        .put("content", JSONObject().put("type", type).put("id", contentId).put("filename", s.filename.ifEmpty { s.title }.take(200)).apply {
            if (art.isNotEmpty()) put("art", art)
            if (show.isNotEmpty()) put("show", show)
        })

    /** Bumped when the page's own screen (Addons, Account…) closes, so focus returns to the content. */
    var refocusTick by mutableStateOf(0)

    // Bumped whenever something is picked to play, so a late "show the invite" from an earlier
    // "Watch together" can't pop up over a title chosen since (the split-second QR).
    private var inviteSeq = 0

    fun send(payload: JSONObject, together: Boolean) = scope.launch {
        dialog = null
        if (backdrop != null) backdropHold = true
        inviteSeq++
        xyz.reddate.tv.PlayerActivity.openInviteAt = 0L // a plain play never opens the invite
        try {
            // A video file: the invite opens inside the player once it plays, and stays (a card on Home would be
            // covered a moment later). A YouTube video keeps the card in the page's own layer.
            if (together && payload.optString("kind") != "yt") xyz.reddate.tv.PlayerActivity.openInviteAt = android.os.SystemClock.uptimeMillis()
            Engine.call("play", JSONObject().put("payload", payload))
            if (together && payload.optString("kind") == "yt") { delay(2500); awaitRoomThenInvite(overWeb = true, seq = inviteSeq) }
        } catch (e: Exception) { say(e.message ?: "Couldn’t start that") }
    }

    /** A pasted YouTube / video link: same "alone or together" question as a stream. */
    fun startLink(url: String) {
        val u = url.trim()
        val yt = Regex("(?:youtu\\.be/|[?&]v=|/(?:shorts|embed|live)/)([\\w-]{11})").find(u)?.groupValues?.get(1)
        val payload = when {
            yt != null -> JSONObject().put("kind", "yt").put("videoId", yt).put("url", u)
            Regex("^https?://\\S+\\.(mp4|webm|ogg|ogv|m4v|mov|m3u8|mkv)(\\?\\S*)?$", RegexOption.IGNORE_CASE).matches(u) -> JSONObject().put("kind", "direct").put("src", u)
            else -> { say("That doesn’t look like a YouTube link or a video file link."); return }
        }
        if (screen is Screen.Link) home() // once it's playing, Back comes to Home, not the link box
        start(if (yt != null) "YouTube video" else "Video link", payload)
    }

    /** Join someone's party by its code. Calls back with an error message, or null when it worked. */
    fun joinCode(code: String, done: (String?) -> Unit) = scope.launch {
        try {
            val r = Engine.call("joinCode", JSONObject().put("code", code), timeoutMs = 30_000) as? JSONObject
            if (r != null && r.optBoolean("ok")) { dialog = null; home(); done(null) }
            else done(r?.optString("message")?.ifEmpty { null } ?: "Couldn’t join that party.")
        } catch (e: Exception) { done(e.message ?: "Couldn’t join that party.") }
    }

    /** "Watch together" with nothing picked yet: start an empty room and show how to join. */
    fun together() = scope.launch {
        try {
            val seq = ++inviteSeq
            val result = Engine.call("together", timeoutMs = 25_000) as? JSONObject
            if (result?.optBoolean("ok") != true) { say(result?.optString("message") ?: "Couldn’t start a room"); return@launch }
            awaitRoomThenInvite(seq = seq)
        } catch (e: Exception) { say(e.message ?: "Couldn’t start a room") }
    }

    private suspend fun awaitRoomThenInvite(overWeb: Boolean = false, seq: Int) {
        repeat(20) {
            if (seq != inviteSeq) return
            refreshInfo().join()
            if (seq != inviteSeq) return
            if (info.inRoom && info.invite.isNotEmpty()) {
                // A YouTube video plays in the page's own layer, so its invite card shows there too.
                if (overWeb) openWeb("invite") else dialog = Dlg.Invite
                return
            }
            delay(250)
        }
    }

    fun resume() = scope.launch { try { Engine.call("resume") } catch (_: Exception) { } }
    fun openWeb(screen: String) = scope.launch { try { Engine.call("openWeb", JSONObject().put("screen", screen)) } catch (_: Exception) { } }
    /** Add (id null) or rename a profile. Calls back with an error message, or null when it worked. */
    fun saveProfile(id: String?, name: String, done: (String?) -> Unit) = scope.launch {
        try {
            val r = if (id == null) Engine.call("addProfile", JSONObject().put("name", name), timeoutMs = 20_000)
                    else Engine.call("renameProfile", JSONObject().put("id", id).put("name", name), timeoutMs = 20_000)
            if ((r as? JSONObject)?.optBoolean("ok") == true) { refreshInfo().join(); dialog = null; done(null) }
            else done("Couldn’t save that. Check the connection and try again.")
        } catch (e: Exception) { done(e.message ?: "Couldn’t save that.") }
    }

    fun deleteProfile(id: String, done: (String?) -> Unit) = scope.launch {
        try {
            val r = Engine.call("removeProfile", JSONObject().put("id", id), timeoutMs = 20_000)
            if ((r as? JSONObject)?.optBoolean("ok") == true) {
                dialog = null; refreshInfo().join(); done(null)
                loadRows() // the active profile may have changed
            } else done("Couldn’t delete that. Try again.")
        } catch (e: Exception) { done(e.message ?: "Couldn’t delete that.") }
    }

    fun chooseProfile(p: Profile) = scope.launch {
        try { Engine.call("chooseProfile", JSONObject().put("id", p.id)) } catch (_: Exception) { }
        refreshInfo().join()
        home()
        loadRows()
    }
}
