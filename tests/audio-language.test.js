const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Small DOM fixture; media APIs are simulated so native Safari tracks and HLS
// can both be checked without downloading a video or contacting an addon.
function setup() {
    class Events {
        constructor() { this.listeners = new Map(); }
        addEventListener(name, fn) {
            if (!this.listeners.has(name)) this.listeners.set(name, new Set());
            this.listeners.get(name).add(fn);
        }
        removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
        fire(name, event = {}) { this.listeners.get(name)?.forEach(fn => fn(event)); }
    }
    const document = new Events();
    class Element extends Events {
        constructor(tag) {
            super();
            this.tagName = tag;
            this.children = [];
            this.style = {};
            this.dataset = {};
            this.attrs = {};
            this.className = '';
            this.classList = {
                contains: name => this.className.split(' ').includes(name),
                add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
                remove: name => { this.className = this.className.split(' ').filter(n => n !== name).join(' '); },
                toggle: (name, on) => { this.classList[on ? 'add' : 'remove'](name); }
            };
        }
        appendChild(child) { child.parent = this; this.children.push(child); return child; }
        append(...children) { children.forEach(c => this.appendChild(c)); }
        set textContent(value) { this.text = value; this.children = []; }
        get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(' '); }
        set innerHTML(value) { assert.equal(value, ''); this.textContent = ''; }
        setAttribute(name, value) { this.attrs[name] = value; }
        getAttribute(name) { return this.attrs[name]; }
        find(predicate) {
            if (predicate(this)) return this;
            for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
            return null;
        }
        querySelector(selector) {
            if (selector.startsWith('.')) return this.find(e => e.classList.contains(selector.slice(1)));
            const index = selector.match(/^\[data-audio-index="(\d+)"\]$/);
            if (index) return this.find(e => e.dataset.audioIndex === index[1]);
            throw new Error(`Unexpected test selector: ${selector}`);
        }
        focus() { document.activeElement = this; }
        click() { this.focus(); this.fire('click', { target: this }); if (this.onclick) this.onclick(); }
        get isConnected() { return !!root.find(e => e === this); }
    }
    const root = new Element('body');
    document.activeElement = root;
    document.readyState = 'complete';
    document.createElement = tag => new Element(tag);
    document.getElementById = id => root.find(e => e.id === id);
    const add = (id, parent = root) => { const e = new Element('button'); e.id = id; parent.append(e); return e; };
    ['subsBtn', 'audioBtn', 'theaterAudioBtn', 'subFileInput'].forEach(id => add(id));
    const modal = add('trackModal');
    add('close', modal).className = 'modal-close';
    add('trackModalBody', modal);
    const storage = new Map();
    const Hls = { Events: { AUDIO_TRACKS_UPDATED: 'tracks', AUDIO_TRACK_SWITCHED: 'switched', ERROR: 'error' } };
    const window = { Hls };
    const context = vm.createContext({
        window, document, navigator: { language: 'en' }, Intl, console,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        URL: { revokeObjectURL() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/tracks.js'), 'utf8'), context);
    const video = (audioTracks = []) => Object.assign(new Events(), {
        audioTracks: Object.assign(audioTracks, {
            listeners: new Map(), addEventListener: Events.prototype.addEventListener,
            removeEventListener: Events.prototype.removeEventListener, fire: Events.prototype.fire
        }),
        currentTime: 123.5, paused: false, readyState: 4, error: null,
        src: 'https://example.test/movie.mp4',
        play() { throw new Error('Audio switching must not play the video'); },
        pause() { throw new Error('Audio switching must not pause the video'); },
        load() { throw new Error('Audio switching must not reload the video'); }
    });
    const hls = (audioTracks = []) => Object.assign(new Events(), {
        audioTracks, audioTrack: 0,
        on: Events.prototype.addEventListener, off: Events.prototype.removeEventListener,
        emit(name, data) { this.listeners.get(name)?.forEach(fn => fn(name, data)); }
    });
    return {
        tracks: window.tracks, video, hls, storage, document, window,
        $: document.getElementById,
        open() { document.getElementById('audioBtn').click(); },
        row(index) { return modal.querySelector(`[data-audio-index="${index}"]`); },
        text() { return document.getElementById('trackModalBody').textContent; }
    };
}

const nativeTracks = () => [
    { language: 'eng', label: 'Main', enabled: true },
    { language: 'hin', label: 'Dub', enabled: false }
];
const hlsTracks = () => [{ lang: 'en', name: 'Main' }, { lang: 'hi', name: 'Dub' }];

test('clicking the currently playing row cancels a pending embedded-audio change', () => {
    const s = setup(), v = s.video();
    v.audioTracks = undefined;
    const selections = [];
    const fallback = {
        tracks: [{ index: 1, language: 'hin' }, { index: 2, language: 'eng' }],
        selected: 1, pending: true, pendingIndex: 2, active: false,
        load: () => Promise.resolve(), prepare() {}, destroy() {},
        select(index) { selections.push(index); this.pending = false; this.pendingIndex = null; }
    };
    s.window.createAudioFallback = () => fallback;
    s.tracks.attach(v, 'https://example.test/video.mkv');
    s.open(); s.row(0).click();
    assert.deepEqual(selections, [1]);
    assert.equal(fallback.pending, false);
});

test('switches native audio without restarting or changing a playing or paused video', () => {
    for (const paused of [false, true]) {
        const s = setup(), v = s.video(nativeTracks());
        v.paused = paused;
        s.tracks.attach(v);
        s.open();
        assert.match(s.row(1).textContent, /Hindi.*Dub/);
        s.row(1).click();
        assert.equal(v.audioTracks[0].enabled, false);
        assert.equal(v.audioTracks[1].enabled, true);
        assert.equal(v.currentTime, 123.5);
        assert.equal(v.paused, paused);
        assert.equal(v.src, 'https://example.test/movie.mp4');
        assert.equal(s.row(1).getAttribute('aria-pressed'), 'true');
        assert.equal(s.storage.get('reddate-audio-lang'), 'hi');
    }
});

test('updates an open menu when native tracks arrive after metadata', () => {
    const s = setup(), v = s.video();
    v.readyState = 0;
    s.tracks.attach(v);
    s.open();
    assert.match(s.text(), /finishes loading/);
    v.audioTracks.push(...nativeTracks());
    v.readyState = 4;
    v.fire('loadedmetadata');
    assert.match(s.row(1).textContent, /Hindi/);
    v.audioTracks.push({ language: 'tam', enabled: false });
    v.audioTracks.fire('addtrack');
    assert.match(s.row(2).textContent, /Tamil/);
});

test('shows HLS tracks arriving later and confirms live switching on completion', () => {
    const s = setup(), v = s.video(), h = s.hls();
    s.tracks.attach(v);
    s.tracks.attachHls(h);
    s.open();
    h.audioTracks = hlsTracks();
    h.emit('tracks');
    s.row(1).click();
    assert.equal(h.audioTrack, 1);
    assert.match(s.text(), /Switching to Hindi/);
    h.emit('switched');
    assert.match(s.text(), /Selected Hindi/);
    assert.equal(v.currentTime, 123.5);
    assert.equal(v.paused, false);
    assert.equal(s.document.activeElement, s.row(1));
});

test('reports failed HLS audio and allows another choice', () => {
    const s = setup(), h = s.hls(hlsTracks());
    s.tracks.attach(s.video());
    s.tracks.attachHls(h);
    s.open();
    s.row(1).click();
    h.emit('error', { details: 'audioTrackLoadError', fatal: false });
    assert.match(s.text(), /Could not load that audio track/);
    s.row(0).click();
    h.emit('switched');
    assert.match(s.text(), /Selected English/);
});

test('restores the saved language when the next video publishes its tracks', () => {
    const s = setup();
    s.storage.set('reddate-audio-lang', 'hin');
    const v = s.video();
    s.tracks.attach(v);
    v.audioTracks.push(...nativeTracks());
    v.audioTracks.fire('addtrack');
    assert.equal(v.audioTracks[1].enabled, true);
    s.open();
    s.row(0).click();
    v.audioTracks.fire('addtrack');
    assert.equal(v.audioTracks[0].enabled, true);
    assert.equal(s.storage.get('reddate-audio-lang'), 'en');
});

test('leaves the source default alone when a preferred language is absent', () => {
    const s = setup(), v = s.video(nativeTracks());
    s.storage.set('reddate-audio-lang', 'ta');
    s.tracks.attach(v);
    assert.equal(v.audioTracks[0].enabled, true);
});

test('explains unavailable languages and single-track videos instead of hiding the button', () => {
    const s = setup();
    s.open();
    assert.match(s.text(), /Load a video/);
    s.tracks.attach(s.video());
    assert.match(s.text(), /No alternate audio/);
    assert.notEqual(s.$('audioBtn').style.display, 'none');
    s.tracks.attach(s.video(nativeTracks().slice(0, 1)));
    assert.match(s.text(), /one selectable audio track/);
    s.tracks.attachYouTube();
    s.open();
    assert.match(s.text(), /YouTube.*Settings.*Audio track/);
});

test('fullscreen uses the same menu and Escape returns focus to its button', () => {
    const s = setup();
    s.tracks.attach(s.video(nativeTracks()));
    s.$('theaterAudioBtn').click();
    assert.match(s.text(), /Hindi/);
    let prevented = false;
    s.document.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(s.$('trackModal').classList.contains('show'), false);
    assert.equal(s.document.activeElement, s.$('theaterAudioBtn'));
});

test('removes old media listeners when the video is replaced', () => {
    const s = setup(), v = s.video(nativeTracks()), h = s.hls(hlsTracks());
    s.tracks.attach(v);
    s.tracks.attachHls(h);
    s.tracks.detach();
    for (const emitter of [v, v.audioTracks, h]) {
        for (const handlers of emitter.listeners.values()) assert.equal(handlers.size, 0);
    }
    s.open();
    h.emit('tracks');
    assert.match(s.text(), /Load a video/);
});
