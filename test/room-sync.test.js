const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
const root = path.resolve(__dirname, '..');

function event(socket, name) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, done); reject(new Error(`Timed out: ${name}`)); }, 5000);
        function done(data) { clearTimeout(timer); resolve(data); }
        socket.once(name, done);
    });
}
const ack = (socket, name, data) => new Promise((resolve, reject) => socket.timeout(5000).emit(name, data, (error, result) => error ? reject(error) : resolve(result)));

test('TV late join gets live video, subtitles, offset and Off; stale selections are rejected', { timeout: 20000 }, async t => {
    const probe = net.createServer(); probe.listen(0); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => server.kill());
    await new Promise((resolve, reject) => { server.stdout.on('data', data => { if (String(data).includes('server running')) resolve(); }); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const connect = async () => { const s = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false }); t.after(() => s.disconnect()); await event(s, 'connect'); return s; };
    const roomId = 'tv-sync-regression'; const host = await connect();
    let joined = event(host, 'joined'); host.emit('join-room', { roomId, username: 'Host', resumeId: 'a'.repeat(32) }); await joined;
    let loaded = event(host, 'video-loaded'); host.emit('load-video', { kind: 'direct', src: 'https://example.com/movie.mp4' }); const movie = await loaded;
    host.emit('video-playpause', { currentTime: 70, isPlaying: true });
    const state = { vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello', key: 'file:movie.vtt', lang: 'eng', label: 'English', offset: 1.5 };
    assert.equal((await ack(host, 'set-subtitles', { mediaId: movie.mediaId, state })).ok, true);
    const audio = { language: 'hi', label: 'Hindi', index: 1 };
    assert.equal((await ack(host, 'set-audio', { mediaId: movie.mediaId, state: audio })).ok, true);
    await new Promise(resolve => setTimeout(resolve, 150));
    const guest = await connect(); joined = event(guest, 'joined'); const snapshot = event(guest, 'video-sync'); const replay = event(guest, 'subtitles-updated');
    const firstAudio = event(guest, 'audio-updated');
    guest.emit('join-room', { roomId, username: 'Guest' }); await joined;
    const live = await snapshot; assert.equal(live.src, 'https://example.com/movie.mp4'); assert.equal(live.isPlaying, true); assert.ok(live.currentTime > 70.1);
    assert.deepEqual((await replay).state, { ...state, embeddedLang: '' });
    assert.deepEqual((await firstAudio).state, audio);
    assert.equal((await ack(guest, 'set-subtitles', { mediaId: movie.mediaId, state: { vtt: null, offset: 0 } })).personal, true);
    assert.equal((await ack(guest, 'set-audio', { mediaId: movie.mediaId, state: { language: 'en', label: 'English', index: 0 } })).personal, true);
    const newcomer = await connect(); const nextAudio = event(newcomer, 'audio-updated'), nextSub = event(newcomer, 'subtitles-updated'); joined = event(newcomer, 'joined');
    newcomer.emit('join-room', { roomId, username: 'Next guest' }); await joined;
    assert.deepEqual((await nextAudio).state, audio); assert.deepEqual((await nextSub).state, { ...state, embeddedLang: '' });
    for (const next of [{ ...state, offset: -1.5 }, { vtt: null, key: '', lang: 'off', label: '', offset: 0 }, { vtt: null, key: '', lang: 'hin', label: 'Hindi', embeddedLang: 'hin', offset: 0 }]) {
        const changed = event(guest, 'subtitles-updated');
        assert.equal((await ack(host, 'set-subtitles', { mediaId: movie.mediaId, state: next })).ok, true);
        assert.deepEqual((await changed).state, { ...next, embeddedLang: next.embeddedLang || '' });
    }
    loaded = event(host, 'video-loaded'); host.emit('load-video', { kind: 'direct', src: 'https://example.com/movie.mp4' });
    const resetMovie = await loaded;
    assert.notEqual(resetMovie.mediaId, movie.mediaId);
    assert.equal((await ack(host, 'set-subtitles', { mediaId: movie.mediaId, state })).ok, false);
    await ack(host, 'set-audio', { mediaId: resetMovie.mediaId, state: audio });
    host.disconnect(); guest.disconnect(); newcomer.disconnect();
    await new Promise(resolve => setTimeout(resolve, 150));
    const returning = await connect(); joined = event(returning, 'joined');
    const resumed = event(returning, 'video-sync'), resumedAudio = event(returning, 'audio-updated');
    returning.emit('join-room', { roomId, username: 'Host', resumeId: 'a'.repeat(32) }); await joined;
    const restored = await resumed;
    assert.equal(restored.mediaId, resetMovie.mediaId); assert.equal(restored.settingsOwner, returning.id);
    assert.deepEqual((await resumedAudio).state, audio);
});

test('TV player projects the room position while a newcomer loads', () => {
    const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
    let now = 1000; const seeks = [], commands = [];
    const context = vm.createContext({ Number, Math, Date: { now: () => now }, serverNow: () => now,
        anchor: { isPlaying: true, currentTime: 90, at: 1000 }, isPlayerReady: false, isVideoPlaying: false,
        vp: { getCurrentTime: () => 0, seekTo: t => seeks.push(t), play: () => commands.push('play'), pause: () => commands.push('pause') },
        updatePlayPauseButton() {}, steer: fn => fn(), pendingSeekAt: 0, seekAim: 0, seekLag: 2500 });
    vm.runInContext(source.slice(source.indexOf('function roomPos()'), source.indexOf('// Our own commands')), context);
    vm.runInContext(source.slice(source.indexOf('function applyAnchor()'), source.indexOf('// How long a jump')), context);
    vm.runInContext('applyAnchor()', context); assert.equal(seeks.length, 0);
    now += 6000; context.isPlayerReady = true; vm.runInContext('applyAnchor()', context);
    assert.equal(seeks.at(-1), 98.5); assert.equal(commands.at(-1), 'play');
    context.anchor = { isPlaying: false, currentTime: 0, at: now }; vm.runInContext('applyAnchor()', context);
    assert.equal(commands.at(-1), 'pause');
});

test('TV web subtitle picker shares exact files and delay, ignores stale downloads, and applies remote Off without echo', async () => {
    const ts = require('../web/node_modules/typescript');
    const source = fs.readFileSync(path.join(root, 'web/src/screens/Player.tsx'), 'utf8');
    const pending = new Map(), sent = [], rendered = {}; let sharedEffect;
    const context = vm.createContext({ TextDecoder, TextEncoder, Number, Math, Array, String,
        subtitlePersonal: { current: false }, subSelection: { current: 0 }, selectedSub: { current: {} }, sharedSubRevision: { current: '' },
        info: {}, vref: { current: {} }, hls: { current: null }, Hls: { Events: {} }, MAX_SUB_BYTES: 3000000,
        setCues: c => { rendered.cues = c; }, setSubLabel: l => { rendered.label = l; }, setSubUrl: u => { rendered.url = u; }, setSubDelay: d => { rendered.delay = d; },
        send: e => sent.push(e), toast: message => { throw new Error(message); }, useEffect: fn => { sharedEffect = fn; },
        fetch: url => new Promise(resolve => pending.set(url, resolve)) });
    const parsed = ts.transpile(fs.readFileSync(path.join(root, 'web/src/subs.ts'), 'utf8').replace(/export /g, ''), { target: ts.ScriptTarget.ES2020 });
    vm.runInContext(parsed, context);
    const logic = source.slice(source.indexOf('    async function useSub('), source.indexOf('    // Pick the remembered'));
    vm.runInContext(ts.transpile(logic, { target: ts.ScriptTarget.ES2020 }), context);
    const text = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello';
    const response = { ok: true, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
    const old = vm.runInContext("useSub({url:'old',lang:'eng'})", context);
    const latest = vm.runInContext("useSub({url:'latest',lang:'hin'})", context);
    pending.get('latest')(response); await latest; pending.get('old')(response); await old;
    assert.equal(rendered.url, 'latest'); assert.equal(sent.filter(e => e.type === 'subtitle').length, 1);
    vm.runInContext('changeSubDelay(1.25)', context); assert.equal(sent.at(-1).state.offset, 1.25);
    context.info = { roomSubtitle: { mediaId: 'movie', revision: 2, state: { vtt: null, lang: 'off', offset: 0 }, own: false } };
    context.subtitlePersonal.current = false; const before = sent.length; sharedEffect(); assert.equal(sent.length, before); assert.equal(rendered.cues.length, 0); assert.equal(rendered.delay, 0);
    context.subtitlePersonal.current = true; rendered.url = 'personal';
    context.info = { roomSubtitle: { mediaId: 'movie', revision: 3, state: { vtt: text, key: 'host', offset: 2 }, own: false } };
    sharedEffect(); assert.equal(rendered.url, 'personal'); assert.equal(sent.length, before);
});

test('shared subtitle file, timing and Off replay on player replacement without echo', async () => {
    const elements = new Map();
    const element = () => ({ style: {}, classList: { contains: () => false, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {}, track: { cues: [{ startTime: 1, endTime: 3 }] }, appendChild() {} });
    const document = { readyState: 'loading', addEventListener() {}, getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
    const shared = [];
    const context = vm.createContext({ window: {}, document, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob, TextEncoder, TextDecoder, localStorage: { getItem: () => 'off', setItem() {} }, fetch: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHi').buffer }) });
    const source = fs.readFileSync(path.join(root, 'public/tracks.js'), 'utf8').replace('configureRoom(onChange, onAudio)', '_audio: selectAudio, _pick: applySubtitle, _render: renderSubs, configureRoom(onChange, onAudio)');
    vm.runInContext(source, context);
    const tracks = context.window.tracks; tracks.configureRoom(s => shared.push(s)); tracks.setMedia('first'); tracks.setSettingsOwner(true);
    let attached; const video = { ...element(), appendChild: t => { attached = t; } };
    tracks.attach(video); await tracks._pick({ url: 'https://example.com/en.vtt', lang: 'eng' });
    assert.equal(shared.length, 1); assert.ok(shared[0].state.vtt.startsWith('WEBVTT'));
    tracks.applyShared({ ...shared[0].state, offset: 2 }); assert.equal(attached.track.cues[0].startTime, 3); assert.equal(shared.length, 1);
    tracks.detach(); tracks.attach(video); assert.equal(attached.track.cues[0].startTime, 3);
    tracks.applyShared({ vtt: null, offset: 0 }); assert.equal(shared.length, 1);
    tracks.setMedia('second'); tracks.detach(); attached = null; tracks.attach(video); assert.equal(attached, null);
});


test('new viewers inherit delayed audio tracks and can keep personal audio and subtitles', async () => {
    const elements = new Map();
    const element = () => ({ children: [], style: {}, classList: { contains: () => false, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() { this.removed = true; }, track: { cues: [{ startTime: 1, endTime: 3 }] }, appendChild(e) { this.children.push(e); }, append(...nodes) { this.children.push(...nodes); } });
    const document = { readyState: 'loading', addEventListener() {}, getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element, createElementNS: element, createTextNode: text => ({ textContent: text }) };
    const shared = [], audio = []; const handlers = {}; let appends = 0;
    const context = vm.createContext({ window: {}, document, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob, TextEncoder, TextDecoder, localStorage: { getItem: () => 'off', setItem() {}, removeItem() {} } });
    const source = fs.readFileSync(path.join(root, 'public/tracks.js'), 'utf8').replace('configureRoom(onChange, onAudio)', '_audio: selectAudio, _render: renderSubs, configureRoom(onChange, onAudio)');
    vm.runInContext(source, context); const tracks = context.window.tracks;
    tracks.configureRoom(s => shared.push(s), s => audio.push(s)); tracks.setMedia('movie'); tracks.setSettingsOwner(false);
    const video = { ...element(), audioTracks: [], addEventListener: (name, fn) => { (handlers[name] ||= []).push(fn); }, appendChild: () => { appends++; } };
    tracks.attach(video); tracks.applyRoomAudio({ language: 'hi', label: 'Hindi', index: 1 });
    video.audioTracks.push({ language: 'en', label: 'English', enabled: true }, { language: 'hi', label: 'Hindi', enabled: false });
    handlers.loadedmetadata.forEach(fn => fn()); assert.equal(video.audioTracks[1].enabled, true);
    await tracks._audio(0); assert.equal(video.audioTracks[0].enabled, true);
    tracks.applyRoomAudio({ language: 'hi', label: 'Hindi', index: 1 }); assert.equal(video.audioTracks[0].enabled, true); assert.equal(audio.length, 0);
    const state = { vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello', key: 'room', label: 'English', lang: 'eng', offset: 0 };
    tracks.applyShared(state); assert.equal(appends, 1);
    const panel = element(); tracks._render(panel); panel.children.find(e => e.children?.some(c => c.textContent === 'Off'))?.children.find(c => c.textContent === 'Off').onclick();
    const off = panel.children.flatMap(e => e.children || []).find(e => e.textContent === 'Off'); assert.ok(off);
    tracks.applyShared({ ...state, offset: 2 }); assert.equal(appends, 1); assert.equal(shared.length, 0);
    tracks.setMedia('next movie'); tracks.applyShared(state); assert.equal(appends, 2);
});


test('browser session restores only this tab?s joined room and keeps keys out of storage', async () => {
    const session = new Map(), local = new Map();
    const storage = map => ({ getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) });
    const context = vm.createContext({ window: {}, sessionStorage: storage(session), localStorage: storage(local), crypto: require('node:crypto').webcrypto, Uint8Array });
    vm.runInContext(fs.readFileSync(path.join(root, 'public/browser-session.js'), 'utf8'), context);
    const helper = context.window.reddateBrowserSession;
    helper.save({ roomId: 'room-a', roomCode: 'A7B2C', name: 'Alice' });
    assert.equal(helper.resumeForRoom('room-a').name, 'Alice'); assert.equal(helper.resumeForRoom('A7B2C').roomId, 'room-a');
    assert.equal(helper.resumeForRoom('room-b'), null); assert.equal(helper.savedName(), 'Alice');
    const id = helper.clientId();
    vm.runInContext(fs.readFileSync(path.join(root, 'public/browser-session.js'), 'utf8'), context);
    assert.equal(context.window.reddateBrowserSession.clientId(), id);
    assert.ok(!session.get('reddate-browser-session-v1').includes('key'));
    helper.clear(); assert.equal(helper.resumeForRoom('room-a'), null); assert.equal(helper.savedName(), 'Alice');
    session.set('reddate-browser-session-v1', '{broken'); assert.equal(helper.resumeForRoom('room-a'), null);
});
