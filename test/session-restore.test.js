const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('refresh skips name entry for a previously joined encrypted room', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    const begin = source.indexOf('async function restoreBrowserSession()');
    const end = source.indexOf('\nrestoreBrowserSession();', begin);
    let saved = { name: 'Alice' }; const names = [];
    const usernameInput = { value: '' };
    const context = vm.createContext({ isJoining: true, existing: { roomId: 'room-a' }, usernameInput,
        window: { reddateBrowserSession: { resumeForRoom: id => id === 'room-a' ? saved : null } },
        enterFromLobby: async () => names.push(usernameInput.value) });
    vm.runInContext(source.slice(begin, end), context);
    await vm.runInContext('restoreBrowserSession()', context); assert.deepEqual(names, ['Alice']);
    saved = null; await vm.runInContext('restoreBrowserSession()', context); assert.equal(names.length, 1);
    saved = { name: 'Alice' }; context.isJoining = false;
    await vm.runInContext('restoreBrowserSession()', context); assert.equal(names.length, 1);
});
