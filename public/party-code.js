(function (root) {
    function parse(text) {
        const value = String(text || '').trim();
        if (/^(?:https?:\/\/|\/|#)/i.test(value)) {
            try {
                const url = new URL(value, 'https://reddate.invalid');
                if (!['http:', 'https:'].includes(url.protocol)) return null;
                const fragment = new URLSearchParams(url.hash.slice(1));
                const path = url.pathname.match(/^\/(?:join|lounge)\/([^/]+)\/?$/i);
                const roomId = fragment.get('room') || (path ? decodeURIComponent(path[1]) : '');
                if (!roomId || roomId.length > 128) return null;
                return { code: roomId, key: fragment.get('k') || '' };
            } catch (_) { return null; }
        }
        const code = value.replace(/[\s-]/g, '').toUpperCase();
        return /^(?:[A-Z0-9]{5}|[A-Z0-9]{8})$/.test(code) ? { code, key: '' } : null;
    }
    const api = { parse };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.partyCode = api;
})(typeof window === 'object' ? window : globalThis);
