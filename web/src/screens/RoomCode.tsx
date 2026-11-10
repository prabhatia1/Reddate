import React from 'react';
import { useApp } from '../App';

export function RoomCode({ code }: { code: string }) {
    const { toast } = useApp();
    async function copy() {
        try {
            await navigator.clipboard.writeText(code);
            toast('Room code copied');
        } catch {
            window.prompt('Copy this room code:', code);
        }
    }
    return (
        <div className="room-share">
            <div>
                <p className="note">Room code</p>
                <div className="code">{code}</div>
            </div>
            <button type="button" className="btn" onClick={copy}>Copy room code</button>
        </div>
    );
}
