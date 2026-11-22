// Text cleanup, language detection, fingerprints. Knows nothing about SillyTavern.
export function cleanText(s) {
  return String(s || '')
    .replace(/<(choices|details|think|thinking|reasoning)[\s\S]*?<\/\1>/gi, '')
    .replace(/<span[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export const langOf = (t) => ((t.match(/[가-힣]/g) || []).length > t.length * 0.2 ? 'ko' : 'en');
export const estTokens = (s, lg) => Math.ceil(String(s || '').length / (lg === 'ko' ? 1.6 : 4));

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
// Fingerprint = speaker side + name hash + body hash + length. No swipe numbers.
export const fpOfText = (isUser, name, mes) => `${isUser ? 'u' : 'a'}.${fnv(String(name || ''))}.${fnv(String(mes || ''))}.${String(mes || '').length}`;
const cache = new WeakMap();
// SillyTavern marks a hidden message (👁 · /hide) as a system message. Its own notices (narrator · help · comments) carry
// extra.type, a hidden reply does not. With HIDDEN.read on, hidden replies count as part of the story (record, calendar).
export const HIDDEN = { read: false };
export const isHiddenMsg = (m) => !!m?.is_system && !m.extra?.type && !!String(m.mes || '').trim();
export const skipMsg = (m) => !!m?.is_system && !(HIDDEN.read && isHiddenMsg(m));
export function fingerprint(m) {
  const c = cache.get(m);
  if (c && c.mes === m.mes) return c.fp;
  const fp = fpOfText(m.is_user, m.name, m.mes);
  cache.set(m, { mes: m.mes, fp });
  return fp;
}

// Merge the parse vocabularies of every language file: the classifier may answer in either.
export function mergeVocab(...langs) {
  const P = langs.map((l) => l.parse);
  const cat = (f) => P.flatMap(f).filter(Boolean);
  const idx = (key, n) => Array.from({ length: n }, (_, i) => cat((p) => p[key][i] || []));
  const obj = (key, ks) => Object.fromEntries(ks.map((k) => [k, cat((p) => p[key]?.[k] || [])]));
  return {
    months: idx('months', 12), weekdays: idx('weekdays', 7), touch: idx('touch', 6),
    parts: obj('parts', ['early', 'mid', 'late']), units: obj('units', ['d', 'w', 'mo', 'y']), fuzzy: obj('fuzzy', ['d', 'w', 'mo', 'y']),
    gone: obj('gone', ['believed', 'dead', 'left']), loverTie: cat((p) => p.loverTie || []),
    next: cat((p) => p.next), healed: cat((p) => p.healed), transient: cat((p) => p.transient), particles: cat((p) => p.particles),
    monthNum: cat((p) => [p.monthNum]), dayNum: cat((p) => [p.dayNum]), yearNum: cat((p) => [p.yearNum]),
  };
}
