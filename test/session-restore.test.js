const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('TV classic refresh waits for account readiness and rejoins without the lobby', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const begin = source.indexOf('function restoreBrowserRoom()');
    const end = source.indexOf('\nfunction boot()', begin);
    let ready = false, readyListener; const joins = [], screens = [];
    const context = vm.createContext({ FRAME: false, existing: { roomId: 'room-a' }, leanCode: '', usernameInput: { value: '' },
        window: { reddateBrowserSession: { resumeForRoom: id => id === 'room-a' ? { roomId: id, name: 'Alice' } : null }, reddateAccount: { isReady: () => ready } },
        document: { addEventListener: (name, fn) => { readyListener = fn; } }, sayHello() {}, savedName: () => 'Alice',
        showScreen: s => screens.push(s), setPlayerStatus() {}, waitForJoin: () => Promise.resolve({ ok: true }),
        enterRoom: (name, room) => joins.push({ name, room }), showLobbyError: () => assert.fail('Unexpected lobby error') });
    vm.runInContext(source.slice(begin, end), context);
    assert.equal(vm.runInContext('restoreBrowserRoom()', context), true); assert.equal(joins.length, 0);
    ready = true; readyListener(); await Promise.resolve();
    assert.deepEqual(joins, [{ name: 'Alice', room: 'room-a' }]); assert.deepEqual(screens, ['room']);
    context.existing = { roomId: 'different-room' };
    assert.equal(vm.runInContext('restoreBrowserRoom()', context), false);
});

test('TV web app automatically rejoins the saved room on refresh', async () => {
    const ts = require('../web/node_modules/typescript');
    const source = fs.readFileSync(path.join(__dirname, '../web/src/App.tsx'), 'utf8');
    const boot = source.slice(source.indexOf('    // Boot: wait'), source.indexOf('    // Keep the room'));
    const calls = [], routes = []; let complete;
    const done = new Promise(resolve => { complete = resolve; });
    const context = vm.createContext({ engine: { start: async () => {}, call: async (...args) => { calls.push(args); return { ok: true }; } },
        refresh: async () => ({ accounts: true, signedIn: true, inRoom: false }), sessionStorage: { getItem: () => 'A7B2C', removeItem() {} },
        location: { pathname: '/app/watch' }, stripBase: s => s.replace('/app', ''), go: path => routes.push(path),
        setBooted: () => complete(), useEffect: fn => fn() });
    vm.runInContext(ts.transpile(boot, { target: ts.ScriptTarget.ES2020 }), context);
    await done; assert.equal(calls[0][0], 'joinCode'); assert.equal(calls[0][1].code, 'A7B2C'); assert.deepEqual(routes, ['/watch']);
});
