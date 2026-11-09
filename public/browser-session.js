/* Remember this tab's room and display name. Encryption keys stay in the URL. */
(function () {
    const SESSION_KEY = 'reddate-browser-session-v1';
    const TAB_KEY = 'reddate-tab-id-v1';
    let tabId;

    function savedName() {
        try { return (localStorage.getItem('reddate-name') || '').trim().slice(0, 40); } catch (_) { return ''; }
    }

    function clientId() {
        if (tabId) return tabId;
        try { tabId = sessionStorage.getItem(TAB_KEY); } catch (_) {}
        if (!/^[a-f0-9]{32}$/.test(tabId || '')) {
            tabId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
            try { sessionStorage.setItem(TAB_KEY, tabId); } catch (_) {}
        }
        return tabId;
    }

    function resumeForRoom(id) {
        if (!id) return null;
        try {
            const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            if (!saved || typeof saved.roomId !== 'string' || saved.roomId.length > 128 || typeof saved.name !== 'string' || !saved.name.trim() || saved.name.length > 40) return null;
            if (id !== saved.roomId && id !== saved.roomCode) return null;
            return saved;
        } catch (_) { return null; }
    }

    function save({ roomId, roomCode, name }) {
        if (!roomId || !name) return;
        const saved = { roomId, roomCode: roomCode || '', name: String(name).trim().slice(0, 40) };
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved)); } catch (_) {}
        try { localStorage.setItem('reddate-name', saved.name); } catch (_) {}
    }

    function clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
    window.reddateBrowserSession = { savedName, clientId, resumeForRoom, save, clear };
})();
