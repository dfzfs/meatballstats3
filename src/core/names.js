import { sameName } from './roman.js';
// Name dictionary. The story text is the source of names; this is the only place names are matched.
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isCJK = (n) => /[぀-ヿ一-鿿가-힣]/.test(n);
// v0.35.2: an unnamed extra ("husband", "orderly", "scrub nurse", "the Drum resident") is not a person to track: written
// in as one, it got a relationship row of its own ("husband → X: clash") and filled the scene list. A name has a capital
// letter (or is not Latin at all) and does not end in a role word. "Nurse Bell" or "Doctor Hale" stay names.
const ROLE = /^(?:the |a |an |that |this |some )?(?:[A-Z][\w'-]* )?(?:husband|wife|man|men|woman|women|boy|girl|kid|child|children|guy|lady|gentleman|stranger|someone|somebody|nurse|nurses|orderly|orderlies|resident|residents|doctor|doctors|surgeon|medic|guard|guards|soldier|soldiers|officer|clerk|clerks|servant|servants|maid|maids|butler|driver|waiter|waitress|bartender|shopkeeper|merchant|vendor|crowd|people|staff|crew|patient|patients|visitor|visitors|student|students|teacher|boss|chief|captain|mother|father|mom|dad|brother|sister|aunt|uncle|grandmother|grandfather|friend|friends|neighbor|neighbour|receptionist|secretary|assistant|intern|janitor|cook|chef|priest|knight|knights)$/i;
export const notAName = (name) => { const n = String(name || '').trim(); if (!n || !/[A-Za-z]/.test(n)) return false; if (/^[a-z]/.test(n)) return true; return ROLE.test(n); };
export const bare = (name) => String(name || '').replace(/^[=+\-\s]+/, '').replace(/[\s.,;:]+$/, '').trim();
export function inText(name, text) {
  const n = bare(name);
  if (n.length < 2) return false;                                        // one-letter names are dropped
  if (isCJK(n)) return text.includes(n);                                // particles may follow
  return new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, 'iu').test(text);   // word boundary
}
const tokens = (n) => n.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);

export const newDict = () => ({ seen: {}, alias: {} });   // seen: canon -> count, alias: lower -> canon
// Same person if: same letters, case-insensitive, known alias, Korean particle stripped, or one name's words inside the other's.
export function resolve(dict, name, V) {
  const n = bare(name), low = n.toLowerCase();
  if (!n) return null;
  if (dict.seen[n] != null) return n;
  if (dict.alias[low]) return dict.alias[low];
  const keys = Object.keys(dict.seen);
  const ci = keys.find((k) => k.toLowerCase() === low);
  if (ci) return ci;
  // the same Korean name written in Latin letters, or the other way round ("Seoyeon" = 서연)
  const ro = keys.find((k) => sameName(n, k) || sameName(k, n));
  if (ro) return ro;
  if (isCJK(n)) for (const p of V.particles) {
    if (n.endsWith(p) && n.length > p.length + 1) { const r = resolve(dict, n.slice(0, -p.length), V); if (r) return r; }
  } else {
    const t = tokens(n);
    const hit = t.length && keys.find((k) => { const kt = tokens(k); return kt.length && (t.every((x) => kt.includes(x)) || kt.every((x) => t.includes(x))); });
    if (hit) return hit;
  }
  return null;
}
export function learn(dict, name, V) {
  const got = resolve(dict, name, V), n = got || bare(name);
  if (!n) return null;
  dict.seen[n] = (dict.seen[n] || 0) + 1;
  return n;
}
export function addAlias(dict, name, other, V) {
  const c = learn(dict, name, V);
  if (c && bare(other) && !dict.seen[bare(other)]) dict.alias[bare(other).toLowerCase()] = c;
}
// Names for the prompt: seen in two or more batches, or a seed (card / persona name) that appears in the text.
export function knownNames(dict, seeds = [], text = '') {
  const out = Object.entries(dict.seen).filter(([, c]) => c >= 2).map(([n]) => n);
  for (const s of seeds) if (s && !out.includes(s) && (dict.seen[s] || inText(s, text))) out.push(s);
  return out;
}
// Pairs that differ by one letter: shown as "merge?" on screen, never merged automatically.
export function lookalikes(dict) {
  const k = Object.keys(dict.seen), out = [];
  for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
    const a = k[i], b = k[j];
    if (a.length === b.length && a.length > 2 && [...a].filter((ch, x) => ch !== b[x]).length === 1) out.push([a, b]);
  }
  return out;
}
