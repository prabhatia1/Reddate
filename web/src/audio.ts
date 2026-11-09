const codes: Record<string, string> = { eng: 'en', hin: 'hi', tam: 'ta', tel: 'te', mal: 'ml', kan: 'kn', ben: 'bn', mar: 'mr', pan: 'pa', guj: 'gu', urd: 'ur', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', por: 'pt', rus: 'ru', ita: 'it', ara: 'ar' };
export function audioLanguage(raw: string) { const value = (raw || '').toLowerCase(); return codes[value] || (value === 'und' ? '' : value); }
export function audioLabel(raw: string, name: string, index: number) {
    const lang = audioLanguage(raw);
    try { return (lang ? new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) : '') || name || `Track ${index + 1}`; }
    catch { return name || raw || `Track ${index + 1}`; }
}
