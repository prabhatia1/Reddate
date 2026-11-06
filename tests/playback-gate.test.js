const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(paused = false) {
    const listeners = new Map(), events = [], playback = [], buffering = [], errors = [];
    let nextError = null;
    const video = {
        paused, ended: false,
        addEventListener(name, fn) { listeners.set(name, fn); },
        removeEventListener(name) { listeners.delete(name); },
        play() {
            if (nextError) { const e = nextError; nextError = null; return Promise.reject(e); }
            if (this.paused) { this.paused = false; events.push('play'); }
            return Promise.resolve();
        },
        pause() { if (!this.paused) { this.paused = true; events.push('pause'); } }
    };
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/playback-gate.js'), 'utf8'), { window });
    const gate = window.createPlaybackGate(video, {
        onPlayback: value => playback.push(value), onBuffering: value => buffering.push(value),
        onPlayError: () => errors.push(true)
    });
    return { gate, video, playback, buffering, errors,
        flush() { while (events.length) listeners.get(events.shift())?.(); },
        buffer(value) { listeners.get('audio-buffering')?.({ detail: { buffering: value } }); },
        rejectPlay(name) { nextError = Object.assign(new Error(name), { name }); }
    };
}

test('buffering holds and resumes only this viewer without room play/pause events', () => {
    const s = setup(); s.buffer(true);
    assert.equal(s.video.paused, true); assert.equal(s.gate.buffering, true);
    s.flush(); s.buffer(false); s.flush();
    assert.equal(s.video.paused, false);
    assert.deepEqual(s.playback, []); assert.deepEqual(s.buffering, [true, false]);
});

test('pause command during a hold cancels automatic resume, including queued pause event', () => {
    const s = setup(); s.buffer(true);
    assert.equal(s.gate.pause(), false);
    s.flush(); s.buffer(false); s.flush();
    assert.equal(s.video.paused, true); assert.deepEqual(s.playback, []);
});

test('a paused seek stays paused, and a deferred play starts after buffering', () => {
    const s = setup(true); s.buffer(true); s.buffer(false); s.flush();
    assert.equal(s.video.paused, true);
    s.buffer(true); assert.equal(s.gate.play(), false); s.flush();
    assert.equal(s.video.paused, true);
    s.buffer(false); s.flush();
    assert.equal(s.video.paused, false); assert.deepEqual(s.playback, []);
});

test('quick successive holds preserve intent with asynchronous native events', () => {
    const s = setup(); s.buffer(true); s.buffer(false); s.buffer(true);
    s.flush(); assert.equal(s.video.paused, true);
    s.buffer(false); s.flush(); assert.equal(s.video.paused, false);
    assert.deepEqual(s.playback, []);
});

test('native play during a hold is reported once and deferred until audio is ready', () => {
    const s = setup(true); s.buffer(true); s.video.play(); s.flush();
    assert.equal(s.video.paused, true); assert.deepEqual(s.playback, [true]);
    s.buffer(false); s.flush(); assert.equal(s.video.paused, false);
    s.video.pause(); s.flush(); assert.deepEqual(s.playback, [true, false]);
});

test('destroy clears the indicator without restarting the old source', () => {
    const s = setup(); s.buffer(true); s.gate.destroy(); s.flush(); s.buffer(false);
    assert.equal(s.video.paused, true); assert.deepEqual(s.playback, []);
    assert.deepEqual(s.buffering, [true, false]);
});

test('a rejected automatic play does not swallow the next user play', async () => {
    const s = setup(); s.buffer(true); s.flush(); s.rejectPlay('NotAllowedError');
    s.buffer(false); await Promise.resolve();
    assert.deepEqual(s.errors, [true]); assert.equal(s.video.paused, true);
    s.video.play(); s.flush(); assert.deepEqual(s.playback, [true]);
});

test('an interrupted play is not reported as an autoplay error', async () => {
    const s = setup(); s.buffer(true); s.flush(); s.rejectPlay('AbortError');
    s.buffer(false); await Promise.resolve(); assert.deepEqual(s.errors, []);
});
