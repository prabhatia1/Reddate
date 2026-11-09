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

test('late join receives live position and encrypted subtitles; slow progress cannot rewind room', { timeout: 20000 }, async t => {
    const probe = net.createServer(); probe.listen(0); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => server.kill());
    await new Promise((resolve, reject) => { server.stdout.on('data', data => { if (String(data).includes('server running')) resolve(); }); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
    const connect = async () => { const s = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false }); t.after(() => s.disconnect()); await event(s, 'connect'); return s; };
    const host = await connect(); const roomId = 'sync-regression';
    await ack(host, 'join-room', { roomId, username: 'Host' });
    const loaded = event(host, 'video-loaded');
    assert.equal((await ack(host, 'load-video', { kind: 'direct', src: 'https://example.com/movie.mp4' })).ok, true);
    const movie = await loaded;
    host.emit('video-playpause', { isPlaying: true, currentTime: 80 });
    const cryptoContext = vm.createContext({ crypto: require('node:crypto').webcrypto, TextEncoder, TextDecoder, btoa, atob, Uint8Array });
    vm.runInContext(fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').split('// ---------------- Fragment parsing')[0], cryptoContext);
    const state = { vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello', key: 'file:movie.vtt', lang: 'eng', label: 'English', offset: 1.5 };
    const key = await vm.runInContext('generateRoomKey()', cryptoContext);
    cryptoContext.key = key; cryptoContext.text = JSON.stringify(state);
    const payload = await vm.runInContext('encryptText(key, text)', cryptoContext);
    assert.equal((await ack(host, 'set-subtitles', { ...payload, mediaId: movie.mediaId })).ok, true);
    const audio = { language: 'hi', label: 'Hindi', index: 1 };
    cryptoContext.text = JSON.stringify(audio);
    const audioPayload = await vm.runInContext('encryptText(key, text)', cryptoContext);
    assert.equal((await ack(host, 'set-audio', { ...audioPayload, mediaId: movie.mediaId })).ok, true);
    await new Promise(resolve => setTimeout(resolve, 160));
    const guest = await connect(); const snapshot = event(guest, 'video-sync'); const sub = event(guest, 'subtitles-updated');
    const initialAudio = event(guest, 'audio-updated');
    await ack(guest, 'join-room', { roomId, username: 'Guest' });
    const live = await snapshot;
    assert.equal(live.src, 'https://example.com/movie.mp4'); assert.equal(live.isPlaying, true); assert.ok(live.currentTime > 80.1);
    cryptoContext.payload = await sub;
    assert.deepEqual(JSON.parse(await vm.runInContext('decryptText(key, payload)', cryptoContext)), state);
    cryptoContext.payload = await initialAudio;
    assert.deepEqual(JSON.parse(await vm.runInContext('decryptText(key, payload)', cryptoContext)), audio);
    assert.equal((await ack(guest, 'set-subtitles', { ...audioPayload, mediaId: movie.mediaId })).personal, true);
    assert.equal((await ack(guest, 'set-audio', { ...payload, mediaId: movie.mediaId })).personal, true);
    const newcomer = await connect(); const nextAudio = event(newcomer, 'audio-updated'), nextSub = event(newcomer, 'subtitles-updated');
    await ack(newcomer, 'join-room', { roomId, username: 'Next guest' });
    cryptoContext.payload = await nextAudio;
    assert.deepEqual(JSON.parse(await vm.runInContext('decryptText(key, payload)', cryptoContext)), audio);
    cryptoContext.payload = await nextSub;
    assert.deepEqual(JSON.parse(await vm.runInContext('decryptText(key, payload)', cryptoContext)), state);
    guest.emit('video-progress', { currentTime: 0 });
    const projected = event(host, 'video-sync'); host.emit('sync-request', {});
    assert.ok((await projected).currentTime > 80);
    for (const next of [{ ...state, offset: -2 }, { vtt: null, key: null, lang: 'off', label: '', offset: 0 }]) {
        cryptoContext.text = JSON.stringify(next);
        const encrypted = await vm.runInContext('encryptText(key, text)', cryptoContext);
        const changed = event(guest, 'subtitles-updated');
        await ack(host, 'set-subtitles', { ...encrypted, mediaId: movie.mediaId });
        cryptoContext.payload = await changed;
        assert.deepEqual(JSON.parse(await vm.runInContext('decryptText(key, payload)', cryptoContext)), next);
    }
    const reset = event(host, 'video-loaded');
    await ack(host, 'load-video', { kind: 'direct', src: 'https://example.com/movie.mp4' });
    assert.notEqual((await reset).mediaId, movie.mediaId);
    assert.equal((await ack(host, 'set-subtitles', { ...payload, mediaId: movie.mediaId })).ok, false);
});

test('player catches up after delayed readiness, seeks to zero, and recovers blocked autoplay locally', () => {
    const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
    let now = 1000; const seeks = [], commands = [], handlers = {}, sent = [];
    const context = vm.createContext({ Date: { now: () => now }, Number, Math, Promise, setInterval: () => {},
        window: {}, socket: { on: (name, fn) => { handlers[name] = fn; }, emit: (...args) => sent.push(args) },
        roomPlayback: null, pendingState: null, autoplayBlocked: false, currentMediaId: null, subtitleRevision: 0,
        isPlayerReady: false, isVideoPlaying: false, ignoreNextStateChange: false,
        vp: { seekTo: t => seeks.push(t), play: () => commands.push('play'), pause: () => commands.push('pause') },
        ensurePlayer: () => true, setNowPlaying: () => {}, updatePlayPauseButton: () => {}, addSystemMessage: () => {}, setPlayerStatus: () => {}, showToast: () => {} });
    vm.runInContext(source.slice(source.indexOf('function playbackState('), source.indexOf('function createYouTubePlayer(')), context);
    vm.runInContext(source.slice(source.indexOf('function wireVideoEvents('), source.indexOf('function setNowPlaying(')), context);
    vm.runInContext(source.slice(source.indexOf('function togglePlayPause('), source.indexOf('function updatePlayPauseButton(')), context);
    vm.runInContext('wireVideoEvents()', context);
    handlers['video-sync']({ mediaId: 'movie', kind: 'direct', src: 'movie', currentTime: 90, isPlaying: true });
    now += 6000; context.isPlayerReady = true; vm.runInContext('applyPending()', context);
    assert.equal(seeks.at(-1), 96); assert.equal(commands.at(-1), 'play');
    context.autoplayBlocked = true; now += 2000; vm.runInContext('togglePlayPause()', context);
    assert.equal(seeks.at(-1), 98); assert.equal(commands.at(-1), 'play'); assert.equal(sent.length, 0);
    context.isPlayerReady = false;
    handlers['video-playpause-sync']({ currentTime: 0, isPlaying: false });
    now += 5000; vm.runInContext('applyPending()', context);
    assert.equal(seeks.at(-1), 0); assert.equal(commands.at(-1), 'pause');
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
