/* Home: the catalog the app opens on, and the title page.
 *
 * Home = a featured banner + swipeable rows (Reddate's own TMDB catalog when the
 * server has one, plus rows from any catalog addons you added) + search.
 * Tapping a poster opens the title page: backdrop, details, trailer, episodes and
 * the streams to play (the stream list itself comes from addons.js).
 * Pressing Play when you're not in a room asks "Watch alone / Watch together";
 * the room is created then (app.js), and "together" shows the invite card.
 */
window.reddateHome = (function () {
    const $ = id => document.getElementById(id);
    const A = () => window.reddateAddons;
    const isTV = () => document.documentElement.classList.contains('tv');
    const region = (() => {
        const m = /-([A-Z]{2})$/.exec(navigator.language || '');
        return m ? m[1] : 'US';
    })();

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function icon(name) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(ns, 'use');
        use.setAttribute('href', `#i-${name}`);
        svg.appendChild(use);
        return svg;
    }
    const safeImg = url => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : '');

    // ---------- rows ----------
    // Reddate's own catalog: a curated Home. Values match the catalog's genre/service names.
    const OWN_ROWS = [
        { title: 'Trending movies', type: 'movie', id: 'trending', hero: true },
        { title: 'Top 10 movies today', type: 'movie', id: 'top10', extra: { genre: 'Today' } },
        { title: 'Top 10 series today', type: 'series', id: 'top10', extra: { genre: 'Today' } },
        { title: 'Netflix · Top 10 movies', type: 'movie', id: 'top10', extra: { genre: 'Netflix' } },
        { title: 'Netflix · Top 10 series', type: 'series', id: 'top10', extra: { genre: 'Netflix' } },
        { title: 'Prime Video · Top 10 movies', type: 'movie', id: 'top10', extra: { genre: 'Prime Video' } },
        { title: 'Prime Video · Top 10 series', type: 'series', id: 'top10', extra: { genre: 'Prime Video' } },
        { title: 'Disney+ · Top 10 movies', type: 'movie', id: 'top10', extra: { genre: 'Disney+' } },
        { title: 'Disney+ · Top 10 series', type: 'series', id: 'top10', extra: { genre: 'Disney+' } },
        { title: 'Apple TV+ · Top 10 movies', type: 'movie', id: 'top10', extra: { genre: 'Apple TV+' } },
        { title: 'Apple TV+ · Top 10 series', type: 'series', id: 'top10', extra: { genre: 'Apple TV+' } },
        { title: 'Max · Top 10 movies', type: 'movie', id: 'top10', extra: { genre: 'Max' } },
        { title: 'Max · Top 10 series', type: 'series', id: 'top10', extra: { genre: 'Max' } },
        { title: 'Trending shows', type: 'series', id: 'trending' },
        { title: 'Popular on Netflix', type: 'series', id: 'provider', extra: { genre: 'Netflix' } },
        { title: 'New in cinemas', type: 'movie', id: 'now_playing' },
        { title: 'Popular movies', type: 'movie', id: 'popular' },
        { title: 'Popular shows', type: 'series', id: 'popular' },
        { title: 'On Prime Video', type: 'movie', id: 'provider', extra: { genre: 'Prime Video' } },
        { title: 'Action', type: 'movie', id: 'genre', extra: { genre: 'Action' } },
        { title: 'Comedy', type: 'movie', id: 'genre', extra: { genre: 'Comedy' } },
        { title: 'Top rated movies', type: 'movie', id: 'top_rated' },
        { title: 'On Disney+', type: 'movie', id: 'provider', extra: { genre: 'Disney+' } },
        { title: 'Horror', type: 'movie', id: 'genre', extra: { genre: 'Horror' } },
        { title: 'Animation', type: 'movie', id: 'genre', extra: { genre: 'Animation' } },
        { title: 'Top rated shows', type: 'series', id: 'top_rated' },
        { title: 'Documentaries', type: 'movie', id: 'genre', extra: { genre: 'Documentary' } },
        { title: 'Coming soon', type: 'movie', id: 'upcoming' }
    ];

    function catalogUrl(addonUrl, type, id, extra) {
        const ex = extra ? '/' + Object.entries(extra).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
        const q = A().isOwnCatalog(addonUrl) ? `?region=${region}` : '';
        return `${A().baseOf(addonUrl)}/catalog/${type}/${encodeURIComponent(id)}${ex}.json${q}`;
    }

    // Every row to show: the curated own-catalog rows (or the fallback catalog's), then added catalog addons.
    const P = () => window.reddatePrefs;
    function rowKey(s) { return P().hash(`${s.url}|${s.type}|${s.id}|${s.extra ? s.extra.genre : ''}`); }

    // Everything the loaded addons offer, then your own order and hidden rows applied on top.
    function allSpecs() {
        const specs = [];
        const own = A().catalogUrl();
        const addons = A().loadedAddons();
        addons.forEach(({ url, m }) => {
            if (A().isOwnCatalog(url)) {
                OWN_ROWS.forEach(r => specs.push({ ...r, url }));
                return;
            }
            // Any Stremio-style catalog addon: every catalog it offers, whatever shape its manifest has.
            let shown = 0;
            // With many catalog addons, each shows fewer rows at first (the rest are in Addons → Home rows).
            const catalogAddons = addons.filter(a => (a.m.catalogs || []).length).length;
            const firstRows = catalogAddons > 20 ? 1 : catalogAddons > 8 ? 3 : 8;
            (m.catalogs || []).forEach(c => {
                if (shown >= 40) return; // a huge addon can't crowd out the others
                if (!c || !c.id || !c.type) return;
                if (!browsable(c.type)) return;
                const extras = Array.isArray(c.extra) ? c.extra : [];
                const supported = new Set([...(c.extraSupported || []), ...extras.map(e => e && e.name)]);
                const required = new Set(c.extraRequired || []);
                extras.forEach(e => { if (e && e.isRequired) required.add(e.name); });
                const kind = c.type === 'movie' ? 'movies' : (c.type === 'series' || c.type === 'anime') ? 'shows' : (c.type === 'tv' || c.type === 'channel') ? 'channels' : 'videos';
                const base = url === own ? `${c.name || 'Top'} ${kind}` : m.id === 'xyz.reddate.yt' ? (c.name || c.id) : `${c.name || c.id} · ${m.name}`;
                const add = (title, extra) => { specs.push({ title, type: c.type, id: c.id, url, ...(extra ? { extra } : {}), auto: shown++ >= firstRows }); };
                if (!required.size) { add(base); return; }
                // Needs a pick (usually a genre): one row for each of the first few choices.
                if (required.size === 1 && required.has('genre')) {
                    const opts = (extras.find(e => e && e.name === 'genre') || {}).options || [];
                    opts.slice(0, 6).forEach(g => add(`${g} · ${c.name || c.id} · ${m.name}`, { genre: g }));
                }
                // A search-only catalog is used by Search, not Home.
                void supported;
            });
        });
        return specs.slice(0, 400).map(s => ({ ...s, key: rowKey(s) }));
    }
    // Stremio lets an addon name its own content types ("tv", "channel", "Music"…). Every type an addon offers is a row.
    function browsable(type) { return !!String(type || '').trim(); }
    function ordered(all) {
        const order = P().get('rowsOrder', []) || [];
        const pos = k => { const i = order.indexOf(k); return i < 0 ? 1000 : i; };
        return all.map((s, i) => ({ s, i })).sort((a, b) => pos(a.s.key) - pos(b.s.key) || a.i - b.i).map(x => x.s);
    }
    // Hidden by you, plus a big addon's later rows (hidden until you switch them on).
    function hiddenKeys(all) {
        const hide = new Set(P().get('rowsHide', []) || []);
        const shown = new Set(P().get('rowsShow', []) || []);
        all.forEach(s => { if (s.auto && !shown.has(s.key)) hide.add(s.key); });
        return hide;
    }
    function rowSpecs() {
        const hide = hiddenKeys(allSpecs());
        const list = ordered(allSpecs()).filter(s => !hide.has(s.key)).slice(0, 40);
        list.forEach((s, i) => { s.hero = i === 0; }); // the banner comes from the first row you see
        return list;
    }
    // For the Addons page: every row with whether it shows, in your order.
    function rowList() {
        const all = allSpecs();
        const hide = hiddenKeys(all);
        return ordered(all).map(s => ({ key: s.key, title: s.title, visible: !hide.has(s.key) }));
    }
    function setRows(list) {
        P().set('rowsOrder', list.map(x => x.key));
        P().set('rowsHide', list.filter(x => !x.visible).map(x => x.key));
        P().set('rowsShow', list.filter(x => x.visible).map(x => x.key));
        buildHome();
    }

    let rowObserver = null;
    let homeToken = 0;

    // "Set up in 3 steps": a strip above the rows for people who haven't finished (phone and computer only).
    async function setupBanner() {
        const host = $('homeRows');
        if (!host) return;
        let el0 = $('setupBanner');
        if (el0) el0.remove();
        try { if (localStorage.getItem('reddate-setup-dismissed') === '1') return; } catch (e) { /* no storage */ }
        const Acc = window.reddateAccount;
        if (!Acc || !Acc.isSignedIn || !Acc.isSignedIn()) return;
        let done = 0;
        try {
            const token = Acc.sessionToken();
            const dv = await fetch('/api/devices', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.ok ? r.json() : null).catch(() => null);
            const tv = !!(dv && (dv.devices || []).some(d => d.kind === 'tv'));
            const profiles = Acc.profiles();
            const own = A().manage.list().filter(a => !a.builtIn && a.enabled);
            const steps = [tv, profiles.length > 1 || (profiles[0] && profiles[0].name !== 'Me'), own.some(a => a.stream)];
            done = steps.filter(Boolean).length;
        } catch (e) { return; }
        if (done >= 3) return;
        const b = el('div', 'setup-banner');
        b.id = 'setupBanner';
        const text = el('div', 'setup-text');
        text.appendChild(el('strong', null, 'New here? Set up in 3 steps'));
        text.appendChild(el('span', null, `${done} of 3 done`));
        const go = el('a', 'btn btn-primary', 'Continue');
        go.href = '/setup'; go.target = '_blank'; go.rel = 'noopener';
        const x = el('button', 'icon-btn setup-x', '×');
        x.type = 'button'; x.setAttribute('aria-label', 'Hide this');
        x.onclick = () => { try { localStorage.setItem('reddate-setup-dismissed', '1'); } catch (e) { /* no storage */ } b.remove(); };
        b.append(text, go, x);
        host.parentNode.insertBefore(b, host);
    }
    document.addEventListener('reddate:account-ready', () => setTimeout(setupBanner, 600));

    async function buildHome() {
        const token = ++homeToken;
        await A().ready;
        if (token !== homeToken) return;
        // The TV app draws Home natively; this page is just its engine, so don't spend memory on a hidden copy.
        if (window.ReddateNative && window.ReddateNative.hasNativeUi && window.ReddateNative.hasNativeUi()) return;
        const rows = $('homeRows');
        rows.innerHTML = '';
        const specs = rowSpecs();
        if (!specs.length) {
            const empty = el('div', 'home-empty');
            empty.appendChild(el('p', null, 'Home is empty. Add a catalog addon to choose what shows here.'));
            const b = el('button', 'btn btn-primary', 'Add addons');
            b.type = 'button';
            b.onclick = () => window.reddatePages.openAddons();
            empty.appendChild(b);
            rows.appendChild(empty);
            $('homeHero').hidden = true;
            return;
        }
        if (rowObserver) rowObserver.disconnect();
        rowObserver = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (!e.isIntersecting) return;
                rowObserver.unobserve(e.target);
                loadRow(e.target);
            });
        }, { rootMargin: '600px 0px' });

        specs.forEach((spec, i) => {
            const row = el('section', 'row');
            row._spec = spec;
            row.appendChild(el('h2', 'row-title', spec.title));
            const scroller = el('div', 'row-scroller');
            for (let k = 0; k < 8; k++) scroller.appendChild(el('div', 'poster-card is-skeleton'));
            row.appendChild(scroller);
            rows.appendChild(row);
            if (i < 3) loadRow(row); else rowObserver.observe(row); // the TV loads ahead of the focus instead (loadAhead)
        });
        // Make it yours: one button at the end of Home.
        const edit = el('div', 'home-edit');
        const eb = el('button', 'btn');
        eb.type = 'button';
        eb.append(icon('plus'), document.createTextNode('Customize Home: addons and rows'));
        eb.onclick = () => window.reddatePages.openAddons();
        edit.appendChild(eb);
        rows.appendChild(edit);
        renderFooter();
        // On a TV the remote can run down the page fast: fill the rows in one at a time while it's idle.
        if (isTV()) {
            const mine = token;
            const rest = [...rows.children].filter(r => r._spec && !r._loaded && !r._loading);
            let n = 0;
            const next = () => {
                if (mine !== homeToken || n >= rest.length) return;
                loadRow(rest[n++]);
                setTimeout(next, 450);
            };
            setTimeout(next, 1200);
        }
    }

    async function loadRow(row) {
        if (row._loaded || row._loading) return;
        row._loading = true;
        const spec = row._spec;
        const scroller = row.querySelector('.row-scroller');
        try {
            const data = await A().getJson(catalogUrl(spec.url, spec.type, spec.id, spec.extra));
            const metas = (data.metas || []).filter(m => m && m.id && safeImg(m.poster)).slice(0, 30);
            if (!metas.length) { row.remove(); return; }
            scroller.innerHTML = '';
            metas.forEach(m => scroller.appendChild(posterCard({ ...m, type: m.type || spec.type })));
            row._loaded = true;
            if (spec.hero && $('homeHero').hidden) renderHero(metas.find(m => safeImg(m.background)) || metas[0], spec.type);
        } catch (e) {
            row.remove(); // a row that won't load just isn't shown
        }
    }

    function posterCard(meta) {
        const b = el('button', 'poster-card');
        b.type = 'button';
        b.setAttribute('aria-label', meta.name || 'Untitled');
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = safeImg(meta.poster);
        img.onerror = () => { img.remove(); b.classList.add('no-art'); };
        b.appendChild(img);
        b.appendChild(el('span', 'poster-name', meta.name || 'Untitled'));
        b.onclick = () => openTitle(meta, b);
        b._meta = meta;
        return b;
    }

    let heroMeta = null;
    function renderHero(meta, type) {
        if (!meta) return;
        heroMeta = { ...meta, type: meta.type || type };
        const hero = $('homeHero');
        hero.innerHTML = '';
        const bg = safeImg(meta.background) || safeImg(meta.poster);
        if (bg) hero.style.setProperty('--hero-image', `url("${bg.replace(/"/g, '%22')}")`);
        const text = el('div', 'hero-text');
        text.appendChild(el('span', 'hero-kicker', type === 'series' ? 'Trending show' : 'Trending movie'));
        text.appendChild(el('h1', 'hero-title', meta.name));
        const facts = [meta.releaseInfo, meta.imdbRating ? `★ ${meta.imdbRating}` : ''].filter(Boolean).join('  ·  ');
        const f = el('p', 'hero-facts', facts); f.hidden = !facts; text.appendChild(f);
        const d = el('p', 'hero-desc', meta.description || ''); d.hidden = !meta.description; text.appendChild(d);
        const actions = el('div', 'hero-actions');
        const play = el('button', 'btn btn-primary');
        play.append(icon('play'), document.createTextNode('Play'));
        play.onclick = () => openTitle(heroMeta, play, { autoplay: true });
        const info = el('button', 'btn');
        info.append(document.createTextNode('More info'));
        info.onclick = () => openTitle(heroMeta, info);
        actions.append(play, info);
        text.appendChild(actions);
        hero.appendChild(text);
        hero.hidden = false;
    }

    // TV: the banner follows the poster you're on (backdrop, title, facts, description).
    let previewTimer = null;
    function previewHero(meta) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            const hero = $('homeHero');
            if (hero.hidden || !meta) return;
            heroMeta = meta;
            const bg = safeImg(meta.background) || safeImg(meta.poster);
            if (bg) hero.style.setProperty('--hero-image', `url("${bg.replace(/"/g, '%22')}")`);
            const set = (sel, text) => { const n = hero.querySelector(sel); if (n) { n.textContent = text || ''; n.hidden = !text; } };
            set('.hero-kicker', meta.type === 'series' ? 'Show' : 'Movie');
            set('.hero-title', meta.name);
            set('.hero-facts', [meta.releaseInfo, meta.imdbRating ? `★ ${meta.imdbRating}` : ''].filter(Boolean).join('  ·  '));
            set('.hero-desc', meta.description);
        }, 180);
    }

    function renderFooter() {
        const foot = $('homeFoot');
        foot.innerHTML = '';
        if (!A().isOwnCatalog(A().catalogUrl())) return;
        const logo = document.createElement('img');
        logo.src = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg';
        logo.alt = 'TMDB';
        logo.className = 'tmdb-logo';
        foot.append(logo, el('span', null, 'This product uses the TMDB API but is not endorsed or certified by TMDB.'));
    }

    // ---------- search ----------
    let searchTimer = null;
    let searchToken = 0;
    async function runSearch(q) {
        const token = ++searchToken;
        const out = $('homeResults');
        const showing = !!q;
        out.hidden = !showing;
        $('homeRows').hidden = showing;
        $('homeHero').hidden = showing || !$('homeHero').childElementCount;
        if (!showing) return;
        out.innerHTML = '';
        out.appendChild(el('h2', 'row-title', `Results for “${q}”`));
        const grid = el('div', 'results-grid');
        out.appendChild(grid);
        const status = el('p', 'home-empty', 'Searching…');
        out.appendChild(status);
        await A().ready;
        const sources = [];
        A().loadedAddons().forEach(({ url, m }) => (m.catalogs || []).forEach(c => {
            const hasSearch = (c.extra || []).some(e => e.name === 'search') || (c.extraSupported || []).includes('search');
            if (hasSearch && browsable(c.type)) sources.push({ url, c });
        }));
        const results = await Promise.allSettled(sources.map(({ url, c }) => A().getJson(catalogUrl(url, c.type, c.id, { search: q }))
            .then(d => (d.metas || []).map(m => ({ ...m, type: m.type || c.type })))));
        if (token !== searchToken) return;
        const seen = new Set();
        results.forEach(r => (r.status === 'fulfilled' ? r.value : []).forEach(m => {
            if (!m || !m.id || seen.has(m.id) || !safeImg(m.poster)) return;
            seen.add(m.id);
            grid.appendChild(posterCard(m));
        }));
        status.textContent = grid.childElementCount ? '' : `Nothing found for “${q}”.`;
        if (!grid.childElementCount) status.hidden = false; else status.remove();
    }

    // ---------- the title page ----------
    let lastFocus = null;
    let autoplayWanted = false;
    let autoplayTimer = null;

    async function openTitle(meta, from, opts = {}) {
        lastFocus = from || document.activeElement;
        const page = $('titlePage');
        page.hidden = false;
        page.scrollTop = 0;
        document.documentElement.classList.add('title-open');
        if (!history.state || !history.state.reddateTitle) history.pushState({ reddateTitle: true }, '', location.href);

        const bg = safeImg(meta.background) || safeImg(meta.poster);
        $('titleBackdrop').style.backgroundImage = bg ? `url("${bg.replace(/"/g, '%22')}")` : '';
        $('titleOverview').textContent = meta.description || '';
        $('titleGenres').innerHTML = '';
        $('titleCast').textContent = '';
        $('titleTrailer').hidden = true;
        $('titleSimilar').innerHTML = '';
        $('streamsHeading').textContent = 'Streams';
        A().openDetail(meta); // fills title/poster/info and starts finding episodes or streams
        setPlayButton(meta.type === 'series' ? 'episode' : 'ready');
        autoplayWanted = !!opts.autoplay && meta.type !== 'series';
        if (autoplayWanted) waitForFirstStream();

        const full = await A().fullMeta(meta.type, meta.id).catch(() => null);
        if (!full || $('titlePage').hidden) return;
        if (full.description) $('titleOverview').textContent = full.description;
        const info = [full.releaseInfo || meta.releaseInfo, full.runtime, full.imdbRating ? `★ ${full.imdbRating}` : ''].filter(Boolean).join('  ·  ');
        if (info) $('detailInfo').textContent = info;
        (full.genres || []).slice(0, 4).forEach(g => $('titleGenres').appendChild(el('span', 'chip-tag', g)));
        if (full.cast && full.cast.length) $('titleCast').textContent = `Starring ${full.cast.slice(0, 5).join(', ')}`;
        const trailer = (full.trailers || []).find(t => /^[\w-]{6,20}$/.test(t.source || ''));
        if (trailer) {
            $('titleTrailer').hidden = false;
            $('titleTrailer').onclick = () => showTrailer(trailer.source, full.name);
        }
        if (full.similar && full.similar.length) {
            const row = el('section', 'row');
            row.appendChild(el('h2', 'row-title', 'More like this'));
            const scroller = el('div', 'row-scroller');
            full.similar.forEach(m => scroller.appendChild(posterCard({ ...m, type: m.type || meta.type })));
            row.appendChild(scroller);
            $('titleSimilar').appendChild(row);
        }
    }

    // `toPlay`: closing because playback is starting — leave history alone (the room's address is
    // about to be set, and going "back" now would undo it).
    function closeTitle(toPlay) {
        const page = $('titlePage');
        if (page.hidden) return;
        page.hidden = true;
        document.documentElement.classList.remove('title-open');
        autoplayWanted = false;
        clearTimeout(autoplayTimer);
        if (A() && !toPlay) A().stopChecks();
        if (history.state && history.state.reddateTitle) {
            if (toPlay) history.replaceState(null, '', location.href); else history.back();
        }
        if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
    }
    // The phone's / browser's Back button closes the title page.
    addEventListener('popstate', () => {
        if (!$('titlePage').hidden && !(history.state && history.state.reddateTitle)) {
            $('titlePage').hidden = true;
            document.documentElement.classList.remove('title-open');
            if (A()) A().stopChecks();
        }
    });

    // "Play": the best-ranked stream that plays here (the list is ordered that way).
    function firstStream() { return document.querySelector('#streamList .stream-row'); }
    function setPlayButton(state) {
        const b = $('titlePlay');
        b.disabled = state === 'episode';
        b.lastChild.textContent = state === 'episode' ? 'Pick an episode' : state === 'finding' ? 'Finding a stream…' : 'Play';
    }
    function waitForFirstStream() {
        setPlayButton('finding');
        clearTimeout(autoplayTimer);
        const started = Date.now();
        const check = () => {
            if (!autoplayWanted || $('titlePage').hidden) return;
            const s = firstStream();
            if (s) { autoplayWanted = false; setPlayButton('ready'); s.click(); return; }
            if (Date.now() - started > 60000) { autoplayWanted = false; setPlayButton('ready'); return; }
            autoplayTimer = setTimeout(check, 400);
        };
        check();
    }
    function onPlayPressed() {
        const s = firstStream();
        if (s) { s.click(); return; }
        autoplayWanted = true;
        waitForFirstStream();
        $('streamsHeading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---------- sheets: watch alone/together, invite, trailer ----------
    function openSheet(build) {
        const body = $('sheetBody');
        body.innerHTML = '';
        build(body);
        $('sheetModal').classList.add('show');
        const f = body.querySelector('button.btn-primary, input, button');
        if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
    }
    function closeSheet() {
        $('sheetModal').classList.remove('show');
        $('sheetBody').innerHTML = '';
    }

    function askHowToWatch(label, done) {
        const known = (window.reddateRoom && window.reddateRoom.savedName()) || (isTV() ? 'TV' : '');
        openSheet(b => {
            b.appendChild(el('h2', null, 'How do you want to watch?'));
            b.appendChild(el('p', 'sheet-sub', label));
            let nameInput = null;
            if (!known) {
                const f = el('label', 'acct-field');
                f.appendChild(el('span', 'field-label', 'Your name'));
                nameInput = el('input', 'lobby-input');
                nameInput.maxLength = 40;
                nameInput.autocomplete = 'nickname';
                nameInput.placeholder = 'So friends know who’s here';
                f.appendChild(nameInput);
                b.appendChild(f);
            }
            const choices = el('div', 'watch-choices');
            const choice = (together, title, sub, ic) => {
                const c = el('button', `watch-choice ${together ? 'is-together' : ''}`);
                c.type = 'button';
                const i = el('span', 'watch-icon');
                i.appendChild(icon(ic));
                const t = el('span', 'watch-text');
                t.append(el('span', 'watch-title', title), el('span', 'watch-sub', sub));
                c.append(i, t);
                c.onclick = () => {
                    const name = (nameInput ? nameInput.value.trim() : known) || 'Guest';
                    closeSheet();
                    done({ name, together });
                };
                return c;
            };
            choices.append(
                choice(false, 'Watch alone', 'Starts right away. You can invite people later.', 'play'),
                choice(true, 'Watch together', 'Get a link and QR code to share. Everyone stays in sync.', 'users')
            );
            b.appendChild(choices);
        });
    }

    let qrPromise = null;
    function loadQr() {
        if (window.qrcode) return Promise.resolve(window.qrcode);
        if (!qrPromise) {
            qrPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
                s.onload = () => resolve(window.qrcode);
                s.onerror = () => { qrPromise = null; reject(new Error('qr')); };
                document.head.appendChild(s);
            });
        }
        return qrPromise;
    }

    function inviteLink() {
        const R = window.reddateRoom;
        const id = R && (R.roomCode() || R.roomId());
        return id ? `${window.reddateWebOrigin || location.origin}/join/${encodeURIComponent(id)}` : location.href;
    }

    function showInvite() {
        if (window.reddateRoom && window.reddateRoom.goLive) window.reddateRoom.goLive(); // the room only exists once it's shared
        const link = inviteLink();
        openSheet(b => {
            b.appendChild(el('h2', null, 'Invite people'));
            b.appendChild(el('p', 'sheet-sub', 'Anyone with this link can join and watch in sync, so only share it with people you trust.'));
            const qr = el('div', 'invite-qr');
            b.appendChild(qr);
            loadQr().then(q => {
                const code = q(0, 'M');
                code.addData(link);
                code.make();
                qr.innerHTML = code.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
            }).catch(() => qr.remove());
            const code = window.reddateRoom && window.reddateRoom.roomCode();
            if (code) {
                const c = el('div', 'invite-code');
                c.append(el('span', 'field-label', 'Room code'), el('span', 'mono', code));
                b.appendChild(c);
            }
            const row = el('div', 'invite-link');
            row.appendChild(el('span', 'mono', link.replace(/^https?:\/\//, '')));
            b.appendChild(row);
            const actions = el('div', 'sheet-actions');
            const copy = el('button', 'btn btn-primary');
            copy.append(icon('link'), document.createTextNode('Copy link'));
            copy.onclick = () => navigator.clipboard.writeText(link).then(() => {
                copy.lastChild.textContent = 'Copied';
                setTimeout(() => { copy.lastChild.textContent = 'Copy link'; }, 1600);
            }, () => { if (window.showToast) window.showToast('Couldn’t copy — select the link and copy it'); });
            actions.appendChild(copy);
            if (navigator.share) {
                const share = el('button', 'btn');
                share.append(icon('share'), document.createTextNode('Share'));
                share.onclick = () => navigator.share({ title: 'Watch with me on Reddate', url: link }).catch(() => {});
                actions.appendChild(share);
            }
            b.appendChild(actions);
            // Your own other devices (same account) that have Reddate open: one tap sends them an invite.
            if (window.reddateDevices && window.reddateAccount && window.reddateAccount.isSignedIn()) {
                const box = el('div', 'invite-devices');
                b.appendChild(box);
                window.reddateDevices.list().then(list => {
                    if (!list.length) { box.appendChild(el('p', 'sheet-sub', 'Your other devices show up here when they have Reddate open and are signed in.')); return; }
                    box.appendChild(el('span', 'field-label', 'Your profiles and devices'));
                    const all = el('button', 'btn btn-primary', `Invite everyone (${list.length})`);
                    all.type = 'button';
                    all.onclick = () => { window.reddateDevices.inviteAll(); all.textContent = 'Invites sent'; all.disabled = true; };
                    box.appendChild(all);
                    box.appendChild(el('p', 'sheet-sub', 'They get a pop-up to join. You stay in control of playback.'));
                    list.forEach(d => {
                        const r = el('div', 'invite-device');
                        const t = el('div', 'mp-text');
                        t.append(el('div', 'mp-name', d.profile ? `${d.profile} · ${d.device}` : d.device), el('div', 'mp-meta', d.inRoom ? 'Watching something else' : 'Open now'));
                        const send = el('button', 'btn', 'Send invite');
                        send.type = 'button';
                        send.onclick = () => { window.reddateDevices.invite(d.id); send.textContent = 'Sent'; send.disabled = true; };
                        r.append(t, send);
                        box.appendChild(r);
                    });
                });
            }
        });
    }

    // A yes/no card (e.g. an invite from your other device).
    function confirm(title, sub, yes, onYes, onNo) {
        openSheet(b => {
            b.appendChild(el('h2', null, title));
            if (sub) b.appendChild(el('p', 'sheet-sub', sub));
            const actions = el('div', 'sheet-actions');
            const ok = el('button', 'btn btn-primary', yes);
            ok.type = 'button';
            ok.onclick = () => { closeSheet(); onYes(); };
            const no = el('button', 'btn', 'Not now');
            no.type = 'button';
            no.onclick = () => { closeSheet(); if (onNo) onNo(); };
            actions.append(ok, no);
            b.appendChild(actions);
            setTimeout(() => ok.focus(), 50);
        });
    }

    function showTrailer(key, name) {
        openSheet(b => {
            b.parentElement.classList.add('is-video');
            b.appendChild(el('h2', null, name ? `${name} — trailer` : 'Trailer'));
            const frame = document.createElement('iframe');
            frame.className = 'trailer-frame';
            frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0`;
            frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
            frame.allowFullscreen = true;
            frame.title = 'Trailer';
            b.appendChild(frame);
        });
    }

    // ---------- header, tab bar and screen state ----------
    function syncChrome() {
        const inRoom = window.reddateRoom && window.reddateRoom.isInRoom();
        $('homeWatching').hidden = !inRoom;
        $('tabRoom').hidden = !inRoom;
        const acct = window.reddateAccount;
        const btn = $('homeAccount');
        const on = acct && acct.isEnabled && acct.isEnabled();
        btn.hidden = !on;
        $('tabAccount').hidden = !on;
        if (on) {
            const slot = btn.querySelector('.acct-slot');
            const name = acct.profileName && acct.profileName();
            slot.textContent = '';
            btn.classList.toggle('signed-in', !!name);
            if (name) slot.textContent = name.trim().charAt(0).toUpperCase();
            else slot.appendChild(icon('user'));
        }
        const light = document.documentElement.getAttribute('data-theme') === 'light';
        $('homeTheme').querySelector('use').setAttribute('href', light ? '#i-moon' : '#i-sun');
    }

    function wire() {
        $('homeSearch').addEventListener('input', e => {
            clearTimeout(searchTimer);
            const q = e.target.value.trim();
            searchTimer = setTimeout(() => runSearch(q), 350);
        });
        $('homeSources').onclick = () => window.reddatePages.openAddons();
        $('homeYouTube').onclick = () => window.reddatePages.openYouTube();
        $('homeTheme').onclick = () => { $('themeToggle').click(); syncChrome(); };
        $('homeAccount').onclick = () => window.reddateAccount && window.reddateAccount.open();
        $('homeWatching').onclick = () => window.reddateRoom.showRoom();
        $('tabHome').onclick = () => { $('homeSearch').value = ''; runSearch(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        $('tabSearch').onclick = () => { $('homeSearch').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        $('tabRoom').onclick = () => window.reddateRoom.showRoom();
        $('tabAccount').onclick = () => window.reddateAccount && window.reddateAccount.open();
        $('titlePlay').onclick = onPlayPressed;
        $('sheetModal').addEventListener('click', e => { if (e.target === $('sheetModal')) closeSheet(); });
        $('sheetModal').querySelector('.modal-close').addEventListener('click', closeSheet);
        new MutationObserver(() => { if (!$('sheetModal').classList.contains('show')) { $('sheetBody').innerHTML = ''; $('sheetModal').querySelector('.modal-content').classList.remove('is-video'); } })
            .observe($('sheetModal'), { attributes: true, attributeFilter: ['class'] });
        new MutationObserver(syncChrome).observe(document.documentElement, { attributes: true, attributeFilter: ['data-screen', 'data-theme'] });
        document.addEventListener('reddate:account', syncChrome);
        document.addEventListener('reddate:account-ready', syncChrome);
        // The room's "Copy invite" button opens the invite card (QR, copy, share).
        const share = $('shareBtn');
        if (share) share.addEventListener('click', e => { e.stopImmediatePropagation(); showInvite(); }, true);
        // Episode picked → its streams load; "Play" then means the best one.
        $('episodeList').addEventListener('click', e => { if (e.target.closest('.episode-btn')) setPlayButton('ready'); });
    }

    async function init() {
        // addons.js is set up when the app starts (app.js); wait for it.
        while (!A()) await new Promise(r => setTimeout(r, 30));
        wire();
        syncChrome();
        buildHome();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);

    // For the TV app's native Home: the rows to show, as catalog links it can fetch itself.
    function nativeRows() {
        return rowSpecs().map(s => ({ key: s.key, title: s.title, type: s.type, url: new URL(catalogUrl(s.url, s.type, s.id, s.extra), location.href).toString() }));
    }
    async function nativeSearch(q) {
        await A().ready;
        if (A().manage && A().manage.whenLoaded) await A().manage.whenLoaded(7000);
        const sources = [];
        A().loadedAddons().forEach(({ url, m }) => (m.catalogs || []).forEach(c => {
            const hasSearch = (c.extra || []).some(e => e.name === 'search') || (c.extraSupported || []).includes('search');
            if (hasSearch && browsable(c.type)) sources.push({ url, c });
        }));
        const results = await Promise.allSettled(sources.map(({ url, c }) => A().getJson(catalogUrl(url, c.type, c.id, { search: q }))
            .then(d => (d.metas || []).map(m => ({ ...m, type: m.type || c.type })))));
        const seen = new Set();
        const out = [];
        results.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(m => { if (m && m.id && !seen.has(m.id) && safeImg(m.poster)) { seen.add(m.id); out.push(m); } }); });
        // Series and movies kept apart, so a long list of one can't bury the other.
        const per = {};
        return out.filter(m => { const k = String(m.type || ''); per[k] = (per[k] || 0) + 1; return per[k] <= 40; });
    }

    // The remote moved into a row: get the next few ready so Down never waits on a fetch.
    function loadAhead(row, n) {
        let r = row;
        for (let k = 0; k < n && r; k++) { r = r.nextElementSibling; if (r && r._spec) loadRow(r); }
    }

    return { openTitle, closeTitle, askHowToWatch, showInvite, previewHero, rebuild: buildHome, loadAhead, loadRow, rowList, setRows, confirm, nativeRows, nativeSearch };
})();
