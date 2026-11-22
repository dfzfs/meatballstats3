// Reads the classifier's answer line by line, sorts out broken answers, and checks each line against the text.
import { inText, bare } from './names.js';
import { parseTime, parseDate } from './time.js';
import { ALL as KEYS } from './keys.js';

export function parse(t) {
  const lines = [], dropped = [];
  const body = String(t || '').replace(/^[\s\S]*?<mb>/i, '').replace(/<\/mb>[\s\S]*$/i, '').replace(/<rel>[\s\S]*$/i, '');
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.trim().replace(/^[-*•]\s*/, '').replace(/^\[?#\s*\d+\]?\s*[:.)]?\s*/, '').match(/^([a-zA-Z]+)\s*[:：]\s*(.+)$/);   // a «#12» reply number in front is not part of the line
    if (!m) { if (raw.trim() && !/^none$/i.test(raw.trim())) dropped.push({ raw, why: 'form' }); continue; }
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (!KEYS.includes(k)) { dropped.push({ raw, why: 'key' }); continue; }
    const segs = ['gone', 'cut', 'near', 'slip', 'lie', 'refuse', 'yield', 'press', 'lead', 'aside', 'seed'].includes(k) ? [v] : v.split(/\s*;\s*|\s+\|\s+|\s+\/\s+|,\s*(?=[^=,|/\s"“][^=,|/"“]{0,24}=)/).filter(Boolean);
    if (segs.length > 1 && segs.every((x) => /^[^=]{1,40}=/.test(x))) segs.forEach((x) => lines.push({ k, v: x }));   // "A=x; B=y" on one line
    else lines.push({ k, v });
  }
  return { lines, dropped, none: /none/i.test(body) && !lines.length };
}

// null = usable. 'empty' | 'garbled' | 'nokeys' = pushed to the next batch, never re-called.
export function brokenKind(t) {
  const s = String(t || '').trim(), ns = s.replace(/\s/g, '');
  if (!s) return 'empty';
  if (/(.)\1{9,}/u.test(ns) && new Set(ns).size < 8) return 'garbled';
  if (s.length > 20 && s.length < 300 && new Set(s).size / s.length < 0.08) return 'garbled';
  if (/<mb>\s*none\s*(<\/mb>)?\s*$/i.test(s) || /^none$/i.test(s)) return null;
  return parse(s).lines.length ? null : 'nokeys';
}

const normQ = (x) => String(x).toLowerCase().replace(/[“”"'‘’「」『』]/g, '').replace(/\s+/g, ' ').trim();
export function quoteOk(q, text, min = 12) {
  const a = normQ(q), b = normQ(text);
  if (a.length < min) return false;
  if (b.includes(a)) return true;
  for (let i = 0; i + 24 <= a.length; i += 6) if (b.includes(a.slice(i, i + 24))) return true;
  return false;
}
// Where the new scene starts: the cut words found in the text (spaces and quotes ignored, first 24 letters).
export function cutPos(text, words) {
  const w = String(words || '').trim().slice(0, 24).toLowerCase();
  return w ? text.toLowerCase().lastIndexOf(w) : -1;
}
// v0.9: is a quote inside <user>…</user> or <director>…</director> (the person's words or hidden instruction)?
export function inTag(q, text) {
  const t = String(text || ''), at = t.toLowerCase().indexOf(String(q || '').toLowerCase().slice(0, 20));
  if (at < 0) return false;
  const before = t.slice(0, at);
  return before.lastIndexOf('<user>') > before.lastIndexOf('</user>') || before.lastIndexOf('<director>') > before.lastIndexOf('</director>');
}
export const hasBreakLine = (text) => /^\s*(\*\s?\*\s?\*|-{3,}|[◇◆]+|#{3,})\s*$/m.test(text);

const splitNames = (v) => v.split(/[,，、·]/).map((x) => x.trim()).filter(Boolean);
const eq = (v) => (v.includes('=') ? [v.slice(0, v.indexOf('=')).trim(), v.slice(v.indexOf('=') + 1).trim()] : [v.trim(), '']);
const two = (lhs, sep) => { const i = lhs.indexOf(sep); return i < 0 ? null : [bare(lhs.slice(0, i)), bare(lhs.slice(i + 1))]; };
const pick = (rhs, groups) => groups.findIndex((ws) => ws.some((w) => rhs.toLowerCase().includes(w.toLowerCase())));

// Parsed lines -> events (plain data, ready to store). Lines that fail a check go to `dropped`, the rest survive.
// scene = people currently in the scene (for pruning when a cut comes without a "with" line).
// opts.active = keys switched on (others are dropped as 'off'); opts.notPeople = names that are a title or a director, never a person.
export function toEvents(parsed, text, V, scene = [], opts = {}) {
  const ev = [], dropped = [...parsed.dropped], active = opts.active ? new Set(opts.active) : null;
  const notP = new Set((opts.notPeople || []).map((n) => bare(n).toLowerCase()));
  // trust: lines the person asked for — no name-in-text or quote checks (they know their story)
  const ok = (n, raw) => (opts.trust ? true : notP.has(bare(n).toLowerCase()) ? (dropped.push({ raw, why: 'not-a-person' }), false) : inText(n, text) ? true : (dropped.push({ raw, why: 'name-not-in-text' }), false));
  const qok = (q, t, min) => !!opts.trust || (!!q && quoteOk(q, t, min));
  const quoteOf = (v) => (v.match(/["“]([^"”]{4,})["”]?\s*$/) || [])[1];
  let cut = null, hasWith = false, moved = false;
  for (const { k, v } of parsed.lines) {
    const raw = `${k}: ${v}`, [lhs, rhs] = eq(v);
    if (active && !active.has(k) && !opts.trust) { dropped.push({ raw, why: 'off' }); continue; }
    if (k === 'cut') { cut = v.split('|')[0].trim(); ev.push({ k }); }
    else if (k === 'with') {
      const parts = splitNames(v).map((p) => ({ sign: p[0], n: bare(p) })).filter((x) => x.n && !notP.has(x.n.toLowerCase()));   // a title or a director is never "with"
      const full = v.trim().startsWith('=') || !parts.some((p) => /[+\-]/.test(p.sign));
      const good = parts.filter((x) => x.sign === '-' || ok(x.n, raw));
      hasWith = true;
      ev.push({ k, full: full && good.length === parts.length, add: good.filter((x) => x.sign !== '-').map((x) => x.n), del: good.filter((x) => x.sign === '-').map((x) => x.n) });
    } else if (k === 'time') { const t = parseTime(v, V); moved = moved || t.days > 0; ev.push({ k, days: t.days, tod: t.tod, date: strip(t.date), ...(t.fuzzy ? { fuzzy: t.fuzzy } : {}) }); moved = moved || !!t.fuzzy; }
    else if (k === 'date') { const d = parseDate(v, V); if (d) { moved = true; ev.push({ k, date: strip(d) }); } else dropped.push({ raw, why: 'date-unreadable' }); }
    else if (k === 'loc') { moved = true; ev.push({ k, v }); }
    else if (k === 'weather' || k === 'mood') ev.push({ k, v });
    else if (k === 'wear' || k === 'body' || k === 'know') {
      if (!rhs) dropped.push({ raw, why: 'form' });
      else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: rhs, ...(k === 'wear' && /^[+\-]/.test(rhs) ? { delta: true } : {}), ...(k === 'body' && pick(rhs, [V.healed]) === 0 ? { healed: true } : {}), ...(k === 'body' && pick(rhs.split(/[\s,]/)[0], [V.transient]) === 0 ? { brief: true } : {}) });
    } else if (k === 'gone') {
      const q = (v.match(/["“]([^"”]{4,})["”]?\s*$/) || [])[1], state = ['believed', 'dead', 'left'][pick(rhs, [V.gone.believed, V.gone.dead, V.gone.left])];
      if (!rhs || !state || !qok(q, text, 8)) dropped.push({ raw, why: 'gone-needs-quote' });
      else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: state, q: q.slice(0, 120) });
    } else if (k === 'promise' || k === 'call' || k === 'touch') {
      const p = two(lhs, '>');
      if (!p || !rhs) dropped.push({ raw, why: 'form' });
      else if (ok(p[0], raw) && ok(p[1], raw)) {
        const lvl = k === 'touch' ? pick(rhs, V.touch) : 0;
        if (lvl < 0) dropped.push({ raw, why: 'touch-word' }); else ev.push({ k, a: p[0], b: p[1], v: k === 'touch' ? lvl : rhs });
      }
    } else if (k === 'tie') {
      const p = two(lhs, '-');
      if (!p || !rhs) dropped.push({ raw, why: 'form' }); else if (ok(p[0], raw) && ok(p[1], raw)) ev.push({ k, a: p[0], b: p[1], v: rhs });
    } else if (k === 'pos' || k === 'mark') {
      if (!rhs) dropped.push({ raw, why: 'form' }); else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: rhs.slice(0, 100) });
    } else if (k === 'item') {
      if (!rhs) dropped.push({ raw, why: 'form' });
      else if (ok(lhs, raw)) for (const part of rhs.split(/\s*[,，]\s*(?=[+\-])/)) { const sign = part.trim()[0] === '-' ? '-' : '+'; const v = part.trim().replace(/^[+\-]\s*/, '').slice(0, 60); if (v) ev.push({ k, who: bare(lhs), sign, v }); }
    } else if (k === 'near') {
      const q = (v.match(/["“]([^"”]{4,})["”]?\s*$/) || [])[1], m = v.replace(/\|[^|]*$/, '').match(/^(.+?)\s+[—–-]+\s+([^:：]+)[:：]\s*(.+)$/);
      if (!m || !qok(q, text, 8)) dropped.push({ raw, why: 'near-needs-quote' });
      else ev.push({ k, a: m[1].trim().slice(0, 60), rel: m[2].trim().slice(0, 20), b: m[3].trim().slice(0, 60), q: q.slice(0, 120) });
    } else if (k === 'slip') {
      const q = (v.match(/["“]([^"”]{4,})["”]?\s*$/) || [])[1], what = rhs.replace(/\|[^|]*$/, '').trim();
      if (!what || !qok(q, text, 8)) dropped.push({ raw, why: 'slip-needs-quote' });
      else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: what.slice(0, 60), q: q.slice(0, 120) });
    } else if (k === 'role') {
      if (!rhs) dropped.push({ raw, why: 'form' }); else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: rhs.slice(0, 60) });
    } else if (k === 'lie' || k === 'owe') {
      const p = two(lhs, '>'), q = quoteOf(v), what = rhs.replace(/\|[^|]*$/, '').trim(), off = what.startsWith('-');
      if (!p || !what) dropped.push({ raw, why: 'form' });
      else if (k === 'lie' && !off && (!qok(q, text, 8))) dropped.push({ raw, why: 'lie-needs-quote' });
      else if (ok(p[0], raw) && ok(p[1], raw)) ev.push({ k, a: p[0], b: p[1], v: what.replace(/^[+\-]\s*/, '').slice(0, 80), off, ...(q ? { q: q.slice(0, 120) } : {}) });
    } else if (k === 'refuse') {
      const p = two(lhs, '>'), q = quoteOf(v), what = rhs.replace(/\|[^|]*$/, '').trim();
      if (!p || !what) dropped.push({ raw, why: 'form' });
      else if (!qok(q, text, 8)) dropped.push({ raw, why: 'refuse-needs-quote' });
      else if (ok(p[0], raw) && ok(p[1], raw)) ev.push({ k, a: p[0], b: p[1], v: what.slice(0, 60), q: q.slice(0, 120) });
    } else if (k === 'yield' || k === 'press' || k === 'aside') {
      // v0.9: yield and aside must be in what the story wrote (not <user> / <director>); press may come from the person
      const p = two(lhs, '>'), q = quoteOf(v), what = rhs.replace(/\|[^|]*$/, '').trim();
      if (!p || !what) dropped.push({ raw, why: 'form' });
      else if (!qok(q, text, 8)) dropped.push({ raw, why: `${k}-needs-quote` });
      else if (k !== 'press' && inTag(q, text)) dropped.push({ raw, why: `${k}-in-instruction` });
      else if (ok(p[0], raw) && ok(p[1], raw)) ev.push({ k, a: p[0], b: p[1], v: what.slice(0, 60), q: q.slice(0, 120) });
    } else if (k === 'lead' || k === 'seed') {
      const q = quoteOf(v), what = rhs.replace(/\|[^|]*$/, '').trim();
      if (!what) dropped.push({ raw, why: 'form' });
      else if (!qok(q, text, 8)) dropped.push({ raw, why: `${k}-needs-quote` });
      else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: what.slice(0, 60), q: q.slice(0, 120), ...(k === 'lead' && inTag(q, text) ? { byUser: true } : {}) });
    } else if (k === 'money') {
      if (!rhs) dropped.push({ raw, why: 'form' }); else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), v: rhs.slice(0, 40) });
    } else if (k === 'stat') {
      const [item, val] = eq(rhs);
      if (!item || !val) dropped.push({ raw, why: 'form' }); else if (ok(lhs, raw)) ev.push({ k, who: bare(lhs), item: item.slice(0, 20), v: val.slice(0, 30) });
    } else if (k === 'alias') { if (rhs && ok(lhs, raw) && ok(rhs, raw)) ev.push({ k, who: bare(lhs), v: bare(rhs) }); }
  }
  // A new scene without a "with" line: people whose names do not appear after the boundary leave the scene (0 calls).
  const boundary = cut != null || (hasBreakLine(text) && moved);
  if (boundary && !hasWith && scene.length) {
    const at = cut != null ? cutPos(text, cut) : -1, after = at >= 0 ? text.slice(at) : text;
    const del = scene.filter((n) => !inText(n, after));
    if (del.length) ev.push({ k: 'with', full: false, add: [], del });
    if (cut == null) ev.unshift({ k: 'cut' });
  }
  return { ev, dropped };
}
const strip = (d) => (d ? { m: d.m, d: d.d, wd: d.wd, y: d.y, part: d.part } : undefined);
