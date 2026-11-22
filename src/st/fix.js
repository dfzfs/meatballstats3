// Fixing one reply's record by lines in the classifier's own format, kept as "✋ the person asked for this".
// Fixes are stored per reply (S.ufix) and put back if the reply is read again, so a re-read never undoes them.
import { ctx, store, save, ledger, ledger2, R } from './store.js';
import { cleanText, fingerprint } from '../core/clean.js';
import { absorb, absorbRel } from '../core/bundle.js';
import { parse, toEvents } from '../core/parse.js';
import { refresh } from './inject.js';
import { resolve } from '../core/names.js';

const EMPTY = '<mb>\nnone\n</mb>\n<rel>none</rel>';
const part = (a, tag) => { const m = String(a || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return (m ? m[1] : '').split('\n').map((x) => x.trim()).filter((x) => x && x !== 'none'); };
const REL = /^(texture|feel|마음|tie|open|[^:|]+>[^:|]+\s*\|)/i;

// Read one reply again from a full answer (same path as editing it by hand).
export function reabsorb(i, answer) {
  const c = ctx(), m = c.chat?.[i], S = store(true);
  if (!m || !S) return false;
  const fp = fingerprint(m), prev = [...c.chat.slice(0, i)].reverse().find((x) => x.is_user);
  const b = { text: [prev ? `<user>${cleanText(prev.mes)}</user>` : '', cleanText(m.mes)].filter(Boolean).join('\n\n'), fps: [fp] };
  const mbOnly = part(answer, 'mb'), r = absorb(S.ev, b, `<mb>\n${mbOnly.join('\n') || 'none'}\n</mb>`, ledger(), R.V);   // an empty <mb> is fine here
  if (r.pushed) return false;
  absorbRel(S.rel, b, String(answer), ledger(), R.bp, R.V, R.lang, [], ledger2());
  S.raw[fp] = { ...(S.raw[fp] || {}), a: String(answer).slice(0, 2500), t: Date.now() };
  return true;
}
const keyOf = (l) => l.replace(/^-/, '').split(/[:|]/)[0].trim().toLowerCase();
const lhsOf = (l) => l.replace(/^-/, '').split('=')[0].trim().toLowerCase();
const ONE = ['date', 'time', 'loc', 'tie', 'texture', 'with', 'weather', 'mood'];
// The classifier's own lines for this reply, minus the ones the person replaces or removes.
function baseOf(old, lines) {
  let mb = part(old, 'mb'), rel = part(old, 'rel');
  for (const l of lines) {
    const body = l.replace(/^-/, '').trim(), k = keyOf(body), lhs = lhsOf(body), neg = l.startsWith('-');
    const hit = (x) => keyOf(x) === k && (ONE.includes(k) ? (!/[>-]/.test(lhs) || lhsOf(x) === lhs) : (neg ? x.includes(body.split('=').pop().trim()) && lhsOf(x) === lhs : lhsOf(x) === lhs && ['wear', 'role', 'pos', 'body', 'mark'].includes(k)));
    mb = mb.filter((x) => !hit(x)); rel = rel.filter((x) => !hit(x));
  }
  return `<mb>\n${mb.join('\n') || 'none'}\n</mb>\n<rel>\n${rel.join('\n') || 'none'}\n</rel>`;
}
// The person's lines go in as they are: no name-in-text or quote checks.
function addUser(S, fp, i, lines) {
  const c = ctx(), m = c.chat?.[i], text = cleanText(m?.mes || '');
  const mbLines = lines.filter((l) => !l.startsWith('-') && !REL.test(l));
  if (mbLines.length) {
    const r = toEvents(parse(`<mb>\n${mbLines.join('\n')}\n</mb>`), text, R.V, ledger().with || [], { trust: true });
    const list = (S.ev[fp] ||= []), tail = list.filter((e) => e.k === 'dir' || e.k === 'drop');
    S.ev[fp] = [...list.filter((e) => e.k !== 'dir' && e.k !== 'drop'), ...r.ev.map((e) => ({ ...e, by: 'user', ...(e.k === 'date' ? { force: true } : {}) })), ...tail];
  }
  trustRel(S, fp, lines);
}
const show = (old, lines) => { const base = baseOf(old, lines), add = lines.filter((l) => !l.startsWith('-'));
  return base.replace('</mb>', `${add.filter((l) => !REL.test(l)).map((l) => `${l}   ✋`).join('\n')}\n</mb>`).replace('</rel>', `${add.filter((l) => REL.test(l)).map((l) => `${l}   ✋`).join('\n')}\n</rel>`).replace(/\nnone\n(?=.)/g, '\n'); };
// Apply fixes [{ i, lines }]. Returns the undo list (old answers) or null.
export function applyFixes(fixes, note = '') {
  const c = ctx(), S = store(true); if (!S) return null;
  const undo = [];
  for (const f of fixes) {
    const m = c.chat?.[f.i]; if (!m || m.is_user || !f.lines?.length) continue;
    const fp = fingerprint(m), old = S.raw?.[fp]?.a || EMPTY, had = S.ufix?.[fp] || null;
    const all = [...(had?.lines || []), ...f.lines].slice(-20);
    if (!reabsorb(f.i, baseOf(old.replace(/\s+✋$/gm, ''), all))) continue;
    addUser(S, fp, f.i, all);
    S.raw[fp].a = show(old.replace(/\s+✋$/gm, ''), all);
    undo.push({ i: f.i, fp, old, had });
    (S.ufix ||= {})[fp] = { lines: all, note: String(note).slice(0, 200), at: Date.now() };
    (S.edited ||= {})[fp] = Date.now();
  }
  if (undo.length) { save(); refresh(); }
  return undo.length ? undo : null;
}
export function undoFixes(undo) {
  const S = store(true); if (!S || !undo) return;
  for (const u of undo) { const clean = u.old.replace(/\s+✋$/gm, ''); reabsorb(u.i, u.had ? baseOf(clean, u.had.lines) : clean); if (u.had) { addUser(S, u.fp, u.i, u.had.lines); S.ufix[u.fp] = u.had; } else delete S.ufix?.[u.fp]; S.raw[u.fp].a = u.old; }
  save(); refresh();
}
// Free words -> the nearest of the engine's kinds (only for its rules; never shown). null = leave the kind alone.
const NEAR = [[0, /사랑|좋아|연모|설렘|짝사랑|끌림|호감|반함|love|crush|attract/i], [1, /욕망|집착|소유|탐|want|desire|obsess|possess/i], [2, /미련|그리움|그리워|못\s*잊|linger|miss|long/i],
  [3, /애증|love-hate/i], [5, /원망|미움|증오|분노|화|싫|resent|hate|anger/i], [6, /정$|우정|가족|신뢰|아낌|걱정|챙|연민|bond|care|trust|friend/i]];
function nearKind(words) { const all = words.join(' '); const hit = NEAR.filter(([, re]) => re.test(all)).map(([t]) => t);
  return hit.includes(0) && hit.includes(5) ? 3 : hit.length ? hit[0] : null; }
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
    // feel: A>B=사랑, 죄책감 — the person's own words; the nearest kind is picked quietly for the note rules
    m = l.match(/^(?:feel|마음)\s*[:：]\s*([^=|>]+)>([^=|]+?)\s*=\s*([^|]+)/i);
    if (m) { const a = nm(m[1]), b = nm(m[2]), words = m[3].split(/[,，·、]/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
      S.rel[fp] = (S.rel[fp] || list).filter((e) => !(e.k === 'feel' && e.a === a && e.b === b)); S.rel[fp].push({ k: 'feel', a, b, v: words, day, by: 'user' });
      const t = nearKind(words);
      if (t != null) { S.rel[fp] = S.rel[fp].filter((e) => !(e.k === 'tex' && e.a === a && e.b === b)); S.rel[fp].push({ k: 'tex', a, b, t, q: '', day, by: 'user' }); }
      continue; }
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
    const fresh = (S.raw?.[fp]?.a || EMPTY).replace(/\s+✋$/gm, '');
    if (reabsorb(i, baseOf(fresh, f.lines))) { addUser(S, fp, i, f.lines); S.raw[fp].a = show(fresh, f.lines); }
  }
  save();
}
