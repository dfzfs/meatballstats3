// Fixing one reply's record by lines in the classifier's own format, kept as "✋ the person asked for this".
// Fixes are stored per reply (S.ufix) and put back if the reply is read again, so a re-read never undoes them.
import { ctx, store, save, ledger, ledger2, R } from './store.js';
import { cleanText, fingerprint } from '../core/clean.js';
import { absorb, absorbRel } from '../core/bundle.js';
import { refresh } from './inject.js';
import { resolve } from '../core/names.js';

const EMPTY = '<mb>\nnone\n</mb>\n<rel>none</rel>';
const part = (a, tag) => { const m = String(a || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return (m ? m[1] : '').split('\n').map((x) => x.trim()).filter((x) => x && x !== 'none'); };
const REL = /^(texture|tie|open|[^:|]+>[^:|]+\s*\|)/i;

// Read one reply again from a full answer (same path as editing it by hand).
export function reabsorb(i, answer) {
  const c = ctx(), m = c.chat?.[i], S = store(true);
  if (!m || !S) return false;
  const fp = fingerprint(m), prev = [...c.chat.slice(0, i)].reverse().find((x) => x.is_user);
  const b = { text: [prev ? `<user>${cleanText(prev.mes)}</user>` : '', cleanText(m.mes)].filter(Boolean).join('\n\n'), fps: [fp] };
  const r = absorb(S.ev, b, String(answer), ledger(), R.V);
  if (r.pushed) return false;
  absorbRel(S.rel, b, String(answer), ledger(), R.bp, R.V, R.lang, [], ledger2());
  S.raw[fp] = { ...(S.raw[fp] || {}), a: String(answer).slice(0, 2500), t: Date.now() };
  return true;
}
function merge(old, fix) {
  const keyOf = (l) => l.replace(/^-/, '').split(/[:|]/)[0].trim().toLowerCase();
  let mb = part(old, 'mb'), rel = part(old, 'rel');
  for (const l of fix.lines) {
    const neg = l.startsWith('-'), body = neg ? l.slice(1).trim() : l, isRel = REL.test(body);
    const list = isRel ? rel : mb, k = keyOf(body);
    // one-of keys (date, time, loc, tie ...) replace the old line of the same key and pair
    const same = (x) => keyOf(x) === k && (!/[>-]/.test(body.split(/[:=]/)[1] || '') || x.split('=')[0] === body.split('=')[0]);
    const kept = list.filter((x) => (neg ? x !== body && !(same(x) && x.includes(body.split('=').pop().trim())) : !(['date', 'time', 'loc', 'tie', 'texture'].includes(k) && same(x))));
    if (!neg) kept.push(body);
    if (isRel) rel = kept; else mb = kept;
  }
  return `<mb>\n${mb.join('\n') || 'none'}\n</mb>\n<rel>\n${rel.join('\n') || 'none'}\n</rel>`;
}
// Apply fixes [{ i, lines }]. Returns the undo list (old answers) or null.
export function applyFixes(fixes, note = '') {
  const c = ctx(), S = store(true); if (!S) return null;
  const undo = [];
  for (const f of fixes) {
    const m = c.chat?.[f.i]; if (!m || m.is_user || !f.lines?.length) continue;
    const fp = fingerprint(m), old = S.raw?.[fp]?.a || EMPTY;
    if (!reabsorb(f.i, merge(old, f))) continue;
    undo.push({ i: f.i, fp, old, had: S.ufix?.[fp] || null });
    (S.ufix ||= {})[fp] = { lines: [...(S.ufix?.[fp]?.lines || []), ...f.lines].slice(-20), note: String(note).slice(0, 200), at: Date.now() };
    markUser(S, fp, f.lines);
    (S.edited ||= {})[fp] = Date.now();
  }
  if (undo.length) { save(); refresh(); }
  return undo.length ? undo : null;
}
export function undoFixes(undo) {
  const S = store(true); if (!S || !undo) return;
  for (const u of undo) { reabsorb(u.i, u.old); if (u.had) S.ufix[u.fp] = u.had; else delete S.ufix?.[u.fp]; }
  save(); refresh();
}
// The person's relation lines are taken as they are (the quote and name checks are for the classifier, not for them).
function trustRel(S, fp, lines) {
  const st = ledger(), list = (S.rel[fp] ||= []), day = list.find((e) => e.day != null)?.day ?? st.cal.n;
  const nm = (n) => resolve(st.names, n.trim(), R.V) || n.trim();
  const texOf = (w) => { const v = w.trim().toLowerCase(); for (const L of [R.lang.en, R.lang.ko]) { const i = L.rel.tex.findIndex((x) => x.toLowerCase() === v || v.startsWith(x.toLowerCase())); if (i >= 0) return i; } return -1; };
  for (const l of lines) {
    if (l.startsWith('-')) continue;
    let m = l.match(/^(?:texture|결)\s*[:：]\s*([^=|>]+)>([^=|]+?)\s*=\s*([^|]+)/i);
    if (m) { const a = nm(m[1]), b = nm(m[2]), t = texOf(m[3]); if (t < 0) continue;
      S.rel[fp] = list.filter((e) => !(e.k === 'tex' && e.a === a && e.b === b)); S.rel[fp].push({ k: 'tex', a, b, t, q: '', day, by: 'user' }); continue; }
    m = l.match(/^(?:tie|사이)\s*[:：]\s*([^=|]+?)\s*-\s*([^=|]+?)\s*=\s*([^|]+)/i);
    if (m) { const a = nm(m[1]), b = nm(m[2]);
      S.rel[fp] = (S.rel[fp] || list).filter((e) => !(e.k === 'tie' && [e.a, e.b].sort().join('|') === [a, b].sort().join('|'))); S.rel[fp].push({ k: 'tie', a, b, v: m[3].trim().slice(0, 40), q: '', day, by: 'user', user: true }); }
  }
}
// The events made from the person's lines carry by:'user' (shown as ✋; a date is forced).
function markUser(S, fp, lines) {
  trustRel(S, fp, lines);
  const keys = new Set(lines.filter((l) => !l.startsWith('-')).map((l) => l.split(/[:|]/)[0].trim().toLowerCase()));
  for (const e of S.ev?.[fp] || []) if (keys.has(e.k)) { e.by = 'user'; if (e.k === 'date') e.force = true; }
  for (const e of S.rel?.[fp] || []) if (keys.has(e.k === 'tex' ? 'texture' : e.k)) e.by = 'user';
}
// After the classifier read these replies again: put the person's fixes back on top.
export function keepFixes(fps) {
  const S = store(true), c = ctx(); if (!S?.ufix) return;
  for (const fp of fps) {
    const f = S.ufix[fp]; if (!f) continue;
    const i = (c.chat || []).findIndex((m) => fingerprint(m) === fp); if (i < 0) continue;
    if (reabsorb(i, merge(S.raw?.[fp]?.a || EMPTY, f))) markUser(S, fp, f.lines);
  }
  save();
}
