/* Holds this viewer's picture while selected audio buffers. Internal holds are
 * distinct from a user's play/pause command, so they never pause the room. */
(function () {
    window.createPlaybackGate = function (video, { onPlayback, onBuffering, onPlayError }) {
        let buffering = false, wantedPlaying = !video.paused, disposed = false;
        let privatePauses = 0;
        const privatePlays = [];
        const listeners = [];
        function listen(name, handler) {
            video.addEventListener(name, handler);
            listeners.push(() => video.removeEventListener(name, handler));
        }
        function hold() {
            if (!video.paused) { privatePauses++; video.pause(); }
        }
        function resume() {
            if (!video.paused || video.ended || disposed) return;
            const request = {};
            privatePlays.push(request);
            const promise = video.play();
            if (promise?.catch) promise.catch(error => {
                const index = privatePlays.indexOf(request);
                if (index !== -1) privatePlays.splice(index, 1);
                if (!disposed && error.name !== 'AbortError' && onPlayError) onPlayError();
            });
        }
        listen('play', () => {
            if (privatePlays.length) { privatePlays.shift(); return; }
            wantedPlaying = true;
            onPlayback(true);
            if (buffering) hold();
        });
        listen('pause', () => {
            if (privatePauses) { privatePauses--; return; }
            wantedPlaying = false;
            onPlayback(false);
        });
        listen('audio-buffering', event => {
            const next = !!event.detail.buffering;
            if (next === buffering) return;
            buffering = next;
            if (buffering) hold();
            else if (wantedPlaying) resume();
            onBuffering(buffering);
        });
        return {
            get buffering() { return buffering; },
            // Return whether a native event is expected. The caller can clear
            // its remote-event suppression when a command is deferred here.
            play() {
                wantedPlaying = true;
                if (buffering || !video.paused) return false;
                const promise = video.play();
                if (promise?.catch) promise.catch(error => {
                    if (!disposed && error.name !== 'AbortError' && onPlayError) onPlayError();
                });
                return true;
            },
            pause() {
                wantedPlaying = false;
                if (video.paused) return false;
                video.pause();
                return true;
            },
            destroy() {
                disposed = true;
                listeners.forEach(remove => remove());
                if (buffering) onBuffering(false);
            }
        };
    };
})();
