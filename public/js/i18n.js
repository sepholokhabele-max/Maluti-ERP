// Language of the help notes and instructions: English, Sesotho, or both (English with Sesotho underneath).
// Kept per computer (and per browser), so each person can choose.
export const LANGS = [['en', 'English'], ['st', 'Sesotho'], ['both', 'English + Sesotho']];
export function lang() { try { return localStorage.getItem('maluti_lang') || 'en'; } catch (_) { return 'en'; } }
export function setLang(l) { try { localStorage.setItem('maluti_lang', l); } catch (_) {} }
/** short screen texts: Sesotho when chosen, otherwise English */
export const L = (en, st) => (lang() === 'st' && st ? st : en);
/** a help note in the chosen language(s); returns { text, alt } where alt is shown smaller under text */
export function pick(en, st) {
  const l = lang();
  if (l === 'st') return { text: st || en, alt: null };
  if (l === 'both' && st) return { text: en, alt: st };
  return { text: en, alt: null };
}
