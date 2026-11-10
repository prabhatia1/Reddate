/* Shared subtitles and per-viewer audio-track switching for the direct-video player.
 *
 * Subtitle files, Off and timing changes are shared with the room. Audio stays personal.
 *
 * Subtitles come from Stremio subtitle addons (built-in OpenSubtitles v3 plus
 * any the room added, via window.reddateAddons) or a local .srt/.vtt file.
 * Addons serve SRT; browsers need WebVTT, so files are converted and attached
 * as a <track> from a blob: URL.
 *
 * Audio tracks use native audioTracks, hls.js audio groups, or the server's
 * embedded-file decoder through audio-fallback.js when the browser needs it.
 * The Language button stays available even when a source has no selectable
 * tracks, so viewers can see why and how to choose a different language.
 *
 * app.js calls tracks.attach(video) / attachHls(hls) / setContent(state) /
 * detach() as the player changes.
 */
window.tracks = (function () {
    const PREF_KEY = 'reddate-sub-lang';   // remembered subtitle language ('off' or code)
    const AUDIO_PREF_KEY = 'reddate-audio-lang';
    const OFFSET_STEP = 0.5;

    let video = null;
    let hls = null;
    let content = null;        // { type, id, filename } of what's playing, if known
    let subs = null;           // fetched subtitle list for `content`
    let subsPromise = null;
    let activeSubUrl = null;   // url (or 'file:<name>') of the subtitle showing
    let activeLang = 'off';
    let activeLabel = '';      // what the 'Showing …' line says for a loaded file
    let trackEl = null;
    let blobUrl = null;
    let offset = 0;            // seconds added to every cue
    let browsingLang = null;   // language selected in the panel
    let playerKind = null;     // 'direct' | 'yt' | null
    let audioStatus = '';
    let pendingAudio = null;
    let audioSelected = false; // an explicit choice wins over later metadata updates
    let removeListeners = [];
    let panelOpener = null;
    let fallback = null;
    let audioSelectionId = 0;
    let subtitleSelectionId = 0;
    let mediaId = null;
    let sharedSubtitle = null;
    let currentVtt = null;
    let onSubtitleChange = null;
    let onAudioChange = null;
    let settingsOwner = false;
    let subtitlePersonal = false;
    let audioPersonal = false;
    let roomAudio = null;
    let reportedAudio = '';
    let audioMediaId = null;
    let attachedSource = '';

    function reportAudio(force = false) {
        if (force) reportedAudio = '';
        if (!settingsOwner || !mediaId || audioMediaId !== mediaId || !onAudioChange || pendingAudio || fallback?.pending) return;
        const opts = audioOptions();
        const index = opts.findIndex(o => o.enabled);
        if (index < 0) return;
        const state = { language: opts[index].language || '', label: opts[index].label || '', index };
        const signature = JSON.stringify(state);
        if (signature === reportedAudio) return;
        reportedAudio = signature;
        onAudioChange({ mediaId, state });
    }

    function applyRoomAudio(state) {
        if (!state || typeof state.language !== 'string') return;
        roomAudio = state;
        refreshAudioOptions();
    }
    const MAX_SUB_BYTES = 5 * 1024 * 1024;

    function publishSubtitle() {
        const state = { vtt: currentVtt, key: activeSubUrl, lang: activeLang, label: activeLabel, offset };
        sharedSubtitle = state;
        subtitlePersonal = !settingsOwner;
        if (onSubtitleChange && mediaId && settingsOwner) onSubtitleChange({ mediaId, state });
    }

    function applySharedSubtitle(state, preserveSelection = false, force = false) {
        if (subtitlePersonal && !settingsOwner && !force) return;
        if (!state || (state.vtt !== null && typeof state.vtt !== 'string')) return;
        if (state.vtt && new TextEncoder().encode(state.vtt).length > MAX_SUB_BYTES) return;
        if (!preserveSelection) subtitleSelectionId++;
        sharedSubtitle = state;
        if (!video) return;
        if (state.vtt) attachVtt(state.vtt, String(state.key || 'shared'), String(state.lang || 'und'), String(state.label || 'Room subtitle'));
        else clearSubtitle();
        offset = Number.isFinite(state.offset) ? Math.max(-600, Math.min(600, state.offset)) : 0;
        shiftCues();
        setPanelStatus('');
        renderPanel();
    }

    const $ = id => document.getElementById(id);
    const modal = () => $('trackModal');
    const body = () => $('trackModalBody');

    function toast(msg) { if (window.showToast) window.showToast(msg); }

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function getPref() { try { return localStorage.getItem(PREF_KEY) || 'off'; } catch (e) { return 'off'; } }
    function setPref(v) { try { localStorage.setItem(PREF_KEY, v); } catch (e) {} }

    // ---------- language names ----------
    // OpenSubtitles uses ISO 639-2 codes (eng, spa, pob…); map to BCP 47 for Intl.
    const LANG_MAP = {
        eng: 'en', spa: 'es', spn: 'es', ea: 'es-419', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it',
        por: 'pt', pob: 'pt-BR', pb: 'pt-BR', rus: 'ru', ara: 'ar', hin: 'hi', tur: 'tr', per: 'fa', fas: 'fa',
        ell: 'el', gre: 'el', cze: 'cs', ces: 'cs', pol: 'pl', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no',
        dan: 'da', fin: 'fi', hun: 'hu', rum: 'ro', ron: 'ro', heb: 'he', jpn: 'ja', kor: 'ko', chi: 'zh',
        zho: 'zh', zht: 'zh-Hant', zhe: 'zh', ind: 'id', may: 'ms', msa: 'ms', tha: 'th', vie: 'vi',
        ukr: 'uk', bul: 'bg', hrv: 'hr', scc: 'sr', srp: 'sr', slv: 'sl', slo: 'sk', slk: 'sk', est: 'et',
        lav: 'lv', lit: 'lt', ben: 'bn', tam: 'ta', tel: 'te', mal: 'ml', urd: 'ur', kan: 'kn', mar: 'mr',
        ice: 'is', isl: 'is', bos: 'bs', mac: 'mk', mkd: 'mk', alb: 'sq', sqi: 'sq', geo: 'ka', kat: 'ka',
        arm: 'hy', hye: 'hy', cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl', tgl: 'tl', fil: 'fil', pan: 'pa',
        guj: 'gu', sin: 'si', khm: 'km', mon: 'mn', aze: 'az', kaz: 'kk', uzb: 'uz', bel: 'be', afr: 'af',
        swa: 'sw', amh: 'am', som: 'so', nep: 'ne'
    };
    let displayNames = null;
    try { displayNames = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }); } catch (e) {}
    function langName(code) {
        const tag = LANG_MAP[code] || code;
        try { const n = displayNames && displayNames.of(tag); if (n && n !== tag) return n; } catch (e) {}
        return (code || '?').toUpperCase();
    }

    // ---------- SRT → WebVTT ----------
    function decodeText(buf) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (e) { return new TextDecoder('windows-1252').decode(buf); } // common for old .srt files
    }

    function toVtt(text) {
        text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
        if (/^WEBVTT/.test(text)) return text;
        const body = text
            // 0:05:57,000 → 00:05:57.000 (VTT needs '.' and two-digit hours)
            .replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g,
                (_, h, m, s, ms) => `${h.padStart(2, '0')}:${m}:${s}.${ms.padEnd(3, '0')}`)
            .replace(/\{\\[^}]*\}/g, '')         // ASS override tags like {\an8}
            .replace(/<\/?font[^>]*>/gi, '');    // <font> isn't valid in VTT
        return 'WEBVTT\n\n' + body;
    }

    // ---------- ranking ----------
    // Subtitles timed for a different release drift, so prefer ones whose name
    // shares words with the playing file and push early CAM/TS rips down.
    function words(s) { return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1)); }
    function rankSubs(list) {
        const fileWords = words(content && content.filename);
        const score = s => {
            const n = s.name.toLowerCase();
            let sc = 0;
            words(n).forEach(w => { if (fileWords.has(w)) sc += 1; });
            if (/\b(cam|hdcam|ts|telesync|tc|telecine|scr|screener|r5|hdts)\b/.test(n)) sc -= 6;
            if (/blu-?ray|brrip|bdrip|web-?dl|webrip|\bweb\b|hdrip|dvdrip/.test(n)) sc += 2;
            return sc;
        };
        return list.map((s, i) => ({ s, sc: score(s), i })).sort((a, b) => b.sc - a.sc || a.i - b.i).map(x => x.s);
    }

    // ---------- applying subtitles ----------
    function clearSubtitle() {
        if (trackEl) { trackEl.remove(); trackEl = null; }
        if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
        activeSubUrl = null;
        activeLang = 'off';
        activeLabel = '';
        offset = 0;
        currentVtt = null;
    }

    function shiftCues() {
        const cues = trackEl && trackEl.track && trackEl.track.cues;
        if (!cues) return;
        for (const cue of cues) {
            if (cue._base === undefined) cue._base = [cue.startTime, cue.endTime];
            cue.startTime = Math.max(0, cue._base[0] + offset);
            cue.endTime = Math.max(0, cue._base[1] + offset);
        }
    }

    function attachVtt(vtt, key, lang, label) {
        if (!video) return;
        clearSubtitle();
        currentVtt = vtt;
        blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        trackEl = document.createElement('track');
        trackEl.kind = 'subtitles';
        trackEl.label = label;
        trackEl.srclang = LANG_MAP[lang] || 'und';
        trackEl.src = blobUrl;
        trackEl.default = true;
        trackEl.addEventListener('load', shiftCues);
        video.appendChild(trackEl);
        trackEl.track.mode = 'showing';
        activeSubUrl = key;
        activeLang = lang;
        activeLabel = label;
    }

    async function applySubtitle(sub) {
        if (!video) return;
        subtitlePersonal = !settingsOwner;
        const selection = ++subtitleSelectionId;
        const forVideo = video;
        setPanelStatus('Loading subtitle…');
        try {
            const res = await fetch(sub.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const vtt = toVtt(decodeText(await res.arrayBuffer()));
            if (selection !== subtitleSelectionId || video !== forVideo) return;
            if (new TextEncoder().encode(vtt).length > MAX_SUB_BYTES) throw new Error('max 5 MB');
            attachVtt(vtt, sub.url, sub.lang, langName(sub.lang));
            setPref(sub.lang);
            publishSubtitle();
            setPanelStatus('');
        } catch (e) {
            if (selection !== subtitleSelectionId || video !== forVideo) return;
            setPanelStatus(`Couldn't load that subtitle (${e.message}). Try another one.`);
        }
        renderPanel();
    }

    function loadSubtitleFile(file) {
        if (!file || !video) return;
        subtitlePersonal = !settingsOwner;
        if (file.size > 5 * 1024 * 1024) { toast('Subtitle file too large (max 5 MB)'); return; }
        const reader = new FileReader();
        const selection = ++subtitleSelectionId;
        const forVideo = video;
        reader.onload = () => {
            if (selection !== subtitleSelectionId || video !== forVideo) return;
            const vtt = toVtt(decodeText(reader.result));
            if (new TextEncoder().encode(vtt).length > MAX_SUB_BYTES) { toast('Subtitle file too large (max 5 MB)'); return; }
            attachVtt(vtt, `file:${file.name}`, 'und', file.name);
            publishSubtitle();
            renderPanel();
        };
        reader.readAsArrayBuffer(file);
    }

    function ensureSubs() {
        if (subs) return Promise.resolve(subs);
        if (!content || !window.reddateAddons) return Promise.resolve([]);
        if (!subsPromise) {
            const forContent = content;
            subsPromise = window.reddateAddons.fetchSubtitles(content.type, content.id)
                .then(list => { if (forContent === content) subs = rankSubs(list); return subs || []; })
                .catch(() => { subsPromise = null; return []; });
        }
        return subsPromise;
    }

    // ---------- audio tracks ----------
    function audioLanguage(code) {
        const tag = String(code || '').trim().toLowerCase().replace(/_/g, '-');
        if (!tag || tag === 'und' || tag === 'zxx') return '';
        const [base, ...region] = tag.split('-');
        return [LANG_MAP[base] || base, ...region].join('-').toLowerCase();
    }

    function audioLabel(name, language, index) {
        const label = String(name || '').trim();
        const lang = language && langName(language);
        if (!lang) return label || `Track ${index + 1}`;
        if (/^(audio|track)[ _-]?\d+$/i.test(label)) return lang;
        return label && label.toLowerCase() !== lang.toLowerCase() ? `${lang} · ${label}` : lang;
    }

    function audioOptions() {
        if (hls && hls.audioTracks && hls.audioTracks.length) {
            return hls.audioTracks.map((t, i) => ({
                language: audioLanguage(t.lang),
                label: audioLabel(t.name, audioLanguage(t.lang), i),
                enabled: i === hls.audioTrack,
                select: () => { hls.audioTrack = i; }
            }));
        }
        const list = video && video.audioTracks;
        if (list && list.length) {
            const tracks = Array.from({ length: list.length }, (_, i) => list[i]);
            return tracks.map((t, i) => ({
                language: audioLanguage(t.language),
                label: audioLabel(t.label, audioLanguage(t.language), i),
                enabled: t.enabled,
                select: () => {
                    // Enable the new track first so there is always an active one.
                    t.enabled = true;
                    tracks.forEach(o => { if (o !== t) o.enabled = false; });
                }
            }));
        }
        if (fallback && fallback.tracks.length) {
            const labels = fallback.tracks.map((t, i) => audioLabel(t.name, audioLanguage(t.language), i));
            return fallback.tracks.map((t, i) => ({
                language: audioLanguage(t.language),
                label: labels.filter(label => label === labels[i]).length > 1 ? `${labels[i]} · Track ${i + 1}` : labels[i],
                codec: t.codec,
                enabled: t.index === fallback.selected,
                pending: t.index === fallback.pendingIndex,
                select: () => fallback.select(t.index),
                prepare: () => fallback.prepare(t.index)
            }));
        }
        return [];
    }

    async function selectAudio(index, remember = true) {
        if (remember) audioPersonal = true;
        const opt = audioOptions()[index];
        if (!opt) return;
        const selectionId = ++audioSelectionId;
        const owner = video;
        try {
            audioStatus = '';
            if (!opt.enabled || fallback?.pending) {
                pendingAudio = hls ? { index, label: opt.label } : null;
                // Change only the audio track. Keep this player's source, position,
                // play/pause state and the room's shared playback state untouched.
                const result = opt.select();
                if (result && typeof result.then === 'function') await result;
            }
            if (owner !== video || selectionId !== audioSelectionId) return;
            if (remember) {
                audioSelected = true;
                try {
                    if (opt.language) localStorage.setItem(AUDIO_PREF_KEY, opt.language);
                    else localStorage.removeItem(AUDIO_PREF_KEY);
                } catch (_) {}
            }
            if (!pendingAudio) audioStatus = `Selected ${opt.label}.`;
        } catch (_) {
            if (owner !== video || selectionId !== audioSelectionId) return;
            pendingAudio = null;
            audioStatus = 'Could not switch audio. Try another language or stream.';
        }
        reportAudio();
        renderPanel();
    }

    function refreshAudioOptions() {
        // New viewers inherit the room selection before their saved language.
        if (roomAudio && !audioPersonal && !pendingAudio && !(fallback && (fallback.pending || !fallback.canAutoSelect))) {
            const opts = audioOptions();
            const language = audioLanguage(roomAudio.language);
            let index = opts.findIndex(o => o.language === language && o.label === roomAudio.label);
            if (index < 0 && language) index = opts.findIndex(o => o.language === language);
            if (index < 0 && language) index = opts.findIndex(o => o.language && o.language.split('-')[0] === language.split('-')[0]);
            if (index < 0 && !language && Number.isInteger(roomAudio.index) && opts[roomAudio.index]) index = roomAudio.index;
            if (index >= 0) {
                audioSelected = true;
                if (!opts[index].enabled) selectAudio(index, false);
            }
        }
        // Track lists may arrive after loadedmetadata, or change with an HLS group.
        if ((!roomAudio || audioPersonal) && !audioSelected && !pendingAudio && !(fallback && (fallback.pending || !fallback.canAutoSelect))) {
            let pref = '';
            try { pref = audioLanguage(localStorage.getItem(AUDIO_PREF_KEY)); } catch (_) {}
            if (pref) {
                const opts = audioOptions();
                let index = opts.findIndex(o => o.language === pref);
                if (index < 0) index = opts.findIndex(o => o.language && o.language.split('-')[0] === pref.split('-')[0]);
                if (index >= 0 && !opts[index].enabled) selectAudio(index, false);
            }
        }
        reportAudio();
        renderPanel();
    }

    function listen(target, event, handler) {
        target.addEventListener(event, handler);
        removeListeners.push(() => target.removeEventListener(event, handler));
    }

    function clearAudioListeners() {
        audioSelectionId++;
        if (fallback) { fallback.destroy(); fallback = null; }
        removeListeners.forEach(remove => remove());
        removeListeners = [];
        pendingAudio = null;
        audioStatus = '';
        audioSelected = false;
    }

    // ---------- UI ----------
    function updateButtons() {
        $('subsBtn').style.display = video ? '' : 'none';
        $('subsBtn').classList.toggle('is-on', !!activeSubUrl);
        const selected = audioOptions().find(o => o.enabled);
        ['audioBtn', 'theaterAudioBtn'].forEach(id => {
            const btn = $(id);
            if (!btn) return;
            const label = selected ? `Audio language: ${selected.label}` : 'Audio language';
            btn.title = label;
            btn.setAttribute('aria-label', label);
        });
    }

    function setPanelStatus(text) { const s = $('trackStatus'); if (s) s.textContent = text || ''; }

    let panelMode = null; // 'subs' | 'audio'

    function openPanel(mode) {
        if (!modal().classList.contains('show')) panelOpener = document.activeElement;
        panelMode = mode;
        modal().classList.toggle('audio-mode', mode === 'audio');
        modal().classList.add('show');
        renderPanel();
        modal().querySelector('.modal-close').focus({ preventScroll: true });
        if (mode === 'audio' && fallback) fallback.load().then(() => {
            refreshAudioOptions();
            if (!modal().classList.contains('show') || panelMode !== 'audio') return;
            const options = audioOptions();
            const current = options.find(o => o.enabled);
            let pref = '';
            try { pref = audioLanguage(localStorage.getItem(AUDIO_PREF_KEY)); } catch (_) {}
            const next = options.find(o => !o.enabled && o.language === pref) ||
                options.find(o => !o.enabled && o.language && o.language !== current?.language);
            if (next?.prepare) next.prepare();
        });
        if (mode === 'subs' && !subs && content) {
            setPanelStatus('Finding subtitles…');
            ensureSubs().then(() => { setPanelStatus(''); renderPanel(); });
        }
    }

    function renderPanel() {
        updateButtons();
        if (!modal().classList.contains('show')) return;
        const b = body();
        const focusedAudio = document.activeElement && document.activeElement.dataset.audioIndex;
        const scroll = b.querySelector('.audio-options')?.scrollTop || 0;
        const status = $('trackStatus') ? $('trackStatus').textContent : '';
        b.innerHTML = '';
        if (panelMode === 'audio') renderAudio(b); else renderSubs(b);
        const st = el('div', panelMode === 'audio' ? 'audio-status' : 'browse-status');
        st.id = 'trackStatus';
        st.setAttribute('role', 'status');
        st.textContent = panelMode === 'audio' ? (pendingAudio ? `Switching to ${pendingAudio.label}…` : fallback?.status || audioStatus || 'Changes apply only to you.') : status;
        (panelMode === 'audio' ? b.querySelector('.audio-footer') : b).appendChild(st);
        const audioList = b.querySelector('.audio-options');
        if (audioList) audioList.scrollTop = scroll;
        if (focusedAudio !== undefined && panelMode === 'audio') {
            const row = b.querySelector(`[data-audio-index="${focusedAudio}"]`);
            (row || modal().querySelector('.modal-close')).focus({ preventScroll: true });
        }
    }

    function renderAudio(b) {
        const heading = el('div', 'audio-heading');
        const title = el('h2', null, 'Audio language');
        title.id = 'trackModalTitle';
        const options = audioOptions();
        heading.append(title, el('p', 'audio-description', 'Choose the language you hear.'));
        if (options.length) heading.appendChild(el('div', 'audio-count', `${options.length} ${options.length === 1 ? 'track' : 'tracks'} available`));
        b.appendChild(heading);
        let explanation = '';
        if (!playerKind) explanation = 'Load a video to see its audio languages.';
        else if (playerKind === 'yt') explanation = 'For a YouTube video with alternate audio, open Settings (⚙) in the video, then Audio track. If that option is missing, the video does not offer another audio language.';
        else if (video.error) explanation = 'This video could not be loaded. Choose another stream to see its audio languages.';
        else if (!options.length && fallback) explanation = '';
        else if (!options.length && video.readyState === 0) explanation = 'Audio languages will appear when the video finishes loading.';
        else if (options.length === 1) explanation = 'This stream offers one selectable audio track. Choose another stream for a different language.';
        else if (!options.length) explanation = 'No alternate audio is available to this player. Some browsers cannot switch audio inside MP4 or MKV files. Try a multi-language HLS stream or open this video in Safari.';
        const list = el('div', 'audio-options');
        list.setAttribute('role', 'group');
        list.setAttribute('aria-label', 'Available audio languages');
        if (explanation) list.appendChild(el('p', 'audio-explanation', explanation));
        options.forEach((opt, index) => {
            const switching = opt.pending || pendingAudio?.index === index;
            const row = el('button', `audio-option${opt.enabled ? ' active' : ''}${switching ? ' is-pending' : ''}`);
            row.type = 'button';
            row.dataset.audioIndex = String(index);
            row.setAttribute('aria-pressed', String(opt.enabled));
            row.setAttribute('aria-label', opt.label);
            if (switching) row.setAttribute('aria-busy', 'true');
            const mark = el('span', 'audio-choice-mark', opt.enabled && !switching ? '✓' : '');
            mark.setAttribute('aria-hidden', 'true');
            const info = el('span', 'audio-option-info');
            const name = opt.language ? langName(opt.language) : opt.label;
            const detail = opt.label.startsWith(`${name} · `) ? opt.label.slice(name.length + 3) : opt.label === name ? '' : opt.label;
            const details = [detail, opt.codec ? String(opt.codec).toUpperCase() : ''].filter(Boolean).join(' · ');
            info.appendChild(el('span', 'audio-option-name', name));
            if (details) info.appendChild(el('span', 'audio-option-detail', details));
            row.append(mark, info);
            row.onclick = () => selectAudio(index);
            if (opt.prepare) { row.onpointerenter = opt.prepare; row.onfocus = opt.prepare; }
            list.appendChild(row);
        });
        b.appendChild(list);
        b.appendChild(el('div', 'audio-footer'));
    }

    function icon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#i-${name}`);
        svg.appendChild(use);
        return svg;
    }

    function renderSubs(b) {
        const title = el('h2', null, 'Subtitles');
        title.id = 'trackModalTitle';
        b.appendChild(title);
        b.appendChild(el('div', 'addon-help', 'Start with the room subtitles. Your personal changes take priority.'));

        // What's showing right now.
        const now = el('div', `sub-now ${activeSubUrl ? 'on' : ''}`);
        now.appendChild(icon('captions'));
        now.appendChild(document.createTextNode(activeSubUrl ? 'Showing ' : 'Subtitles are off'));
        if (activeSubUrl) {
            const pick = (subs || []).find(s => s.url === activeSubUrl);
            now.appendChild(el('b', null, pick ? `${langName(pick.lang)} · ${pick.name || pick.addon}` : activeLabel));
        }
        b.appendChild(now);

        const langs = new Map();
        (subs || []).forEach(s => langs.set(s.lang, (langs.get(s.lang) || 0) + 1));
        const pref = getPref();
        if (!browsingLang) browsingLang = activeLang !== 'off' ? activeLang : (langs.has(pref) ? pref : (langs.has('eng') ? 'eng' : [...langs.keys()][0] || null));

        const bar = el('div', 'browse-bar');
        const off = el('button', `tab-btn ${activeSubUrl ? '' : 'active'}`, 'Off');
        off.onclick = () => { subtitleSelectionId++; clearSubtitle(); setPref('off'); publishSubtitle(); renderPanel(); };
        bar.appendChild(off);
        if (langs.size) {
            const sel = el('select', 'browse-select');
            sel.setAttribute('aria-label', 'Subtitle language');
            [...langs.entries()]
                .sort((a, b) => (a[0] === pref ? -1 : b[0] === pref ? 1 : langName(a[0]).localeCompare(langName(b[0]))))
                .forEach(([code, n]) => {
                    const o = el('option', null, `${langName(code)} (${n})`);
                    o.value = code;
                    sel.appendChild(o);
                });
            sel.value = browsingLang;
            sel.onchange = () => { browsingLang = sel.value; renderPanel(); };
            bar.appendChild(sel);
        }
        b.appendChild(bar);

        if (content && subs && !subs.length) b.appendChild(el('div', 'browse-status', 'No subtitles found for this title.'));
        if (!content) b.appendChild(el('div', 'browse-status', 'Online subtitles are available for movies & shows picked from 🍿 Browse. You can still load your own file.'));

        const list = el('div', 'stream-list sub-list');
        (subs || []).filter(s => s.lang === browsingLang).forEach((s, i) => {
            const active = s.url === activeSubUrl;
            const row = el('button', `stream-row ${active ? 'active' : ''}`);
            row.appendChild(el('div', 'stream-top', `${active ? '✔ ' : ''}${langName(s.lang)} #${i + 1} · ${s.addon}`));
            if (s.name) row.appendChild(el('div', 'stream-desc', s.name));
            row.onclick = () => applySubtitle(s);
            list.appendChild(row);
        });
        b.appendChild(list);

        if (activeSubUrl) {
            b.appendChild(el('div', 'sub-section', 'Timing'));
            const timing = el('div', 'sub-timing');
            const stepper = el('div', 'stepper');
            const minus = el('button', null, '−');
            const plus = el('button', null, '+');
            minus.setAttribute('aria-label', `Show subtitles ${OFFSET_STEP}s earlier`);
            plus.setAttribute('aria-label', `Show subtitles ${OFFSET_STEP}s later`);
            const val = el('span', 'sub-offset mono', `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`);
            val.setAttribute('aria-live', 'polite');
            minus.onclick = () => { offset = Math.max(-600, offset - OFFSET_STEP); shiftCues(); publishSubtitle(); renderPanel(); };
            plus.onclick = () => { offset = Math.min(600, offset + OFFSET_STEP); shiftCues(); publishSubtitle(); renderPanel(); };
            stepper.append(minus, val, plus);
            timing.append(stepper, el('span', 'addon-help', 'Subtitles too early? Press +. Too late? Press −.'));
            b.appendChild(timing);
        }

        const fileBtn = el('button', 'btn sub-file');
        fileBtn.append(icon('upload'), document.createTextNode('Use my own .srt / .vtt'));
        fileBtn.onclick = () => $('subFileInput').click();
        b.appendChild(fileBtn);
    }

    // ---------- wiring ----------
    function wire() {
        $('subsBtn').addEventListener('click', () => openPanel('subs'));
        $('audioBtn').addEventListener('click', () => openPanel('audio'));
        $('theaterAudioBtn').addEventListener('click', () => openPanel('audio'));
        const closePanel = () => {
            modal().classList.remove('show');
            if (panelOpener && panelOpener.isConnected) panelOpener.focus({ preventScroll: true });
        };
        modal().querySelector('.modal-close').addEventListener('click', closePanel);
        modal().addEventListener('click', e => { if (e.target === modal()) closePanel(); });
        document.addEventListener('keydown', e => {
            if (!modal().classList.contains('show')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closePanel();
            } else if (e.key === 'Tab') {
                const focusable = [...modal().querySelectorAll('button, select, input, [tabindex="0"]')].filter(e => !e.disabled);
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
        $('subFileInput').addEventListener('change', e => {
            loadSubtitleFile(e.target.files[0]);
            e.target.value = '';
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

    return {
        configureRoom(onChange, onAudio) { onSubtitleChange = onChange; onAudioChange = onAudio; },
        setSettingsOwner(owns) {
            const becameOwner = !!owns && !settingsOwner;
            settingsOwner = !!owns;
            if (becameOwner && subtitlePersonal && sharedSubtitle && onSubtitleChange) {
                subtitlePersonal = false;
                onSubtitleChange({ mediaId, state: sharedSubtitle });
            }
            reportAudio();
        },
        applyRoomAudio,
        reportAudio,
        makeSubtitlePersonal() { subtitlePersonal = !settingsOwner; },
        setMedia(id, source) {
            if (id === mediaId) return;
            mediaId = id;
            audioMediaId = video && source && source === attachedSource ? id : null;
            subtitlePersonal = false;
            audioPersonal = false;
            roomAudio = null;
            reportedAudio = '';
            subtitleSelectionId++;
            sharedSubtitle = null;
            clearSubtitle();
        },
        applyShared: applySharedSubtitle,
        // A new <video> was created for a direct stream.
        attach(v, src) {
            clearAudioListeners();
            video = v;
            attachedSource = src || '';
            audioMediaId = mediaId;
            playerKind = 'direct';
            hls = null;
            trackEl = null;
            blobUrl = null;
            activeSubUrl = null;
            activeLang = 'off';
            activeLabel = '';
            offset = 0;
            browsingLang = null;
            content = null;      // setContent() follows for every new player
            subs = null;
            subsPromise = null;
            if (src && !v.audioTracks && !/\.m3u8($|\?)/i.test(src) && window.createAudioFallback) {
                fallback = window.createAudioFallback(v, src, renderPanel);
            }
            if (v.audioTracks && v.audioTracks.addEventListener) {
                ['addtrack', 'removetrack'].forEach(ev => listen(v.audioTracks, ev, refreshAudioOptions));
                listen(v.audioTracks, 'change', refreshAudioOptions);
            }
            listen(v, 'loadedmetadata', refreshAudioOptions);
            if (fallback) listen(v, 'loadedmetadata', () => fallback?.load());
            listen(v, 'error', renderPanel);
            refreshAudioOptions();
            if (sharedSubtitle) applySharedSubtitle(sharedSubtitle, true, true);
        },
        attachHls(h) {
            hls = h;
            if (window.Hls) {
                const on = (event, handler) => {
                    if (!event) return;
                    h.on(event, handler);
                    removeListeners.push(() => h.off(event, handler));
                };
                on(window.Hls.Events.AUDIO_TRACKS_UPDATED, refreshAudioOptions);
                on(window.Hls.Events.AUDIO_TRACK_SWITCHED, () => {
                    if (pendingAudio && pendingAudio.index === h.audioTrack) {
                        audioStatus = `Selected ${pendingAudio.label}.`;
                        pendingAudio = null;
                    }
                    reportAudio();
                    renderPanel();
                });
                on(window.Hls.Events.ERROR, (_event, data) => {
                    if (pendingAudio && data && (data.fatal || /audioTrack/i.test(data.details || '') || data.frag && data.frag.type === 'audio')) {
                        pendingAudio = null;
                        audioStatus = 'Could not load that audio track. Try another language or stream.';
                        renderPanel();
                    }
                });
            }
            refreshAudioOptions();
        },
        attachYouTube() {
            this.detach();
            playerKind = 'yt';
            updateButtons();
        },
        // What's playing (from the room's video state); null for pasted links.
        setContent(c) {
            const next = c && c.id ? c : null;
            if (next && content && next.id === content.id && next.filename === content.filename) return;
            content = next;
            subs = null;
            subsPromise = null;
            browsingLang = null;
        },
        detach() {
            subtitleSelectionId++;
            clearAudioListeners();
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            video = null;
            audioMediaId = null;
            attachedSource = '';
            hls = null;
            playerKind = null;
            trackEl = null;
            blobUrl = null;
            activeSubUrl = null;
            content = null;
            subs = null;
            subsPromise = null;
            updateButtons();
            if (modal()) modal().classList.remove('show');
        }
    };
})();
