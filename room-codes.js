const crypto = require('crypto');

// Codes are aliases for room IDs. Keeping IDs separate preserves existing links
// and prevents a generated-code collision from joining somebody else's party.
function createRoomCodes(rooms) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    function find(code) {
        if (typeof code !== 'string') return null;
        const normalized = code.trim().toUpperCase();
        for (const [roomId, room] of rooms) {
            if (room.code === normalized) return { roomId, room };
        }
        const room = rooms.get(code);
        return room ? { roomId: code, room } : null;
    }
    function assign(roomId) {
        const room = rooms.get(roomId);
        if (!room) throw new Error('That party has ended.');
        if (room.code) return room.code;
        let code;
        do { code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join(''); } while (find(code));
        room.code = code;
        return code;
    }
    return { find, assign };
}

function registerRoomCodes(socket, codes, rooms, { encrypted = false } = {}) {
    let windowAt = 0, attempts = 0;
    const allow = () => {
        if (Date.now() - windowAt > 60000) { windowAt = Date.now(); attempts = 0; }
        return ++attempts <= 20;
    };
    socket.on('resolve-room', ({ code } = {}, ack) => {
        if (typeof ack !== 'function') return;
        if (!allow()) return ack({ ok: false, message: 'Too many attempts. Wait a minute and try again.' });
        const found = codes.find(code);
        if (!found) return ack({ ok: false, message: 'No party with that code right now. Check the code or invite link.' });
        ack({ ok: true, roomId: found.roomId, code: codes.assign(found.roomId) });
    });
    if (!encrypted) return;
    // Key exchange is between browsers. Only public keys and encrypted room keys
    // pass through this relay; room keys are never kept by the server.
    socket.on('room-key-request', ({ roomId, publicKey, requestId } = {}) => {
        if (!allow() || !rooms.get(roomId)?.users.size || typeof publicKey !== 'string' || publicKey.length > 256 || typeof requestId !== 'string' || requestId.length > 64) return;
        socket.data.keyRequest = { roomId, requestId, expires: Date.now() + 15000 };
        socket.to(roomId).emit('room-key-request', { roomId, publicKey, requestId, from: socket.id });
    });
    socket.on('room-key-response', ({ to, requestId, publicKey, iv, ciphertext } = {}) => {
        const target = socket.nsp.sockets.get(to);
        const pending = target?.data.keyRequest;
        if (!pending || pending.expires < Date.now() || pending.requestId !== requestId || pending.roomId !== socket.data.roomId) return;
        if (![publicKey, iv, ciphertext].every(v => typeof v === 'string' && v.length <= 256)) return;
        target.emit('room-key-response', { requestId, publicKey, iv, ciphertext });
    });
}

module.exports = { createRoomCodes, registerRoomCodes };
