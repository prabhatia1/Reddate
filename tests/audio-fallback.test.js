const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
    const calls = [], nodes = [], contexts = [], timers = new Set(), buffering = [];
    let failedStart = null;
    let failedTrack = null, heldTrack = null, heldStart = null;
    const gates = [];
    const listeners = new Map();
    const video = {
        muted: false, volume: 0.8, currentTime: 45, paused: false, seeking: false, ended: false,
        readyState: 4, playbackRate: 1, duration: 300,
        classList: { add() {}, remove() {} },
        addEventListener(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
        removeEventListener(event, fn) { listeners.get(event)?.delete(fn); },
        fire(event) { listeners.get(event)?.forEach(fn => fn()); },
        dispatchEvent(event) {
            if (event.type === 'audio-buffering') buffering.push(event.detail.buffering);
            listeners.get(event.type)?.forEach(fn => fn(event));
        },
        play() { throw new Error('Audio must not control video playback'); },
        pause() { throw new Error('Audio must not control video playback'); }
    };
    class AudioContext {
        constructor() { this.currentTime = 0; this.state = 'running'; contexts.push(this); }
        resume() { return Promise.resolve(); }
        createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
        decodeAudioData() { return Promise.resolve({ duration: 20 }); }
        createBufferSource() {
            const node = { playbackRate: { value: 1 }, connect() {},
                start(when, offset, duration) { Object.assign(this, { when, offset, duration }); },
                stop() { this.stopped = true; }
            };
            nodes.push(node); return node;
        }
    }
    const window = { AudioContext };
    const context = vm.createContext({
        window, AbortController, DOMException,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            if (url === '/api/audio/tracks') return { ok: true, json: async () => ({ token: 'test', segmentSeconds: 20, duration: 300, tracks: [
                { index: 1, language: 'hin', isDefault: true }, { index: 2, language: 'eng', isDefault: false },
                { index: 3, language: 'fra', isDefault: false }
            ] }) };
            if (options.method === 'DELETE') return { ok: true };
            const track = Number(url.split('/').at(-2));
            if (track === heldTrack && (heldStart === null || Number(url.split('/').pop()) === heldStart)) await new Promise((resolve, reject) => {
                const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
                options.signal.addEventListener('abort', abort, { once: true });
                gates.push(() => { options.signal.removeEventListener('abort', abort); resolve(); });
            });
            if (Number(url.split('/').pop()) === failedStart && (failedTrack === null || failedTrack === track)) return { ok: false, json: async () => ({ error: 'Source disconnected.' }) };
            return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/audio-fallback.js'), 'utf8'), context);
    const audio = window.createAudioFallback(video, 'https://media.example/different-title.mp4', () => {});
    const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    return { audio, video, calls, nodes, contexts, timers, listeners, buffering, settle,
        tick() { timers.forEach(fn => fn()); }, fail(start, track = null) { failedStart = start; failedTrack = track; },
        hold(track, start = null) { heldTrack = track; heldStart = start; }, release() { heldTrack = null; gates.splice(0).forEach(resolve => resolve()); } };
}

test('embedded audio starts at the current video position and schedules the next chunk', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    assert.equal(s.audio.active, true);
    assert.equal(s.video.muted, true);
    assert.equal(s.video.currentTime, 45);
    assert.equal(s.video.paused, false);
    assert(s.nodes.some(n => n.offset === 5 && n.when === 0));
    assert(s.nodes.some(n => n.offset === 0 && n.when === 15));
    assert(s.calls.some(c => c.url.endsWith('/2/40')));
    assert(s.calls.some(c => c.url.endsWith('/2/60')));
    s.audio.destroy();
});

test('pausing, buffering, seeking and speed changes follow the video without changing it', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    s.video.paused = true; s.video.fire('pause');
    assert(s.nodes.every(n => n.stopped));
    s.video.currentTime = 125; s.video.fire('seeking'); s.video.fire('seeked'); await s.settle();
    const count = s.nodes.length;
    assert.equal(s.nodes.length, count);
    s.video.paused = false; s.video.fire('playing'); await s.settle();
    assert(s.nodes.slice(count).some(n => n.offset === 5));
    s.video.fire('waiting'); assert(s.nodes.every(n => n.stopped));
    const waitingCount = s.nodes.length; s.tick(); await s.settle();
    assert.equal(s.nodes.length, waitingCount);
    s.video.playbackRate = 1.5; s.video.fire('playing'); s.video.fire('ratechange');
    assert(s.nodes.filter(n => !n.stopped).every(n => n.playbackRate.value === 1.5));
    assert.equal(s.video.currentTime, 125);
    s.audio.destroy();
});

test('corrects drift without seeking or restarting the video', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    s.contexts[0].currentTime = 4;
    s.video.currentTime = 47;
    const before = s.nodes.length; s.tick();
    assert(s.nodes.slice(0, before).every(n => n.stopped));
    assert(s.nodes.slice(before).some(n => n.offset === 7));
    assert.equal(s.video.currentTime, 47);
    s.audio.destroy();
});

test('returning to the original track restores mute state and releases audio', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    await s.audio.select(1);
    assert.equal(s.audio.active, false); assert.equal(s.video.muted, false);
    assert(s.nodes.every(n => n.stopped));
    s.audio.destroy(); assert.equal(s.timers.size, 0);
    for (const handlers of s.listeners.values()) assert.equal(handlers.size, 0);
    assert(s.calls.some(c => c.options.method === 'DELETE'));
});

test('a failed initial switch keeps the original audio playing', async () => {
    const s = setup(); await s.audio.load(); s.fail(40);
    await assert.rejects(s.audio.select(2)); await s.settle();
    assert.equal(s.audio.active, false); assert.equal(s.video.muted, false);
    assert.match(s.audio.status, /Current audio is unchanged/);
    s.audio.destroy();
});

test('preparing a track and switching back reuse decoded audio without another download', async () => {
    const s = setup(); await s.audio.load();
    await s.audio.prepare(2);
    assert.equal(s.video.muted, false);
    assert.equal(s.nodes.length, 0);
    await s.audio.select(2); await s.settle();
    assert.equal(s.calls.filter(c => c.url.endsWith('/2/40')).length, 1);
    assert(s.calls.find(c => /\/test\/2\//.test(c.url)).url.endsWith('/40'));
    await s.audio.select(1);
    await s.audio.select(2); await s.settle();
    assert.equal(s.calls.filter(c => c.url.endsWith('/2/40')).length, 1);
    assert.equal(s.audio.selected, 2);
    s.audio.destroy();
});

test('current audio keeps playing until the replacement track is ready', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    const oldNodes = [...s.nodes];
    s.hold(3); const switching = s.audio.select(3); await s.settle();
    assert.equal(s.audio.selected, 2);
    assert.equal(s.audio.pendingIndex, 3);
    assert.equal(s.video.muted, true);
    assert(oldNodes.every(n => !n.stopped));
    s.release(); await switching; await s.settle();
    assert.equal(s.audio.selected, 3);
    assert.equal(s.audio.pending, false);
    assert(oldNodes.every(n => n.stopped));
    s.audio.destroy();
});

test('a failed replacement leaves the selected audio intact', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    const oldNodes = [...s.nodes]; s.fail(40, 3);
    await assert.rejects(s.audio.select(3));
    assert.equal(s.audio.selected, 2); assert.equal(s.audio.active, true);
    assert(oldNodes.every(n => !n.stopped));
    s.audio.destroy();
});

test('cancelling a pending choice cannot activate it later', async () => {
    const s = setup(); await s.audio.load(); s.hold(2);
    const switching = s.audio.select(2); await s.settle();
    await s.audio.select(1); s.release(); await switching;
    assert.equal(s.audio.active, false); assert.equal(s.audio.selected, 1);
    assert.equal(s.video.muted, false);
    s.audio.destroy();
});

test('uncached seek requests current audio immediately and buffers before prefetching', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    s.hold(2);
    s.video.currentTime = 125; s.video.seeking = true; s.video.fire('seeking');
    assert(s.calls.some(c => c.url.endsWith('/2/120')));
    assert(!s.calls.some(c => c.url.endsWith('/2/140')));
    assert.equal(s.audio.buffering, true);
    assert.deepEqual(s.buffering, [true]);
    assert(s.nodes.every(n => n.stopped));
    s.video.seeking = false; s.video.fire('seeked'); await s.settle();
    assert.equal(s.audio.buffering, true);
    s.release(); await s.settle();
    assert.equal(s.audio.buffering, false);
    assert.deepEqual(s.buffering, [true, false]);
    assert.equal(s.audio.selected, 2);
    assert(s.nodes.filter(n => !n.stopped).some(n => n.offset === 5));
    assert(s.calls.some(c => c.url.endsWith('/2/140')));
    s.audio.destroy();
});

test('rapid seeks abort obsolete requests and resume only at the latest target', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    s.hold(2);
    s.video.currentTime = 125; s.video.seeking = true; s.video.fire('seeking');
    s.video.currentTime = 187; s.video.fire('seeking'); await s.settle();
    assert(s.calls.find(c => c.url.endsWith('/2/120')).options.signal.aborted);
    assert(!s.calls.find(c => c.url.endsWith('/2/180')).options.signal.aborted);
    assert.deepEqual(s.buffering, [true]);
    s.video.seeking = false; s.video.fire('seeked'); s.release(); await s.settle();
    assert.deepEqual(s.buffering, [true, false]);
    assert.equal(s.audio.selected, 2);
    assert(s.nodes.filter(n => !n.stopped).some(n => n.offset === 7));
    assert(!s.calls.some(c => c.url.endsWith('/2/140')));
    s.audio.destroy();
});

test('seeking within cached audio has no buffering hold or additional download', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    const downloads = s.calls.length;
    s.video.currentTime = 52; s.video.seeking = true; s.video.fire('seeking');
    s.video.seeking = false; s.video.fire('seeked'); await s.settle();
    assert.deepEqual(s.buffering, []);
    assert.equal(s.calls.length, downloads);
    assert(s.nodes.filter(n => !n.stopped).some(n => n.offset === 12));
    s.audio.destroy();
});

test('seeking near a boundary loads both required chunks and resumes only once', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    s.hold(2, 120);
    s.video.currentTime = 119; s.video.seeking = true; s.video.fire('seeking');
    assert(s.calls.some(c => c.url.endsWith('/2/100')));
    assert(s.calls.some(c => c.url.endsWith('/2/120')));
    s.video.seeking = false; s.video.fire('seeked'); await s.settle();
    // The current second is ready, but resuming now would cause another stall.
    assert.equal(s.audio.buffering, true); assert.deepEqual(s.buffering, [true]);
    s.release(); await s.settle();
    assert.deepEqual(s.buffering, [true, false]);
    s.video.currentTime = 120.1; s.contexts[0].currentTime = 1.1; s.tick(); await s.settle();
    assert.equal(s.audio.buffering, false); assert.equal(s.audio.selected, 2);
    s.audio.destroy();
});

test('adjacent chunks use one audio clock and never replay an already finished tail', async () => {
    const s = setup(); await s.audio.load(); await s.audio.select(2); await s.settle();
    const current = s.nodes.find(n => n.offset === 5), next = s.nodes.find(n => n.offset === 0);
    assert.equal(next.when, current.when + current.duration);
    s.contexts[0].currentTime = 15.01; s.video.currentTime = 59.98;
    current.onended?.();
    const count = s.nodes.length; s.tick();
    assert.equal(s.nodes.length, count);
    s.video.currentTime = 60.2; s.contexts[0].currentTime = 15.23; s.tick(); await s.settle();
    assert.equal(next.stopped, undefined);
    const following = s.nodes.find(n => n.when > next.when);
    assert.equal(following.when, next.when + next.duration);
    assert.deepEqual(s.buffering, []);
    s.audio.destroy();
});
