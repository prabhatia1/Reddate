import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { engine } from '../engine';
import { useApp } from '../App';
import { Player, OpenInfo, ChatPanel } from './Player';
import { chat as chatStore, useChat } from '../chat';
import { InviteProfiles } from './InviteProfiles';

export function Watch({ joinCode }: { joinCode?: string }) {
    const { st, go, back, refresh, toast } = useApp();
    const [open, setOpen] = useState<OpenInfo | null>(() => engine.pendingOpen as OpenInfo | null);
    const [joinErr, setJoinErr] = useState('');
    const [qr, setQr] = useState('');

    useEffect(() => engine.onOpened(o => setOpen(o as OpenInfo)), []);
    // The player covers everything: hide the app's bars only while it's up.
    useEffect(() => { document.body.classList.toggle('in-player', !!open); return () => document.body.classList.remove('in-player'); }, [open]);
    useEffect(() => { if (open) { try { sessionStorage.removeItem('rd-starting'); } catch { /* fine */ } } }, [open]);

    // Opening a party link no longer joins straight away: the page shows the party, its link to pass on, and which
    // profile you'll join as. Pressing Join does it.
    const [joining, setJoining] = useState(false);
    async function joinNow() {
        if (!joinCode || joining) return;
        try { sessionStorage.removeItem('rd-invite'); } catch { /* fine */ } // a joiner never gets the host's invite panel
        setJoining(true); setJoinErr('');
        try {
            const r = await engine.call<{ ok: boolean; message?: string }>('joinCode', { code: joinCode }, 25000);
            if (r && r.ok) { await refresh(); go('/watch', true); } else setJoinErr((r && r.message) || 'Couldn’t join that party.');
        } catch (e: any) { setJoinErr(e.message || 'Couldn’t join that party.'); }
        finally { setJoining(false); }
    }

    useEffect(() => { if (st.invite) QRCode.toDataURL(st.invite, { margin: 1, width: 300 }).then(setQr).catch(() => {}); }, [st.invite]);

    // Just started something: show "Starting…" until the player is up, not the room's code for a split second.
    let starting = false;
    try { const t = Number(sessionStorage.getItem('rd-starting') || 0); starting = !!t && Date.now() - t < 12000; } catch { /* fine */ }
    const [tick, setTick] = useState(0);
    useEffect(() => { if (starting && !open) { const h = setTimeout(() => setTick(x => x + 1), 1000); return () => clearTimeout(h); } }, [starting, open, tick]);

    if (open) {
        return <Player key={open.sid} open={open} onClose={now => {
            engine.pendingOpen = null; setOpen(null); refresh();
            // The viewer chose to leave: straight back to where they came from. Otherwise the engine closed the
            // picture (another video is about to open, or the room ended): wait a moment to see which.
            if (now) back();
            else window.setTimeout(() => { if (!engine.pendingOpen && /\/watch$/.test(location.pathname)) back(); }, 1500);
        }} />;
    }
    return (
        <div className="auth lobby">
            <div className="card" style={{ textAlign: 'center', width: 'min(520px,100%)' }}>
                {starting && !open && !joinErr ? (
                    <><div className="spin" /><p>Starting…</p></>
                ) : joinErr ? (
                    <>
                        <h2>Couldn’t join</h2>
                        <p className="note" style={{ margin: '8px 0 16px' }}>{joinErr}</p>
                        <button className="btn primary" onClick={() => back()}>Back</button>
                    </>
                ) : st.inRoom ? (
                    <>
                        <h2>{st.isGuest ? `In ${st.hostName || 'a'}’s party` : 'Your party'}</h2>
                        <p className="note" style={{ margin: '6px 0 14px' }}>{st.isGuest ? 'Waiting for the host to pick something to watch…' : 'Pick something to watch, and everyone here watches it with you.'}</p>
                        {st.roomCode && <div className="code">{st.roomCode}</div>}
                        {qr && <div className="qr" style={{ margin: '10px auto' }}><img alt="QR code to join" src={qr} width={160} height={160} /></div>}
                        {st.invite && <div className="note" style={{ overflowWrap: 'anywhere', marginBottom: 12 }}>{st.invite.replace(/^https?:\/\//, '')}</div>}
                        {!st.isGuest && <InviteProfiles />}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                            {st.nowPlaying && <button className="btn primary" onClick={() => engine.call('resume').catch(() => {})}>Back to the video</button>}
                            {!st.isGuest && !st.nowPlaying && <button className="btn primary" onClick={() => go('/')}>Pick something</button>}
                            <button className="btn" onClick={async () => { await engine.call('leaveRoom').catch(() => {}); await refresh(); back(); }}>{st.isGuest ? 'Leave the party' : 'Close the room'}</button>
                        </div>
                        <LobbyChat />
                    </>
                ) : joinCode ? (
                    <JoinPage code={joinCode} joining={joining} onJoin={joinNow} />
                ) : (
                    <>
                        <h2>No party right now</h2>
                        <p className="note" style={{ margin: '8px 0 16px' }}>Start one from any title with “Watch together”, or join with a code.</p>
                        <JoinBox onJoin={code => go('/join/' + code)} />
                        <CreateBox />
                    </>
                )}
            </div>
        </div>
    );
}

/** A party link was opened: the code, the link to pass on (copy / share), and who you'll join as. */
function JoinPage({ code, joining, onJoin }: { code: string; joining: boolean; onJoin: () => void }) {
    const { st, refresh, toast } = useApp();
    const pretty = code.length === 8 ? code.toUpperCase().replace(/^(.{4})(.+)$/, '$1-$2') : code.toUpperCase();
    const link = `${location.origin}/join/${code.toUpperCase()}`;
    const [copied, setCopied] = useState(false);
    async function copy() {
        try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
        catch { toast('Couldn’t copy. Press and hold the link to copy it.'); }
    }
    async function share() {
        try { await (navigator as any).share({ title: 'Join my Reddate party', text: `Join the watch party ${pretty}`, url: link }); } catch { /* closed */ }
    }
    async function pick(id: string) { if (id !== st.profileId) { await engine.call('chooseProfile', { id }).catch(() => {}); await refresh(); } }
    const canShare = typeof (navigator as any).share === 'function';
    return (
        <>
            <div className="kicker">Watch party</div>
            <h2 style={{ marginTop: 4 }}>You’re invited</h2>
            <div className="code" style={{ margin: '10px 0' }}>{pretty}</div>
            <p className="note" style={{ marginBottom: 8 }}>Share this link so others can join too</p>
            <div className="joinlink">
                <span>{link.replace(/^https?:\/\//, '')}</span>
                <button type="button" className="btn small" onClick={copy} aria-live="polite">{copied ? 'Copied' : 'Copy'}</button>
                {canShare && <button type="button" className="btn small ghost" onClick={share}>Share</button>}
            </div>
            {st.profiles.length > 1 && (
                <>
                    <p className="note" style={{ margin: '18px 0 8px' }}>Join as</p>
                    <div className="joinprofiles" role="radiogroup" aria-label="Profile">
                        {st.profiles.map(p => (
                            <button key={p.id} type="button" role="radio" aria-checked={p.id === st.profileId} className={'chip' + (p.id === st.profileId ? ' on' : '')} onClick={() => pick(p.id)}>
                                <i aria-hidden>{(p.name || '?').slice(0, 1).toUpperCase()}</i>{p.name}
                            </button>
                        ))}
                    </div>
                </>
            )}
            <button className="btn primary lg" style={{ width: '100%', marginTop: 18 }} disabled={joining} onClick={onJoin}>
                {joining ? 'Joining…' : `Join as ${st.profile || 'me'}`}
            </button>
        </>
    );
}

function JoinBox({ onJoin }: { onJoin: (c: string) => void }) {
    const [c, setC] = useState('');
    const [error, setError] = useState('');
    return (
        <form onSubmit={e => { e.preventDefault(); const invite = (window as any).partyCode.parse(c); if (invite) onJoin(invite.code); else setError('Enter a 5-character room code or valid invite link.'); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="A7B2C or invite link" aria-label="Room code or invite link" value={c} onChange={e => { setC(e.target.value); setError(''); }} maxLength={2048} />
            <button className="btn primary">Join</button>
            {error && <p role="alert" className="note" style={{ width: '100%' }}>{error}</p>}
        </form>
    );
}

function CreateBox() {
    const { refresh } = useApp();
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    return <form style={{ marginTop: 20 }} onSubmit={async e => {
        e.preventDefault(); if (busy) return;
        if (code && !/^[A-Z0-9]{5}$/.test(code)) { setError('Use exactly 5 letters or numbers.'); return; }
        setBusy(true); setError('');
        try {
            const result = await engine.call<{ ok: boolean; message?: string }>('together', { code }, 25000);
            if (!result?.ok) setError(result?.message || 'Could not start the party.');
            else await refresh();
        } catch (e: any) { setError(e.message || 'Could not start the party.'); }
        finally { setBusy(false); }
    }}>
        <p className="note">Or create a party for browsers and TVs.</p>
        <input className="input" aria-label="Your room code (optional)" placeholder="Your code (optional)" maxLength={5} value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setError(''); }} />
        <p className="note">Leave blank to generate a 5-character code.</p>
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create a party'}</button>
        {error && <p className="note" role="alert">{error}</p>}
    </form>;
}

// Chat works in the lobby too, before anything is playing.
function LobbyChat() {
    const lines = useChat();
    const { toast } = useApp();
    const draft = React.useRef('');
    return (
        <div className="lobby-chat side" style={{ position: 'relative', width: 'auto', height: 320, marginTop: 18, borderRadius: 14, border: '1px solid var(--rule)', textAlign: 'left' }}>
            <header><h2 style={{ fontSize: 16 }}>Chat</h2></header>
            <ChatPanel chat={lines} draft={draft} autoFocus={false} onSend={t => { chatStore.send(t.trim()).catch((e: Error) => toast(e.message || 'Couldn’t send that.')); chatStore.typing(false); }} onTyping={on => chatStore.typing(on)} />
        </div>
    );
}
