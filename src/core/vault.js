// v0.8: the vault (금고), sparks (불씨) and lines (선). No model calls here; pure functions over the lore sheet.
//
// Vault — what the person wants kept: a secret, or where the story should end up. Five layers keep it:
//   1. the main model never gets the secret, only what may show (`shows`): effects, never the cause
//   2. firewall: any outgoing note line holding a sign word or a piece of the secret is dropped (code, not a request)
//   3. guard: each new reply is scanned for sign words at once; the classifier also answers a guard question
//      (revealed / settled / rushed, with a quote that must be in the reply) — answers only warn, never go to a note
//   4. quarantine: records that carry a sign word are not kept, so the story cannot overwrite the person's secret
//   5. masking: the report and copy button never show vault content
import { quoteOk } from './parse.js';
import { runLength, touches, onBeat } from './ledger2.js';

const norm = (x) => String(x || '').toLowerCase().replace(/[“”"'‘’「」『』]/g, '').replace(/\s+/g, ' ').trim();
const fillAll = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : m));
const whoOf = (w) => String(w || '').split('-').map((x) => x.trim()).filter(Boolean);   // "A" or "A-B"

// A sign is in a text: Korean (or any non-latin) as a substring, latin words on word edges ("memory" not in "memorycard").
export function hasSign(text, sign) {
  const t = norm(text), s = norm(sign);
  if (s.length < 2) return false;
  if (!/^[a-z0-9 '\-]+$/.test(s)) return t.includes(s);
  return new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t);
}
const pieces = (secret, n = 14) => { const c = norm(secret), out = []; for (let i = 0; i + n <= c.length; i += 4) out.push(c.slice(i, i + n)); return c.length && c.length < n ? [c] : out; };
// Which vault entry a line touches (or null).
export function touchesVault(line, bp) {
  const l = norm(line);
  for (const x of bp?.vault || []) {
    if (x.signs.some((s) => hasSign(l, s))) return x;
    if (pieces(x.v).some((p) => l.includes(p))) return x;
  }
  return null;
}

// Layer 2. Lines of an outgoing layer text; heads ("[…]") stay; `keep(line)` true = never dropped (the person's own note).
export function firewall(text, bp, keep = () => false) {
  if (!text || !bp?.vault?.length) return { text, dropped: [] };
  const dropped = [], out = [];
  for (const l of String(text).split('\n')) { if (!/^\[/.test(l) && !keep(l) && touchesVault(l, bp)) dropped.push(l); else out.push(l); }
  const body = out.filter((l) => !/^\[/.test(l) && l.trim());
  return { text: body.length ? out.join('\n') : '', dropped };
}

// Layer 3a. Sign words in a reply (no call). [{ who, sign }]
export function scan(reply, bp) {
  const hits = [];
  for (const x of bp?.vault || []) for (const s of x.signs) if (hasSign(reply, s)) { hits.push({ who: x.who, sign: s }); break; }
  return hits;
}
// Layer 3b. The guard block for the classifier (numbered per call; the numbers are never stored).
//   G = vault entries (+ v0.9 clue / near) · F = a harsh attitude's limit · K = what must stay once someone has fallen
export function guardBlock(bp, L, opts = {}) {
  const G = L.guard, out = [];
  (bp?.vault || []).forEach((x, i) => out.push(`G${i + 1} | ${x.who} | ${x.v}${x.signs.length ? ` | ${G.signs}: ${x.signs.join(', ')}` : ''}`));
  (bp?.harsh || []).forEach((x, i) => out.push(`F${i + 1} | ${x.a} toward ${x.b} | ${G.limit}: ${x.limit || G.limitDefault}`));
  (opts.falls || []).forEach((x, i) => out.push(`K${i + 1} | ${x.a} | ${G.keeps}: ${x.keeps}`));
  // 지시창 rules: the classifier judges whether a NEW reply did what a rule asks to avoid
  (opts.habits || []).forEach((x, i) => out.push(`H${i + 1} | ${x.name} | ${x.text}`));
  return out.length ? `\n\n${G.head}\n${out.join('\n')}\n${G.rules}${(bp?.harsh || []).length || (opts.falls || []).length ? `\n${G.rules2}` : ''}${(opts.habits || []).length ? `\n${G.rules3}` : ''}` : '';
}
// "<guard> G1: revealed | "quote" </guard>" -> [{ cls, who, kind, q, fp, byUser }]; the quote must be in the text.
// A quote that sits in the person's own words (<user> / <director>) is the person's move, not a leak (byUser).
export function parseGuard(answer, bundleText, replies, bp, opts = {}) {
  const m = String(answer || '').match(/<guard>([\s\S]*?)(<\/guard>|<mb>|$)/i), out = [];
  if (!m) return out;
  for (const raw of m[1].split(/\r?\n/)) {
    const x = raw.trim().match(/^([GFKH])(\d+)\s*[:：]\s*(revealed|settled|rushed|clue|near|crossed|lost|broke)\b[^"“]*["“]([^"”]{4,})["”]?/i);
    if (!x) continue;
    const cls = x[1].toUpperCase(), i = Number(x[2]) - 1, kind = x[3].toLowerCase(), q = x[4].trim();
    const ent = cls === 'G' ? bp?.vault?.[i] : cls === 'F' ? bp?.harsh?.[i] : cls === 'H' ? opts.habits?.[i] : opts.falls?.[i];
    if (!ent || !quoteOk(q, bundleText, 8)) continue;
    if ((cls === 'G') !== ['revealed', 'settled', 'rushed', 'clue', 'near'].includes(kind)) continue;
    if (cls === 'F' && kind !== 'crossed') continue;
    if (cls === 'K' && kind !== 'lost') continue;
    if ((cls === 'H') !== (kind === 'broke')) continue;
    const r = replies.find((y) => quoteOk(q, y.text, 8));
    out.push({ cls, who: ent.who || ent.a || ent.id, kind, q: q.slice(0, 160), fp: r ? r.fp : replies.at(-1)?.fp, byUser: !r });
  }
  return out;
}

// v0.9 clue pressure per vault entry, folded from S.clue[fp] in chat order: 0 low · 1 mid · 2 high.
// Distinct quotes count; mid needs them from two different replies; any "near" (someone reasoning toward it) is high.
export function foldPressure(chat, S, bp, fingerprint) {
  const by = {};
  for (const m of chat || []) {
    if (m.is_user || m.is_system) continue;
    const fp = fingerprint(m);
    for (const c of S?.clue?.[fp] || []) { const x = (by[c.who] ||= { qs: new Set(), fps: new Set(), near: false }); x.qs.add(c.q); x.fps.add(fp); if (c.kind === 'near') x.near = true; }
  }
  const lv = {};
  for (const v of bp?.vault || []) { const x = by[v.who]; lv[v.who] = !x ? 0 : x.near || x.qs.size >= 4 ? 2 : x.qs.size >= 2 && x.fps.size >= 2 ? 1 : 0; }
  return lv;
}

// Layer 4. Drops stored events that carry a vault sign or a piece of the secret. Mutates the lists; returns what went.
// Directions (방향) are not secrets of a character: a record of what really happened (a confession) stays even when it
// touches a direction's words. Only real vault lines (lore · typed secrets) quarantine records.
export function quarantine(groups, fps, bp0) {
  const gone = [], bp = bp0 ? { ...bp0, vault: (bp0.vault || []).filter((x) => !x.goal) } : bp0;
  if (!bp?.vault?.length) return gone;
  for (const fp of fps) {
    const g = groups[fp];
    if (!Array.isArray(g)) continue;
    groups[fp] = g.filter((e) => { if (e.k === 'drop' || e.k === 'dir') return true; const t = touchesVault(JSON.stringify(e), bp); if (t) gone.push({ raw: `${e.k} (${t.who})`, why: 'vault', k: e.k, who: t.who, fp }); return !t; });
  }
  return gone;
}

// ---------------------------------------------------------------------------------------------------------------
// v0.9 — everything below is folded from what is stored per reply (fingerprint), so rerolls and deletions fix it.

// Which vault entries are open: the gate (열림) quoted by the classifier, the person's own decision, or a kept leak —
// a reply the guard caught as "revealed" that stays in the chat while two more replies follow it (the story has
// moved on with the secret out; asking the model to keep hiding what the text already says makes it contradict itself).
// S.vdec[fp] = [{ who, open }] (the person's buttons) · S.guard[fp].false = the person marked it a false alarm.
export function foldVault(chat, S, bp, st2, fingerprint) {
  const opened = new Set(), ai = (chat || []).filter((m) => !m.is_user && !m.is_system);
  for (const x of bp?.vault || []) if (st2?.open?.[`vault:${x.who}`]) opened.add(x.who);
  ai.forEach((m, i) => {
    const fp = fingerprint(m), g = S?.guard?.[fp];
    if (g && !g.false && ai.length - 1 - i >= 2) for (const h of g.hits || []) if (h.kind === 'revealed') opened.add(h.who);
    for (const d of S?.vdec?.[fp] || []) d.open ? opened.add(d.who) : opened.delete(d.who);
  });
  return opened;
}
export const liveBp = (bp, opened) => (bp && opened?.size ? { ...bp, vault: (bp.vault || []).filter((x) => !opened.has(x.who)) } : bp);

// What was sent with each reply (S.sent[fp] = { special, eased: [thread keys] }): how long since the last special
// line, and which refusal threads already got their "eased" line.
export function foldSent(chat, S, fingerprint) {
  const ai = (chat || []).filter((m) => !m.is_user && !m.is_system), eased = new Set(), marks = new Map(), hist = new Map();
  let ago = 99;
  ai.forEach((m, i) => {
    const x = S?.sent?.[fingerprint(m)]; if (!x) return;
    const a = ai.length - 1 - i;
    if (x.special) ago = a;
    for (const k of x.eased || []) eased.add(k);
    for (const k of x.marks || []) { marks.set(k, a); (hist.has(k) ? hist.get(k) : hist.set(k, []).get(k)).push(a); }
  });
  // marks: the last time a marked line went out (replies ago) · count(mark, within): how many times within that many replies
  return { ago, eased, marks, count: (k, w) => (hist.get(k) || []).filter((a) => a < w).length };
}

// Refusal threads (v0.9, replaces "3 replies then gone"). A refusal holds until something in the story releases it:
// the line's 풀림 gate (quoted), the person closing it, or — for a romantic ask — the two becoming lovers.
// Pressing is counted from the chat itself: the person's messages after the refusal that touch what was refused
// (or push words). Nothing extra is stored. Stage of this reply: 0 none · 1 asked again · 2+ keeps pressing.
const PUSH = (L) => [...(L.en?.rel?.pushWords || []), ...(L.ko?.rel?.pushWords || [])];
export function threads(chat, st1, st2, bp, S, fingerprint, cleanText, langs, opts = {}) {
  const out = [], rows = (chat || []).filter((m) => !m.is_system), pw = PUSH(langs || {});
  const presses = (v, t) => touches(v, t) || pw.some((w) => hasSign(t, w));
  const lastAi = rows.map((m, i) => (!m.is_user ? i : -1)).filter((i) => i >= 0).at(-1);
  const sent = foldSent(chat, S, fingerprint);
  for (const r of st1.refused || []) {
    if (r.out) continue;
    const key = `${r.a}>${r.b}:${r.v}`;
    const at = rows.findIndex((m) => !m.is_user && r.q && cleanText(m.mes).toLowerCase().includes(String(r.q).toLowerCase().slice(0, 24)));
    if (at < 0) continue;
    const gate = (bp?.line || []).some((x, i) => x.who === r.a && st2?.open?.[`line:${x.who}:${i}`] && (st2.open[`line:${x.who}:${i}`].day ?? 0) >= (r.day ?? 0));
    const romance = pw.some((w) => hasSign(r.v, w));
    if (gate || (romance && opts.lover?.(r.a, r.b))) continue;
    const after = rows.slice(at + 1), users = after.filter((m) => m.is_user && presses(r.v, cleanText(m.mes)));
    const last = rows.at(-1), pressNow = !!(last?.is_user && presses(r.v, cleanText(last.mes)));
    const aiSinceLast = (() => { const i = users.length ? rows.lastIndexOf(users.at(-1)) : at; return rows.slice(i + 1).filter((m) => !m.is_user).length; })();
    let mode = null;
    if (pressNow) mode = users.length >= 2 ? 'press' : 'again';
    else if (at === lastAi) mode = 'hold';
    else if (users.length && aiSinceLast >= (opts.dormant || 6) && !sent.eased.has(key)) mode = 'ease';
    out.push({ key, a: r.a, b: r.b, v: r.v, q: r.q, stage: pressNow ? Math.min(3, users.length) : 0, mode, dormant: aiSinceLast >= (opts.dormant || 6) });
  }
  return out;
}

// Note rows for v0.9, each with a kind (the selector grades them). opts: { cue, user (the person's character name),
// lover(a, b), threads (from threads()), ago (replies since the last special line), jitter (bool), every (spark gap),
// interrogate (bool: the person's message digs at someone's secret), redo ({ kind, who, v } after a guard rewrite) }
const hashOf = (t) => { let x = 0; for (const c of String(t)) x = (x * 31 + c.codePointAt(0)) >>> 0; return x.toString(36); };
export function rows3(st1, st2, bp, L, opts = {}) {
  const R = L.rel, here = st1.with || [], now = [], cue = opts.cue || '';
  if (!bp) return now;
  const row = (kind, text, src = 'v09', mark) => now.push({ layer: 'now', kind, text: `- ${text}`, src, ...(mark ? { mark } : {}) });
  const runOf = (names) => runLength(st1.hist, (w) => names.every((n) => w.includes(n)));
  // 방향 · 천천히 밀어주기: the person chose to tell the story AI where it is headed. Every few replies (not every one: told
  // each time, a model rushes there), only with someone on stage, and not right after the last reply already showed its
  // words (then it is moving, maybe too fast: the ⚠ guard watches that). One small step at most, never the arrival.
  const goalPush = (x, who) => {
    if (!here.length) return;
    const mk = `goal:${hashOf(x.v)}`, ago = opts.marks?.get(mk) ?? 99, every = Math.max(2, opts.goalEvery || 4);
    if (ago < every || (x.signs || []).some((s) => hasSign(opts.recent || opts.tail || '', s))) return;   // its words showed in the last few replies: it is moving (or there)
    row('goalPush', `${R.goalPushLabel}${who ? ` (${who})` : ''}: ${fillAll(R.goalPush, { v: x.v })}`, 'vault', mk);
  };
  // --- vault (grade 0). Nothing here holds the secret or a sign word.
  for (const x of bp.vault || []) {
    if (x.goal && !x.who) { if (x.push) goalPush(x, here.slice(0, 2).join(' & ')); else if (x.hint && here.length) row('goalHint', fillAll(R.goalHint, { who: here.slice(0, 2).join(' & ') }), 'vault'); continue; }
    const w = whoOf(x.who);
    if (!w.length || !w.every((n) => here.includes(n))) continue;
    const k = runOf(w), other = here.find((n) => !w.includes(n)) || '';
    const pr = opts.pressure?.[x.who] || 0;   // v0.9 step 2: clue pressure — the "may show" line feeds clues, so it stops
    // 털어놔도 돼 (the person asked for it, or switched it on for this scene): no hiding lines, one permission instead
    if (opts.letOut?.has(x.who)) { row('vaultLet', fillAll(R.vLet, { who: x.who }), 'vault'); continue; }
    if (x.goal) { if (x.push) goalPush(x, x.who); else if (x.hint) row('goalHint', fillAll(R.goalHint, { who: x.who }), 'vault'); continue; }
    if (x.shows && pr === 0 && onBeat(k, opts.showsEvery || 4)) row('vaultShows', fillAll(R.ordVault, { who: x.who, v: x.shows }), 'vault');
    if (w.length === 1 && other && opts.pov !== false && (pr >= 1 || onBeat(k, 3))) row('vaultPov', fillAll(R.vPov, { who: x.who, other }), 'vault');
    if (pr >= 2 && w.length === 1 && other && opts.pov !== false && (k <= 1 || (opts.marks?.get(`suspect:${x.who}`) ?? 99) >= 8)) row('suspect', fillAll(R.vSuspect, { who: x.who, other }), 'vault', `suspect:${x.who}`);
    else if (x.cover && other && (k <= 1 || (x.shows && touches(x.shows, cue)) || touches(x.cover, cue))) row('vaultCover', fillAll(R.vCover, { who: x.who, cover: x.cover }), 'vault');
  }
  for (const y of bp.avoid || []) if (here.includes(y.a) && here.includes(y.b) && y.b !== opts.user && opts.interrogate) row('vaultAvoid', fillAll(R.vAvoid, { who: y.a, other: y.b, motive: y.v }), 'vault');
  // the person's press button (지시창): a vetted line for this reply, recorded as the person's order
  if (opts.press && here.includes(opts.press.a)) {
    const P = opts.press, b = P.b || here.find((n) => n !== P.a) || '', th = (opts.threads || []).find((t) => t.a === P.a);
    const T = { burst: R.ordBurst, hold: R.ordHeld, refuse: R.ordRefuse, give: R.pressGive, lead: R.leadA, harsh: R.harshA, collapse: R.fallCollapse }[P.kind];
    if (T && (P.kind !== 'collapse' || opts.fallen?.has(P.a))) row('press', fillAll(T, { a: P.a, b, who: P.a, inner: '', v: th?.v || R.whatAsked }), 'press');
  }
  if (opts.redo) row('redo', fillAll(opts.redo.kind === 'refuse' ? R.redoRefuse : R.redoVault, { who: opts.redo.who, a: opts.redo.who, v: opts.redo.v || '' }), 'redo');
  // --- refusal (grade 1): an open thread answers the press of this reply; a first push meets the line's permission
  const th = opts.threads || [], busy = new Set();
  for (const t of th) {
    if (!here.includes(t.a) || !here.includes(t.b)) continue;
    const fl = opts.fallen?.has(t.a);   // fallen: the no still stands, it only costs more to say
    if (t.mode === 'again') row('refuseAgain', fillAll(fl ? R.refFallen : R.refAgain, t));
    else if (t.mode === 'press') row('refusePress', fillAll(fl ? R.refFallen : R.refPress, t));
    else if (t.mode === 'hold') row('refuseHold', fillAll(fl ? R.refFallen : R.refHold, t));
    else if (t.mode === 'ease') row('refuseEase', fillAll(R.refEase, t), `ease:${t.key}`);
    if (t.mode && t.mode !== 'ease') busy.add(t.a);
  }
  const push = (L.rel.pushWords || []).some((w) => hasSign(cue, w));
  (bp.line || []).forEach((x, i) => {
    // its 풀림 already came (the relationship reading marked it open): this line no longer asks for a no
    if (!here.includes(x.who) || !cue || busy.has(x.who) || st2?.open?.[`line:${x.who}:${i}`]) return;
    const others = here.filter((n) => n !== x.who), lovers = others.some((o) => opts.lover?.(x.who, o));
    if (touches(x.v, cue) || (!lovers && push)) row('refuse', fillAll(R.ordRefuse, { who: x.who }), 'line');
  });
  // --- spark (grade 3, shares the one special slot): no fixed beat; when the pair stands still, or after a gap that
  // the last reply's fingerprint shakes a little. The person's character is in the pair when possible.
  const pairs = [];
  for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
    const a = here[i], b = here[j], ab = st2?.dir?.[`${a}>${b}`], ba = st2?.dir?.[`${b}>${a}`];
    const linked = ab || ba || (bp.texture || []).concat(bp.inner || [], bp.barrier || [], bp.tie || []).some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (linked) pairs.push({ a, b, ab, ba });
  }
  pairs.sort((x, y) => (y.a === opts.user || y.b === opts.user) - (x.a === opts.user || x.b === opts.user));
  const p = pairs[0];
  if (p && opts.spark !== false) {
    const still = [p.ab, p.ba].every((d) => d && d.moves.length >= 3 && d.moves.every((m) => m === 5));
    const due = (opts.ago ?? 99) >= (opts.every || 5) && opts.jitter !== false && runOf([p.a, p.b]) >= 2;
    if (still || due) {
      const chOf = (w) => (bp.channel || []).find((c) => c.who === w)?.v, kinds = [];
      const hiding = (w) => (bp.vault || []).some((v) => whoOf(v.who).includes(w)) || (bp.unknown || []).some((u) => u.who === w) || (bp.barrier || []).some((x) => x.a === w || x.b === w);
      for (const w of [p.a, p.b]) {
        const s0 = (bp.self || []).find((x) => x.who === w);
        // the old self may not slip for someone whose vault shares words with it (it could carry the secret out)
        const unsafe = s0 && ((opts.pressure?.[w] || 0) >= 1 || (bp.vault || []).some((v) => whoOf(v.who).includes(w) && (v.signs.some((g) => hasSign(s0.v, g)) || touches(v.v, s0.v))));
        if (s0 && hiding(w) && !unsafe) kinds.push(['self', w, s0.v]);
      }
      for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) if (chOf(a) && a !== opts.user) kinds.push(['notice', a, b, chOf(a)]);
      const pick = still ? ['turn'] : kinds[(opts.seed || 0) % Math.max(1, kinds.length)];
      if (pick) {
        const t = pick[0] === 'turn' ? R.sparkTurn : pick[0] === 'self' ? fillAll(R.sparkSelf, { who: pick[1], v: pick[2] }) : fillAll(R.sparkNotice, { a: pick[1], b: pick[2], ch: pick[3] });
        row('spark', t, 'spark');
      }
    }
  }
  return now;
}

// The one place where the shallow layer is chosen (v0.9). Every candidate row has a kind; kinds map to grades:
//   0 secret (most costly to miss) · 1 what this reply's event calls for · 2 the ground of the relation · 3 one special
// Caps per grade, one special at most and none right after another, then the whole layer fits maxLines / budget —
// dropping from the least important grade. Order in the layer: 2, 0, 1, 3 (this reply's own lines nearest the end).
export const GRADE = { vaultLet: 0, hide: 0, keep: 0, unknown: 0, vaultShows: 0, vaultCover: 0, vaultPov: 0, vaultAvoid: 0, suspect: 0, goalHint: 0,
  redo: 1, press: 1, goalPush: 1, refuseAgain: 1, refusePress: 1, refuse: 1, burstNow: 1, refuseHold: 1, harshAfter: 1, regroup: 1,
  held: 2, burst: 2, fallBase: 2, tie: 2, leak: 2, channel: 2,
  fallCollapse: 3, fallPull: 3, fallReceive: 3, lead: 3, seed: 3, care: 3, aside: 3, refuseEase: 3, spark: 3, harsh: 3, harshStart: 3 };
const RANK0 = ['vaultLet', 'hide', 'keep', 'vaultAvoid', 'suspect', 'unknown', 'vaultCover', 'vaultPov', 'goalHint', 'vaultShows'];   // 모름 ranks high: it was the strongest line in the v0.7 test
const RANK1 = ['redo', 'press', 'goalPush', 'harshAfter', 'refusePress', 'refuseAgain', 'burstNow', 'regroup', 'refuse', 'refuseHold'];
const RANK2 = ['held', 'burst', 'fallBase', 'tie', 'leak', 'channel'];
const RANK3 = ['fallCollapse', 'fallPull', 'fallReceive', 'lead', 'seed', 'care', 'aside', 'refuseEase', 'spark', 'harsh', 'harshStart'];   // design 8: one special, this order
export function compose(rows, opts = {}, est = (t) => Math.ceil(t.length / 4)) {
  const caps = { 0: 3, 1: 2, 2: 3, 3: 1, ...(opts.caps || {}) }, maxLines = opts.maxLines || 7, budget = opts.budget || 260;
  const by = { 0: [], 1: [], 2: [], 3: [] }, seen = new Set();
  for (const r of rows) { if (seen.has(r.text)) continue; seen.add(r.text); const g = GRADE[r.kind] ?? 2; by[g].push(r); }
  const order = (list, rank) => list.sort((x, y) => (rank.indexOf(x.kind) + 99) % 99 - (rank.indexOf(y.kind) + 99) % 99);
  order(by[0], RANK0); order(by[1], RANK1); order(by[2], RANK2); order(by[3], RANK3);
  for (const g of [0, 1, 2]) by[g] = by[g].slice(0, caps[g]);
  by[3] = opts.lastSpecial || by[1].length >= 2 ? [] : by[3].slice(0, caps[3]);
  const total = () => [...by[0], ...by[1], ...by[2], ...by[3]];
  const drop = () => { for (const g of [3, 2, 1, 0]) if (by[g].length) { by[g].pop(); return true; } return false; };
  while (total().length > maxLines && drop());
  while (est(total().map((r) => r.text).join('\n')) > budget && drop());
  return { rows: [...by[2], ...by[0], ...by[1], ...by[3]], special: by[3][0] || null };
}
