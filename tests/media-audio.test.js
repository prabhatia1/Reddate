const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const { registerMediaAudio, publicAddress, sourceUrl, openPublic } = require('../media-audio');

test('audio fetching refuses private, mapped and non-HTTP sources', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1']) assert.equal(publicAddress(address), false, address);
    assert.equal(publicAddress('8.8.8.8'), true);
    assert.equal(publicAddress('2606:4700:4700::1111'), true);
    for (const url of ['file:///etc/passwd', 'ftp://example.com/a', 'http://user:pass@example.com/video']) assert.throws(() => sourceUrl(url));
    await assert.rejects(openPublic('http://127.0.0.1/private', null, new AbortController().signal), /Private/);
});

test('extracts distinct tracks from any MP4 title and validates session/track/seek requests', async t => {
    const haveTools = ['ffmpeg', 'ffprobe'].every(command => spawnSync(command, ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0);
    if (!haveTools) { t.skip('FFmpeg and ffprobe are required for the extraction test'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reddate-audio-test-'));
    const file = path.join(dir, 'unrelated-movie.mp4');
    const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
        '-map', '0:a', '-map', '1:a', '-c:a', 'aac', '-metadata:s:a:0', 'language=hin', '-metadata:s:a:1', 'language=eng', '-disposition:a:0', 'default', file], { windowsHide: true });
    assert.equal(generated.status, 0);
    const app = express();
    // Dependency injection is limited to this test. Production always uses
    // public DNS validation and pins each connection to the validated address.
    const audio = registerMediaAudio(app, { openSource: async (url, range, signal) => {
        assert.equal(url, 'https://media.example/unrelated-movie.mp4');
        const size = fs.statSync(file).size;
        const match = range && range.match(/^bytes=(\d+)-(\d*)$/);
        const start = match ? Number(match[1]) : 0;
        const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        const stream = fs.createReadStream(file, { start, end });
        stream.statusCode = match ? 206 : 200;
        stream.headers = { 'content-type': 'video/mp4', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', ...(match ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) };
        signal.addEventListener('abort', () => stream.destroy(), { once: true });
        return stream;
    } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(base + '/api/audio/tracks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://media.example/unrelated-movie.mp4' }) });
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.deepEqual(data.tracks.map(t => t.language), ['hin', 'eng']);
        const chunks = [];
        for (const track of data.tracks) {
            const res = await fetch(`${base}/api/audio/${data.token}/${track.index}/0`);
            assert.equal(res.status, 200);
            const bytes = Buffer.from(await res.arrayBuffer());
            assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
            assert(bytes.length > 100000 && bytes.length < 4 * 1024 * 1024);
            let offset = 12;
            while (bytes.toString('ascii', offset, offset + 4) !== 'data') offset += 8 + bytes.readUInt32LE(offset + 4) + (bytes.readUInt32LE(offset + 4) % 2);
            assert.equal((bytes.length - offset - 8) / (48000 * 2 * 2), data.segmentSeconds,
                'Codec delay and the last short chunk must not leave holes in the audio timeline');
            chunks.push(bytes);
        }
        assert.notDeepEqual(chunks[0], chunks[1]);
        const concurrent = await Promise.all([0, 1, 0].map(index => fetch(`${base}/api/audio/${data.token}/${data.tracks[index].index}/0`).then(async res => {
            await res.arrayBuffer(); return res.status;
        })));
        assert.deepEqual(concurrent, [200, 200, 200]);
        assert.equal((await fetch(`${base}/api/audio/${data.token}/999/0`)).status, 400);
        assert.equal((await fetch(`${base}/api/audio/${data.token}/0/1`)).status, 400);
        assert.equal((await fetch(`${base}/api/audio/not-a-session/0/0`)).status, 404);
        await fetch(`${base}/api/audio/${data.token}`, { method: 'DELETE' });
        assert.equal((await fetch(`${base}/api/audio/${data.token}/0/0`)).status, 404);
    } finally {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); audio.close();
        fs.unlinkSync(file);
        fs.rmdirSync(dir);
    }
});
