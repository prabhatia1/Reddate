import React, { useMemo, useState } from 'react';
import type { Json } from '../engine';

/* Hallmark · component: subtitle panel · genre: modern-minimal (app chrome) · theme: Reddate tokens (styles.css)
 * states: default · hover · focus · active · disabled · loading · error(empty) · success(selected)
 */

// How subtitles look. Same choices as the TV app, remembered on this device.
export interface SubLook { size: number; pos: number; color: number; bg: number; font: number }
export const DEFAULT_LOOK: SubLook = { size: 1, pos: 1, color: 0, bg: 1, font: 0 };
const SIZES = ['Small', 'Medium', 'Large', 'Huge'];
const POSITIONS = ['Lowest', 'Low', 'Middle', 'High', 'Highest'];
const COLORS = ['White', 'Yellow', 'Cyan', 'Green'];
const BGS = ['None', 'Box', 'Outline', 'Shadow'];
const FONTS = ['Sans', 'Serif', 'Mono', 'Casual'];
const COLOR_VALUES = ['#ffffff', '#ffe066', '#7fe3ff', '#9dff9d'];

export function loadLook(): SubLook {
    try { return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem('rd-sub-look') || '{}') }; } catch { return DEFAULT_LOOK; }
}
export function saveLook(l: SubLook) { try { localStorage.setItem('rd-sub-look', JSON.stringify(l)); } catch { /* fine */ } }

/** CSS variables for the subtitle line (read by .subs in styles.css). */
export function lookVars(l: SubLook): React.CSSProperties {
    const shadow = l.bg === 2 ? '0 0 2px #000, 0 0 2px #000, 0 0 3px #000' : l.bg === 3 ? '2px 3px 6px rgba(0,0,0,.9)' : 'none';
    return {
        ['--sub-size' as any]: ['clamp(14px,1.9vw,22px)', 'clamp(16px,2.4vw,28px)', 'clamp(19px,3vw,36px)', 'clamp(23px,3.8vw,46px)'][l.size] || undefined,
        ['--sub-bottom' as any]: ['4%', '11%', '20%', '30%', '42%'][l.pos],
        ['--sub-color' as any]: COLOR_VALUES[l.color],
        ['--sub-bg' as any]: l.bg === 1 ? 'rgba(0,0,0,.72)' : 'transparent',
        ['--sub-shadow' as any]: shadow,
        ['--sub-font' as any]: ['var(--font-sans, system-ui, sans-serif)', 'Georgia, "Times New Roman", serif', 'ui-monospace, Menlo, monospace', '"Comic Sans MS", "Chalkboard SE", cursive'][l.font]
    };
}

const LANG_NAMES: Record<string, string> = { eng: 'English', en: 'English', spa: 'Spanish', es: 'Spanish', fre: 'French', fra: 'French', fr: 'French', ger: 'German', deu: 'German', de: 'German', ita: 'Italian', it: 'Italian', por: 'Portuguese', pt: 'Portuguese', pob: 'Brazilian', 'pt-br': 'Brazilian', hin: 'Hindi', hi: 'Hindi', ara: 'Arabic', ar: 'Arabic', tur: 'Turkish', tr: 'Turkish', rus: 'Russian', ru: 'Russian', jpn: 'Japanese', ja: 'Japanese', kor: 'Korean', ko: 'Korean', chi: 'Chinese', zho: 'Chinese', zh: 'Chinese', dut: 'Dutch', nld: 'Dutch', nl: 'Dutch', pol: 'Polish', pl: 'Polish', swe: 'Swedish', sv: 'Swedish', nor: 'Norwegian', no: 'Norwegian', dan: 'Danish', da: 'Danish', fin: 'Finnish', fi: 'Finnish', gre: 'Greek', ell: 'Greek', heb: 'Hebrew', he: 'Hebrew', ind: 'Indonesian', id: 'Indonesian', tha: 'Thai', th: 'Thai', vie: 'Vietnamese', vi: 'Vietnamese', rum: 'Romanian', ron: 'Romanian', hun: 'Hungarian', cze: 'Czech', ces: 'Czech', ukr: 'Ukrainian', per: 'Persian', fas: 'Persian', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', ben: 'Bengali', urd: 'Urdu', may: 'Malay', msa: 'Malay' };
function langName(s: Json): string {
    const label = String(s.label || '').trim();
    if (label && label.length > 3) return label;
    const code = String(s.lang || '').toLowerCase();
    return LANG_NAMES[code] || label || code.toUpperCase() || 'Unknown';
}

interface Props {
    subs: Json[]; loading: boolean; current: string; delay: number;
    onPick: (s: Json | null) => void; onDelay: (d: number) => void;
    look: SubLook; onLook: (patch: Partial<SubLook>) => void;
}

export function SubsPanel({ subs, loading, current, delay, onPick, onDelay, look, onLook }: Props) {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState('');
    const [view, setView] = useState<'list' | 'style'>('list');
    const mine = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const groups = useMemo(() => {
        const m = new Map<string, Json[]>();
        subs.forEach(s => { const k = langName(s); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); });
        const query = q.trim().toLowerCase();
        return [...m.entries()]
            .filter(([k, l]) => !query || k.toLowerCase().includes(query) || l.some(s => String(s.name || '').toLowerCase().includes(query)))
            .sort((a, b) => {
                const am = String(a[1][0].lang || '').toLowerCase().startsWith(mine) ? 0 : 1;
                const bm = String(b[1][0].lang || '').toLowerCase().startsWith(mine) ? 0 : 1;
                return am - bm || a[0].localeCompare(b[0]);
            });
    }, [subs, q, mine]);
    const set = (k: keyof SubLook, v: number) => onLook({ [k]: v });

    if (view === 'style') return (
        <div className="subsp">
            <button className="subsp-back" onClick={() => setView('list')}><span aria-hidden>‹</span> Subtitles</button>
            <div className="subsp-body">
                <div className="subsp-sample" style={lookVars(look)}><span>This is how they look</span></div>
                <h3 className="subsp-h">Room subtitle timing</h3>
                <div className="subsp-step">
                    <span>Sync</span>
                    <div>
                        <button className="ibtn" onClick={() => onDelay(+(delay - 0.25).toFixed(2))} disabled={!current} aria-label="Show subtitles sooner">−</button>
                        <output aria-live="polite">{delay > 0 ? '+' : ''}{delay.toFixed(2)} s</output>
                        <button className="ibtn" onClick={() => onDelay(+(delay + 0.25).toFixed(2))} disabled={!current} aria-label="Show subtitles later">+</button>
                    </div>
                </div>
                {!current && <p className="note subsp-hint">Pick a subtitle to adjust its timing.</p>}
                <h3 className="subsp-h">Look</h3>
                <Seg label="Size" names={SIZES} value={look.size} onChange={v => set('size', v)} />
                <Seg label="Position" names={POSITIONS} value={look.pos} onChange={v => set('pos', v)} />
                <Seg label="Colour" names={COLORS} value={look.color} onChange={v => set('color', v)} swatches />
                <Seg label="Background" names={BGS} value={look.bg} onChange={v => set('bg', v)} />
                <Seg label="Font" names={FONTS} value={look.font} onChange={v => set('font', v)} />
                <button className="btn small ghost subsp-reset" onClick={() => onLook(DEFAULT_LOOK)}>Reset look</button>
            </div>
        </div>
    );

    return (
        <div className="subsp">
            <input className="input subsp-search" type="search" placeholder="Search languages" value={q} onChange={e => { setQ(e.target.value); setOpen(''); }} aria-label="Search subtitle languages" />
            <div className="subsp-body">
                {!q && <button className={'subsp-row' + (!current ? ' on' : '')} onClick={() => onPick(null)}><span>Off</span>{!current && <i aria-hidden>✓</i>}</button>}
                {loading && !subs.length && [0, 1, 2, 3].map(i => <div key={i} className="subsp-skel" aria-hidden />)}
                {loading && !subs.length && <p className="note" role="status">Looking for subtitles…</p>}
                {!loading && !subs.length && <p className="note">No online subtitles found for this video.</p>}
                {subs.length > 0 && !groups.length && <p className="note">Nothing matches “{q.trim()}”.</p>}
                {groups.map(([name, list]) => {
                    const using = list.some(s => s.url === current);
                    const expanded = open === name;
                    if (list.length === 1) return (
                        <button key={name} className={'subsp-row' + (using ? ' on' : '')} onClick={() => onPick(list[0])}>
                            <span>{name}<small>{[list[0].name, list[0].addon].filter(Boolean).join(' · ')}</small></span>{using && <i aria-hidden>✓</i>}
                        </button>
                    );
                    return (
                        <div key={name} className={'subsp-group' + (expanded ? ' open' : '')}>
                            <button className={'subsp-row' + (using ? ' on' : '')} aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : name)}>
                                <span>{name}<small>{list.length} options</small></span><i aria-hidden>{using ? '✓' : expanded ? '−' : '+'}</i>
                            </button>
                            {expanded && list.map((s, i) => (
                                <button key={s.url + i} className={'subsp-row sub' + (s.url === current ? ' on' : '')} onClick={() => onPick(s)}>
                                    <span>{s.name || `Option ${i + 1}`}<small>{[i === 0 ? 'Best match' : '', s.addon].filter(Boolean).join(' · ')}</small></span>{s.url === current && <i aria-hidden>✓</i>}
                                </button>
                            ))}
                        </div>
                    );
                })}
            </div>
            <button className="subsp-more" onClick={() => setView('style')}>Style &amp; timing<span aria-hidden>›</span></button>
        </div>
    );
}

function Seg({ label, names, value, onChange, swatches }: { label: string; names: string[]; value: number; onChange: (v: number) => void; swatches?: boolean }) {
    return (
        <div className="subsp-seg" role="radiogroup" aria-label={label}>
            <span>{label}</span>
            <div>
                {names.map((n, i) => (
                    <button key={n} role="radio" aria-checked={value === i} className={value === i ? 'on' : ''} onClick={() => onChange(i)} title={n}>
                        {swatches ? <i style={{ background: COLOR_VALUES[i] }} aria-hidden /> : null}
                        {swatches ? <span className="sr">{n}</span> : n}
                    </button>
                ))}
            </div>
        </div>
    );
}
