/* Ephemeral ECDH transfers a room's random AES key to a code joiner. */
(function () {
    const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const pair = () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    async function shared(privateKey, publicKey) {
        const peer = await crypto.subtle.importKey('raw', decode(publicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    window.roomKeys = {
        serve(socket, getRoom, getKey) {
            socket.on('room-key-request', async request => {
                if (request.roomId !== getRoom() || !getKey()) return;
                try {
                    const keys = await pair();
                    const wrapping = await shared(keys.privateKey, request.publicKey);
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const raw = await crypto.subtle.exportKey('raw', getKey());
                    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapping, raw);
                    socket.emit('room-key-response', { to: request.from, requestId: request.requestId, publicKey: encode(await crypto.subtle.exportKey('raw', keys.publicKey)), iv: encode(iv), ciphertext: encode(ciphertext) });
                } catch (_) { /* malformed peer keys are ignored */ }
            });
        },
        async request(socket, roomId) {
            const keys = await pair();
            const requestId = encode(crypto.getRandomValues(new Uint8Array(16)));
            const publicKey = encode(await crypto.subtle.exportKey('raw', keys.publicKey));
            return new Promise((resolve, reject) => {
                const cleanup = () => { clearTimeout(timer); socket.off('room-key-response', receive); };
                const timer = setTimeout(() => { cleanup(); reject(new Error('Nobody in this room is available. Ask the host to open the room, or use the full invite link.')); }, 12000);
                const receive = async response => {
                    if (response.requestId !== requestId) return;
                    try {
                        const wrapping = await shared(keys.privateKey, response.publicKey);
                        const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(response.iv) }, wrapping, decode(response.ciphertext));
                        const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
                        cleanup(); resolve(key);
                    } catch (_) { /* another room member may answer successfully */ }
                };
                socket.on('room-key-response', receive);
                socket.emit('room-key-request', { roomId, requestId, publicKey });
            });
        }
    };
})();
