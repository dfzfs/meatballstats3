// Stage 2: relationships. Reads only the "rel" events, never touches the stage-1 ledger.
import { inText, resolve, bare } from './names.js';
import { quoteOk } from './parse.js';
import { estTokens, skipMsg } from './clean.js';
import { dateAt, fmtDate, span } from './time.js';
import { emptyBlueprint } from './blueprint.js';

export const ROMANCE = [0, 1, 2, 3, 4];                       // texture indexes that are romantic (bond, resentment, none are not)
const norm = (x) => String(x).toLowerCase().replace(/[“”"'‘’「」『』]/g, '').replace(/\s+/g, ' ').trim();
const idx = (lists, v) => lists.findIndex((ws) => ws.some((w) => norm(v) === norm(w) || norm(v).includes(norm(w))));
const isLover = (v, V) => V.loverTie.some((w) => norm(v).includes(norm(w)));
const key2 = (a, b) => [a, b].sort().join('|');
const fillAll = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : m));
export const BREAK = /남$|^남\s|헤어|이별|전\s*연인|전\s*(남친|여친|애인)|절교|원수|적|\bex\b|ex-|stranger|broke|split|enem|rival/i;

// "<rel> … </rel>" -> lines. The quote is everything after the last "|", so quotes inside quotes survive.
export function parseRel(t) {
  const m = String(t || '').match(/<rel>([\s\S]*?)(<\/rel>|$)/i), out = { found: !!m, lines: [] };
  if (!m) return out;
  for (const raw of m[1].split(/\r?\n/)) {
    const l = raw.trim().replace(/^[-*•]\s*/, '');
    if (!l || /^none$/i.test(l)) continue;
    const seg = (l.includes('|') ? l.slice(l.lastIndexOf('|') + 1) : '').trim();
    const q = /^["“]/.test(seg) ? seg.replace(/^["“]/, '').replace(/["”]\s*$/, '') : '';
    let x;
    if ((x = l.match(/^(texture|결)\s*[:：]\s*([^=|>]+)>([^=|]+?)\s*=\s*([^|]+)/i))) out.lines.push({ k: 'tex', a: x[2], b: x[3], v: x[4].trim(), q, raw });
    else if ((x = l.match(/^(tie|사이)\s*[:：]\s*([^=|\-]+)-([^=|]+?)\s*=\s*([^|]+)/i))) out.lines.push({ k: 'tie', a: x[2], b: x[3], v: x[4].trim(), q, raw });
    else if ((x = l.match(/^(open|열림)\s*[:：]\s*(L\d+)/i))) out.lines.push({ k: 'open', id: x[2].toUpperCase(), q, raw });
    else { const p = l.split('|').map((s) => s.trim()), ab = p[0].split('>'); if (p.length >= 2 && ab.length === 2) out.lines.push({ k: 'mv', a: ab[0], b: ab[1], v: p[1], inner: (p[2] || '').replace(/^-$/, ''), q, raw }); else out.lines.push({ k: '?', raw }); }
  }
  return out;
}

// Checks every line against the text. Returns events (stored) and dropped lines (log only; hidden content never kept).
export function toRelEvents(answer, text, V, L, ctx) {
  const { names, day, bp = emptyBlueprint(), hidden = [] } = ctx, ev = [], dropped = [];
  // a name counts when the text has it, or when that person is already in the scene (a confession in dialogue
  // often never writes the speaker's name; in 1:1 roleplay the user's character is rarely named at all)
  const here = new Set((ctx.here || []).map((n) => String(n)));
  const who = (n) => { const b = bare(n), r = resolve(names, b, V) || b; return inText(b, text) || here.has(r) || here.has(b) ? r : null; };
  const lists = (k) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [L.en.rel[k][i], L.ko.rel[k][i]].filter(Boolean));
  // Only the part before the quote is checked: a quote that is really in the story text is not a leak.
  const leaks = (raw) => hidden.some((h) => { if (h.leakOk) return false; const c = norm(h.content), r = norm(raw.includes('|') ? raw.slice(0, raw.lastIndexOf('|')) : raw); for (let i = 0; i + 16 <= c.length; i += 4) if (r.includes(c.slice(i, i + 16))) return true; return false; });
  for (const l of parseRel(answer).lines) {
    const drop = (why) => dropped.push({ raw: leaks(l.raw) ? '(hidden content)' : l.raw, why });
    if (leaks(l.raw)) { drop('hidden-leak'); continue; }
    if (l.k === '?') { drop('form'); continue; }
    if (l.k === 'open') { const h = hidden.find((x) => x.L === l.id); if (h && quoteOk(l.q, text) && inText(h.who, text)) ev.push({ k: 'open', id: h.id, q: l.q.slice(0, 160), day }); else drop('open-needs-quote'); continue; }
    const a = who(l.a), b = who(l.b);
    if (!a || !b || a === b) { drop('name-not-in-text'); continue; }
    if (l.k === 'mv') {
      let mv = idx(lists('moves').slice(0, 6), l.v); if (mv < 0) mv = 5;
      if (mv !== 5 && !quoteOk(l.q, text)) { drop('quote-not-in-text'); continue; }
      ev.push({ k: 'mv', a, b, mv, inner: l.inner.slice(0, 60), q: l.q.slice(0, 160), day });
    } else if (l.k === 'tex') {
      let t = idx(lists('tex'), l.v);
      if (t < 0 || !quoteOk(l.q, text)) { drop(t < 0 ? 'word' : 'quote-not-in-text'); continue; }
      if (ROMANCE.includes(t) && bp.noromance.some((n) => resolve(names, n, V) === a || n === a)) { drop('romance-off'); continue; }
      if (t === 4 && !bp.barrier.some((x) => key2(x.a, x.b) === key2(a, b))) t = 0;        // "forbidden" needs a known barrier
      ev.push({ k: 'tex', a, b, t, q: l.q.slice(0, 160), day });
    } else if (l.k === 'tie') {
      if (!quoteOk(l.q, text)) { drop('tie-needs-quote'); continue; }
      // v0.5: a "colleagues / friends / family" line on a pair that was not lovers is a label, not an event
      // (it overwrote the lore sheet's tie 4/25 with the checklist). Love, engagement, breakup and enemies still count.
      const prev = ctx.prevTie?.(a, b) || bp.tie.find((x) => key2(x.a, x.b) === key2(a, b))?.v || '';
      if (!isLover(l.v, V) && !BREAK.test(l.v) && !isLover(prev, V)) { drop('tie-plain'); continue; }
      const at = text.toLowerCase().indexOf(l.q.toLowerCase().slice(0, 20)), before = at < 0 ? '' : text.slice(0, at);
      ev.push({ k: 'tie', a, b, v: l.v.slice(0, 40), q: l.q.slice(0, 160), day, user: before.lastIndexOf('<user>') > before.lastIndexOf('</user>') || before.lastIndexOf('<director>') > before.lastIndexOf('</director>') });   // 🎬: from the person or the hidden instruction
    }
  }
  return { ev, dropped };
}

export const newState2 = () => ({ dir: {}, tie: {}, open: {}, read: 0 });
// rel: { fingerprint: [events] }. Walked in chat order like stage 1, so rerolls and deletions fix themselves.
export function fold2(chat, rel, fingerprint) {
  const st = newState2();
  try {
    for (const m of chat) {
      const g = skipMsg(m) ? null : rel[fingerprint(m)];
      if (!g) continue;
      st.read++;
      const clash = g.some((e) => e.k === 'mv' && e.mv === 4);
      for (const e of g) {
        if (e.k === 'tie') { st.tie[key2(e.a, e.b)] = { v: e.v, q: e.q, day: e.day, user: !!e.user }; for (const k of [`${e.a}>${e.b}`, `${e.b}>${e.a}`]) if (st.dir[k]) { st.dir[k].inner = ''; st.dir[k].innerDay = null; } }   // the tie changed: nothing is "held back" any more
        if (e.k === 'open') st.open[e.id] ||= { q: e.q, day: e.day };
        if (e.k !== 'mv' && e.k !== 'tex' && e.k !== 'feel') continue;
        const d = (st.dir[`${e.a}>${e.b}`] ||= { a: e.a, b: e.b, moves: [], inner: '', innerDay: null, tex: null, cand: null, candAt: 0, clashDay: null, q: '' });
        if (e.k === 'feel') { d.feel = (e.v || []).slice(0, 4); continue; }   // the person's own words for this feeling (shown and sent as they are)
        if (e.k === 'mv') {
          d.moves.push(e.mv); if (d.moves.length > 3) d.moves.shift();
          if (e.mv === 4) { d.clashDay = e.day; d.inner = ''; d.innerDay = null; }          // it came out: no longer held back
          else if (e.mv !== 5 && e.inner) { if (!d.inner) d.innerDay = e.day; d.inner = e.inner; d.q = e.q; }
        } else if (d.tex !== e.t) {
          if ((d.cand === e.t && d.candAt === st.read - 1) || clash || e.by === 'user') { d.tex = e.t; d.cand = null; } else { d.cand = e.t; d.candAt = st.read; }   // two readings in a row
        }
      }
    }
  } catch (e) { return { ...newState2(), error: String(e) }; }
  return st;
}
export function trend(d) {
  const m = d.moves.filter((x) => x !== 5), c = m.filter((x) => x === 0).length, b = m.filter((x) => x === 1).length;
  return !m.length ? '' : c >= 2 ? 'closer' : b >= 2 ? 'back' : m.length >= 2 ? 'waver' : '';
}
// Official tie shown to the main model: blueprint first, then an event with a quote. A "lovers" word without such an event is not shown.
export function tieOf(p, st2, bp, V) {
  const k = key2(p.a, p.b), ev = st2.tie[k], b = bp.tie.find((x) => key2(x.a, x.b) === k);
  if (ev) return ev.v;
  if (b) return b.v;
  return p.tie && isLover(p.tie, V) ? '' : p.tie;
}

// Everything that opens on a quoted event goes through the same hidden-layer list (the classifier answers "open: L#"):
// locked layers (깊은속), v0.9 a vault's 열림 and a line's 풀림. Line releases are not secret (leakOk).
export const hideId = (x) => x.hid || `hide:${x.a}-${x.b}>${x.c}`;   // hid: the id under the sheet's own names (store.js bpStory)
export function gates(bp) {
  const out = [...(bp.deep || [])];
  for (const x of bp.vault || []) if (x.opens) out.push({ id: `vault:${x.who}`, who: x.who.split('-')[0].trim(), to: x.who.split('-')[1]?.trim() || '', content: x.v, opens: x.opens });
  (bp.line || []).forEach((x, i) => { if (x.release) out.push({ id: `line:${x.who}:${i}`, who: x.who, to: '', content: `${x.who} lets this pass: ${x.v}`, opens: x.release, leakOk: true }); });
  for (const x of bp.fall || []) if (x.opens) out.push({ id: `fall:${x.a}>${x.b}`, who: x.a, to: x.b, content: `${x.a} falls for ${x.b}`, opens: x.opens, leakOk: true });
  // 숨김 A-B → C: ends when the story shows C knows about the two (then the "act as your surface relationship" line stops)
  for (const x of bp.hide || []) out.push({ id: hideId(x), who: x.a, to: x.b, content: `${x.c} must not find out what ${x.a} and ${x.b} are`, opens: `${x.c} finds out about ${x.a} and ${x.b}`, leakOk: true });
  return out;
}
// Blocks for the classifier prompt. Hidden layers get L1, L2… per call; the numbers are never stored.
export function relInputs(st2, bp, text, L) {
  const R = L.rel, base = Object.values(st2.dir).filter((d) => inText(d.a, text) && inText(d.b, text)).slice(-6)
    .map((d) => `${d.a}>${d.b}: ${[d.feel?.length ? d.feel.join(', ') : d.tex != null && R.tex[d.tex], d.inner && `${R.inner}: ${d.inner}`, trend(d) && `${R.trendWord} ${R.trend[trend(d)]}`].filter(Boolean).join(' · ') || '-'}`);
  const hidden = gates(bp).filter((h) => !st2.open[h.id] && inText(h.who, text)).slice(0, 6).map((h, i) => ({ ...h, L: `L${i + 1}` }));
  for (const x of bp.unknown || []) if (inText(x.who, text)) base.push(`${x.who}: ${x.v} — ${R.unknownBase || 'unknown — do not infer'}`);
  return { baseline: base.join('\n') || '-', hidden, hiddenText: hidden.map((h) => `${h.L} | ${h.who}${h.to ? `>${h.to}` : ''} | ${h.content} | ${h.opens}`).join('\n') || '-' };
}

// Extra signpost rows (v0.6). Deep: barriers and opened layers. Now: this reply's lines and leak level — what the
// person used to write as OOC every turn. Each line stands on something recorded with a quote or on the lore sheet:
//   tie     the official relationship of a pair with a romantic pull, and what it takes to change it
//   leak    a romantic pull: it shows only in acts and tone, about once a scene; no confession yet
//   burst   a feeling held back for a long time: if the sore spot is touched, the surface may crack (ugly is fine)
//   hide    someone who must not find out is here: the pair keeps to the surface relationship
// Rhythm (v0.6): the same line is not repeated reply after reply. A situation line comes when the situation starts
// (the pair comes together, someone joins or leaves, a new scene) and then every `every` replies while it lasts.
// The hide line is the exception: it is in every reply while the person is present.
export function runLength(hist, test) {
  let k = 0;
  for (let i = (hist || []).length - 1; i >= 0; i--) { const h = hist[i]; if (!test(h.with)) break; k++; if (h.cut) break; }
  return k;
}
export const onBeat = (k, every = 3) => k <= 1 || (k - 1) % every === 0;
// cue = the person's message just sent (if any). When it touches the sore spot, the burst permission comes now.
// English function words never count as a match ("her" in a refusal must not match "I found her")
const STOP_EN = new Set(('the a an and or but of to in on at by for from with without into onto over under about after before than then that this these those there here ' +
  'is are was were be been being am do does did done have has had having will would can could should may might must shall not no yes ' +
  'he she it they them him her his hers its their theirs we us our you your yours me my mine i what which who whom whose when where why how ' +
  'all any some each every one ones more most much many very just only also even still too so as if up down out off again back new own same other such ' +
  'let lets get gets got make makes made take takes took give gives gave go goes went come comes came say says said tell tells told ask asks asked').split(' '));
export const words = (t) => String(t || '').toLowerCase().replace(/[「」『』"“”'‘’.,!?…()\[\]:;—–-]/g, ' ').split(/\s+/).map((w) => w.replace(/(이라는|라는|이란|이|가|은|는|을|를|의|에|도|만|말)$/, ''))
  .filter((w) => w.length >= 2 && !(/^[a-z0-9']+$/.test(w) && (w.length < 3 || STOP_EN.has(w))));
// a Latin word matches at a word start (file → files, filed); Korean matches inside (조사 붙음)
const hit = (c, w) => (/^[a-z0-9']+$/.test(w) ? new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(c) : c.includes(w));
export function touches(sore, cue) { const c = String(cue || '').toLowerCase(); return !!c && words(sore).some((w) => hit(c, w)); }
export function rows2(st1, st2, bp, L, lg, budget = 260, heldDays = 7, burst = true, V = { loverTie: [] }, restDays = 3, every = 3, cue = '') {
  const R = L.rel, here = st1.with, today = st1.cal.n, deep = [], now = [];
  const both = (a, b) => here.includes(a) && here.includes(b);
  for (const x of bp.barrier) if (both(x.a, x.b)) deep.push({ layer: 'deep', text: `- ${x.a}–${x.b}: ${R.barrier.replace('{v}', x.v)}`, src: 'blueprint' });
  for (const d of bp.deep) if (st2.open[d.id] && here.includes(d.who)) deep.push({ layer: 'deep', text: `- ${d.who}${d.to ? ` → ${d.to}` : ''}: ${d.content}`, src: st2.open[d.id].q });
  // hide first: the most costly line to miss
  for (const x of bp.hide) if (here.includes(x.c) && both(x.a, x.b)) now.push({ layer: 'now', kind: 'hide', text: `- ${fillAll(R.ordHide, { c: x.c, a: x.a, b: x.b })}`, src: 'blueprint' });
  // v0.7: what one keeps from the other (every reply while both are here), and what nobody knows yet (every reply
  // while the person is here). Both are cheap and the most costly to miss.
  for (const x of bp.keep || []) if (both(x.a, x.b)) now.push({ layer: 'now', kind: 'keep', text: `- ${fillAll(R.ordKeep, { a: x.a, b: x.b, v: x.v })}`, src: 'blueprint' });
  for (const x of bp.unknown || []) if (here.includes(x.who)) now.push({ layer: 'now', kind: 'unknown', text: `- ${fillAll(R.ordUnknown, { who: x.who, v: x.v })}`, src: 'blueprint' });
  // Situation sets the leak level (no AI call): the two alone · others watching · someone it is hidden from is here.
  const hiddenFrom = (a, b, w = here) => bp.hide.some((x) => key2(x.a, x.b) === key2(a, b) && w.includes(x.c));
  const watched = (a, b, w = here) => w.some((n) => n !== a && n !== b);
  const sit = (a, b, w) => (hiddenFrom(a, b, w) ? 'h' : watched(a, b, w) ? 'w' : 'a');
  // how many replies in a row the two have been together in the same situation (alone / watched / hidden-from)
  const beat = (a, b) => { const now = sit(a, b, here); return onBeat(runLength(st1.hist, (w) => w.includes(a) && w.includes(b) && sit(a, b, w) === now), every); };
  const rested = (a, b) => [st2.dir[`${a}>${b}`], st2.dir[`${b}>${a}`]].some((d) => d?.clashDay != null && today - d.clashDay < restDays);
  // burst: held back longest, both here. Permission only when they are alone and not right after a clash;
  // with others watching it is held tighter; with someone it is hidden from, only the surface.
  // a couple (official tie = lovers) has said it: what the relationship reading notes between them is no longer "held back"
  const said = (a, b) => isLover(st2.tie[key2(a, b)]?.v || '', V) || bp.tie.some((x) => key2(x.a, x.b) === key2(a, b) && isLover(x.v, V) && !st2.tie[key2(a, b)]);
  // held back = a recorded FEELING (끌림 · 욕망 · 미련 · 애증 · 금지된 끌림 · 원망), not any note between two people
  // (a bully's teasing is not a feeling held back)
  const feels = (d) => (d.tex != null && d.tex <= 5) || !!d.feel?.length;
  const held = Object.values(st2.dir).filter((d) => d.inner && feels(d) && both(d.a, d.b) && !said(d.a, d.b) && (d.innerDay == null || today - d.innerDay >= heldDays)).sort((x, y) => (x.innerDay ?? 0) - (y.innerDay ?? 0))[0];
  const bpHeld = !held && bp.inner.find((x) => both(x.a, x.b) && !said(x.a, x.b) && !st2.dir[`${x.a}>${x.b}`]?.clashDay);
  const h = held || (bpHeld && { a: bpHeld.a, b: bpHeld.b, inner: bpHeld.v });
  const hSore = h && bp.sore.find((x) => x.a === h.a && x.b === h.b);
  // v0.7: what is held back goes to the background layer (know it, don't copy it); the shallow line carries only the
  // order, with no sentence the story could paraphrase (the inner line used to come back as inner monologue).
  const leaking = new Set();
  const onB = h && beat(h.a, h.b), cued = h && hSore && touches(hSore.v, cue);
  // v0.30 quiet beats. A model handed "it may show" does it in every reply, and one that sees the held-back line or the
  // sore spot in every note keeps pointing at them (a covered mark, a thought that circles). So the held-back line goes
  // to the background only on the beat (or when the person's message touches the sore spot), the sore spot is named only
  // when the person touched it, and the replies in between get one line that keeps it off the page.
  if (h && (onB || cued)) deep.push({ layer: 'deep', text: `- ${fillAll(R.innerDeep || '{a} → {b}: {inner}', { a: h.a, b: h.b, inner: h.inner })}`, src: h.q || 'blueprint' });
  let quietFor = h && !(onB || cued) ? [h.a, h.b] : null;
  if (h && (onB || cued)) {
    const sore = cued ? hSore : null;
    const t = hiddenFrom(h.a, h.b) ? R.ordHeld : watched(h.a, h.b) ? R.ordHeldWatched : burst && !rested(h.a, h.b) ? (sore ? R.ordBurstSore.split('{sore}').join(sore.v) : R.ordBurst) : R.ordHeld;
    now.push({ layer: 'now', kind: cued && !onB ? 'burstNow' : t === R.ordHeld || t === R.ordHeldWatched ? 'held' : 'burst', text: `- ${fillAll(t, { a: h.a, b: h.b, inner: h.inner })}`, src: h.q || 'blueprint' });
    leaking.add(h.a); leaking.add(h.b);
  }
  // romantic pull (recorded texture, or the lore sheet's), both here: tie line once per pair + leak line per direction
  const texOf = (a, b) => { const d = st2.dir[`${a}>${b}`]; if (d?.tex != null) return d.tex; const t = bp.texture.find((x) => x.a === a && x.b === b); return t ? t.v : null; };
  const name = (t) => (typeof t === 'number' ? R.tex[t] : t);
  const romantic = (t) => (typeof t === 'number' ? ROMANCE.includes(t) : idx(ROMANCE.map((i) => [R.tex[i]]), t) >= 0);
  const off = (n) => (bp.noromance || []).some((x) => (x.name || x) === n);
  const seen = new Set();
  for (let i = 0; i < here.length; i++) for (let j = 0; j < here.length; j++) {
    if (i === j) continue;
    const a = here[i], b = here[j], t = texOf(a, b);
    if (t == null || !romantic(t) || off(a) || (h && h.a === a && h.b === b)) continue;
    const k = key2(a, b);
    if (!beat(a, b)) { quietFor ||= [a, b]; continue; }
    if (!seen.has(k)) {
      seen.add(k);
      const tie = tieOf({ a, b, tie: st1.pair?.[k]?.tie || '' }, st2, bp, V);
      if (tie) now.push({ layer: 'now', kind: 'tie', text: `- ${fillAll(R.ordTie, { a, b, v: tie })}`, src: st2.tie[k]?.q || 'blueprint' });
    }
    const tpl = hiddenFrom(a, b) || watched(a, b) ? R.ordLeakWatched : R.ordLeak;
    now.push({ layer: 'now', kind: 'leak', text: `- ${fillAll(tpl, { a, b, tex: st2.dir[`${a}>${b}`]?.feel?.length ? st2.dir[`${a}>${b}`].feel.join(', ') : name(t) })}`, src: st2.dir[`${a}>${b}`]?.q || 'blueprint' });
    leaking.add(a); leaking.add(b);
  }
  if (quietFor && R.ordQuiet && !(leaking.has(quietFor[0]) && leaking.has(quietFor[1]))) now.push({ layer: 'now', kind: 'quiet', text: `- ${fillAll(R.ordQuiet, { a: quietFor[0], b: quietFor[1] })}`, src: 'blueprint' });
  // where each person's feeling leaks (lore sheet), only when a held or leak line came this reply
  const ch = (bp.channel || []).filter((x) => leaking.has(x.who));
  if (ch.length && R.ordChannel) now.push({ layer: 'now', kind: 'channel', text: `- ${R.ordChannel.replace('{list}', ch.map((x) => `${x.who}: ${x.v}`).join('; '))}`, src: 'blueprint' });
  const cut = (rows) => rows.filter((r, i, all) => all.findIndex((x) => x.text === r.text) === i);
  let d2 = cut(deep), n2 = cut(now).slice(0, 7);
  // over budget: drop leak/tie lines first (they come last), keep hide · burst · opened layers longest
  while (d2.length + n2.length && estTokens([...d2, ...n2].map((r) => r.text).join('\n'), lg) > budget) (n2.length > 2 ? n2 : d2.length ? d2 : n2).pop();
  return { deep: d2, now: n2 };
}
