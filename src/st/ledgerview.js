// The log: what changed at each reply, and the evidence for it. Built only when opened.
import { ctx, store, save, ledger, R } from './store.js';
import { dateAt, fmtDate, span } from '../core/time.js';
import { cleanText, fingerprint } from '../core/clean.js';
import { findEvidence, TIME_MARKS } from '../core/evidence.js';
import { uiLang, renderBar } from './bar.js';
import { refresh } from './inject.js';
import { fold2, tieOf, trend } from '../core/ledger2.js';
import { trWatch } from './tr.js';
import { settings, ledger2 } from './store.js';
import { absorb, absorbRel } from '../core/bundle.js';
import { Q, kick } from './queue.js';

// ── Fixing the record by hand (v0.6) ─────────────────────────────────────────
// clear  = this reply's record becomes empty (it is not read again)
// redo   = this reply's record is removed, so the classifier reads it again on its next run
// edit   = the classifier's answer for this reply is shown as text; the person changes it and it is read back in,
//          through the same checks (quotes must be in the reply)
export function clearReplies(fps, redo = false) {
  const S = store(true);
  for (const fp of fps) {
    if (redo) { delete S.ev[fp]; delete S.rel[fp]; delete S.raw[fp]; } else { S.ev[fp] = []; S.rel[fp] = []; if (S.raw[fp]) S.raw[fp].a = ''; }
    if (S.edited) delete S.edited[fp];
  }
  save(); refresh(); renderBar();
  if (redo) { Q.pushedKey = ''; kick(500); }
}
// Everything this chat recorded, except the lore sheet, the director's note and the chat shape.
export function clearAll() {
  const S = store(true);
  Object.assign(S, { ev: {}, pre: [], rel: {}, raw: {}, dir: {}, edited: {} });
  save(); refresh(); renderBar(); Q.pushedKey = ''; kick(500);
}
async function editReply(i) {
  const c = ctx(), U = R.ui, m = c.chat?.[i], S = store(true);
  if (!m || !S) return false;
  const fp = fingerprint(m), old = S.raw?.[fp]?.a || '<mb>\nnone\n</mb>\n<rel>none</rel>';
  const v = await c.callGenericPopup(`<b>${h(U.editTitle)} #${i}</b><div class="mb3-dim">${h(U.editHelp)}</div>`, c.POPUP_TYPE.INPUT, old, { rows: 14, wide: true });
  if (v === null || v === undefined || v === false || String(v) === old) return false;
  const prev = [...c.chat.slice(0, i)].reverse().find((x) => x.is_user);
  const b = { text: [prev ? `<user>${cleanText(prev.mes)}</user>` : '', cleanText(m.mes)].filter(Boolean).join('\n\n'), fps: [fp] };
  const st = ledger(), r = absorb(S.ev, b, String(v), st, R.V);
  if (r.pushed) { window.toastr?.warning(U.editBroken); return false; }
  absorbRel(S.rel, b, String(v), st, R.bp, R.V, R.lang, [], ledger2());
  S.raw[fp] = { ...(S.raw[fp] || {}), a: String(v).slice(0, 1500), t: Date.now() };
  (S.edited ||= {})[fp] = Date.now();
  save(); refresh(); renderBar();
  return true;
}

// Stage-2 lines for one reply: what moved between whom, with the quote. Locked layers appear only once opened.
const OWN = /(?:내|제)\s?(?:사람|여자|남자)(?:이?(?:야|잖아|예요|에요|라고|다|니까)|입니다)|(?:넌|너는|너도|당신은|당신도)\s?(?:이제\s?)?(?:내|제)\s?(?:거|꺼|것)|you(?:'re| are) mine|belongs? to me|i don'?t share|my (?:girl|woman|man)\b/i;
function relItems(x, text, U2, L) {
  const c = ctx(), m = c.chat?.[x.i], S = store(), g = m && S?.rel?.[fingerprint(m)];
  if (!g || !g.length) return [];
  const out = [], R2 = L.rel;
  for (const e of g) {
    if (e.k === 'mv' && (e.mv !== 5 || e.inner)) out.push({ icon: e.mv === 4 ? '💥' : '💞', title: `${e.a} → ${e.b} · ${R2.moves[e.mv]}${e.inner ? ` · ${R2.inner}: ${e.inner}` : ''}`, ev: e.q ? [['text', e.q]] : [] });
    else if (e.k === 'tex') out.push({ icon: '🎨', title: fill(U2.logTex, { a: e.a, b: e.b, t: R2.tex[e.t] }), ev: e.q ? [['text', e.q], ['rule', U2.whyTex]] : [] });
    else if (e.k === 'tie') out.push({ icon: '🤝', title: `${e.a} – ${e.b}: ${e.v}`, ev: [[e.user ? 'dir' : 'text', e.q]] });
    else if (e.k === 'open') { const d = R.bp.deep.find((y) => y.id === e.id); if (d) out.push({ icon: '🔓', title: fill(U2.logOpen, { w: d.who, v: d.content }), ev: [['text', e.q]] }); }
  }
  // Possessive words while the official tie is not a romantic one: shown to the person only, never sent to the model.
  const own = text.match(OWN);
  if (own) {
    const st2 = fold2((c.chat || []).slice(0, x.i + 1), S.rel || {}, fingerprint), seen = new Set();
    for (const e of g.filter((y) => y.k === 'mv' && (y.mv === 0 || y.mv === 4))) {
      const k = [e.a, e.b].sort().join('|'); if (seen.has(k)) continue; seen.add(k);
      const t = tieOf({ a: e.a, b: e.b, tie: '' }, st2, R.bp, R.V);
      if (!R.V.loverTie.some((w) => String(t).toLowerCase().includes(String(w).toLowerCase()))) out.push({ icon: '⚠️', title: fill(U2.logEarly, { a: e.a, b: e.b, t: t || U2.noTie }), ev: [['text', own[0].trim()], ['rule', U2.whyEarly]] });
    }
  }
  return out;
}

const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fill = (t, o) => String(t).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
const PAGE = 30;
const dirText = (d) => String(d.src || d.v).split(/<[a-z_]+>/i)[0].trim().slice(0, 200);

// One logged reply -> list of { icon, title, ev: [[kind, text]] }  kind: text | dir | user | rule
function items(x, text, st, U, L) {
  const S = L.sp, out = [], rule = (k, o) => ['rule', fill(U.why[k] || k, o)];
  const quote = (v, extra, who) => { const q = findEvidence(text, v, extra, who); return q ? [['text', q]] : []; };
  const dir = x.g.find((e) => e.k === 'dir'), userTime = x.g.find((e) => e.k === 'time' && e.by === 'user');
  if (x.passed > 0) {
    const ev = [];
    const timeLine = x.g.find((e) => e.k === 'time' && !e.by), dateLine = x.dates.find((d) => !d.force);
    ev.push(...quote(`${timeLine?.tod || ''} ${dateLine ? L.mon[(dateLine.text.m || 1) - 1] : ''}`, [...TIME_MARKS, ...(dateLine ? R.V.months[(dateLine.text.m || 1) - 1] : [])]));
    if (dir) ev.push(['dir', dirText(dir)]);
    if (userTime) ev.push(['user', U.why.userSkip]);
    if (dateLine?.r === 'jump' && dateLine.text.d == null) ev.push(rule('monthOnly', {}));
    const fz = x.fuzzy ? L.span.fuzzy[x.fuzzy] || L.span.fuzzy.d : '';
    if (fz) ev.push(rule('fuzzy', { s: fz }));
    out.push({ icon: '⏩', title: fill(U.passedLine, { s: fz || span(x.passed, L), a: fmtDate(x.was || {}, L, false) || '?', b: fmtDate(dateAt(st.cal, x.n), L, false) || '?' }), ev });
  }
  for (const d of x.dates) {
    if (d.force) out.push({ icon: '✋', title: fill(U.dateSet, { d: fmtDate(d.after, L) }), ev: [['user', U.why.userDate]] });
    else if (d.r === 'set' || d.r === 'calibrated') out.push({ icon: '📅', title: fill(U.dateSet, { d: fmtDate(d.after, L) }), ev: [...quote(L.mon[(d.text.m || 1) - 1], R.V.months[(d.text.m || 1) - 1].concat(d.text.d ? [String(d.text.d)] : [])), rule(d.r === 'set' ? 'firstDate' : d.before?.m == null && d.after?.m != null ? 'settled' : 'calibrated', {})] });
    else if (d.r === 'kept') out.push({ icon: '⚠️', title: fill(U.dateKept, { d: fmtDate(d.before, L, false) }), ev: [...quote(L.mon[(d.text.m || 1) - 1], R.V.months[(d.text.m || 1) - 1]), rule('older', { t: fmtDate(d.text, L, false) || '?' })] });
  }
  if (dir && dir.days > 0 && x.passed <= 0 && !userTime && !x.dates.length) out.push({ icon: '💡', title: U.hintCheck, ev: [['dir', dirText(dir)], rule('noMark', {})], apply: dir });
  else if (dir && x.passed <= 0 && dirText(dir)) out.push({ icon: '🎬', title: U.lg.dir, ev: [['dir', dirText(dir)]], dim: true });
  for (const e of x.g) {
    if (e.k === 'loc') out.push({ icon: '📍', title: e.v, ev: quote(e.v) });
    else if (e.k === 'with') {
      const t = [...e.add.map((n) => `+${n}`), ...e.del.map((n) => `−${n}`)].join(' ');
      if (t) out.push({ icon: '👥', title: e.full ? e.add.join(', ') : t, ev: quote(e.add.join(' ')) });
    } else if (e.k === 'wear') out.push({ icon: '👕', title: `${e.who}: ${e.v}`, ev: quote(e.v, [], [e.who]) });
    else if (e.k === 'body') out.push({ icon: '🩹', title: `${e.who}: ${e.healed ? U.healed : e.v}`, ev: quote(e.v, [], [e.who]) });
    else if (e.k === 'gone') out.push({ icon: '🕯', title: `${e.who}: ${S[e.v]}`, ev: [['text', e.q]] });
    else if (e.k === 'promise') out.push({ icon: '🤝', title: `${e.a} → ${e.b}: ${e.v}`, ev: quote(e.v, [], [e.a, e.b]) });
    else if (e.k === 'know') out.push({ icon: '👁', title: `${e.who} ${U.knows}: ${e.v}`, ev: quote(e.v, [], [e.who]) });
    else if (e.k === 'call') out.push({ icon: '💬', title: `${e.a} → ${e.b}: ${e.v}`, ev: quote(e.v.split(/[,，]/)[0]) });
    else if (e.k === 'touch' && e.v > 0) out.push({ icon: '🤲', title: `${e.a}–${e.b}: ${L.touch?.[e.v] ?? e.v}`, ev: [] });
    else if (e.k === 'tie') out.push({ icon: '🔗', title: `${e.a}–${e.b}: ${e.v}`, ev: quote(e.v, [], [e.a, e.b]) });
    else if (e.k === 'weather' || e.k === 'mood') out.push({ icon: e.k === 'weather' ? '🌦' : '🎭', title: e.v, ev: quote(e.v) });
    else if (e.k === 'pos') out.push({ icon: '🧍', title: `${e.who}: ${e.v}`, ev: quote(e.v, [], [e.who]) });
    else if (e.k === 'near') out.push({ icon: '🗺', title: `${e.a} — ${e.rel}: ${e.b}`, ev: [['text', e.q]] });
    else if (e.k === 'item') out.push({ icon: '🎒', title: `${e.who}: ${e.sign}${e.v}`, ev: quote(e.v, [], [e.who]) });
    else if (e.k === 'mark') out.push({ icon: '✳', title: `${e.who}: ${e.v}`, ev: quote(e.v, [], [e.who]) });
    else if (e.k === 'slip') out.push({ icon: '⚠️', title: fill(U.slipLine, { n: e.who, w: e.v }), ev: [['text', e.q], rule('slip', {})] });
    else if (e.k === 'drop') out.push({ icon: '🗑', title: e.raw, ev: [rule(`drop_${e.why}`, {})], dim: true });
  }
  for (const n of x.fixes || []) out.push({ icon: '⚠️', title: fill(U.deadFix, { n }), ev: [rule('deadStay', {})] });
  return out;
}

const KIND = { text: '📜', dir: '🎬', user: '✋', rule: '⚙️' };
const roomOf = (loc) => String(loc || '').split(/\s*(?:>|→|›)\s*/).filter(Boolean).at(-1) || '';
const HOT = new Set(['💥', '🤝', '🔓', '⚠️']);

// Every logged reply as one entry: what changed (stage 1 + stage 2), the classifier's note, and whether it opens a new chapter.
function entries(st, U, L) {
  const c = ctx(), S = store(), out = [];
  let prevRoom = '';
  for (const x of st.log) {
    const m = c.chat?.[x.i], fp = m ? fingerprint(m) : '', text = cleanText(m?.mes || '');
    let its = [];
    try { its = items(x, text, st, U, L); } catch (e) { its = []; }
    try { its.push(...relItems(x, text, R.ui2, L)); } catch (e) { /* stage 2 lines are optional */ }
    const room = roomOf(x.loc), cut = x.g.some((e) => e.k === 'cut');
    const fresh = !out.length || cut || x.passed > 0 || x.dates.some((d) => d.r === 'jump' || d.force) || (room && prevRoom && room !== prevRoom);
    prevRoom = room || prevRoom;
    out.push({ x, its, fp, raw: S?.raw?.[fp], fresh, hot: its.some((it) => HOT.has(it.icon)) });
  }
  return out;
}
function chapters(es, st, L) {
  const ch = [];
  for (const e of es) {
    if (e.fresh || !ch.length) ch.push({ es: [], n: e.x.n, tod: e.x.tod, loc: e.x.loc, who: new Set(), hot: false });
    const c = ch.at(-1); c.es.push(e); e.x.with.forEach((n) => c.who.add(n)); c.hot ||= e.hot;
  }
  for (const c of ch) {
    const big = c.es.flatMap((e) => e.its).find((it) => HOT.has(it.icon) && it.icon !== '⚠️');
    c.title = big ? `${big.icon} ${big.title}` : roomOf(c.loc) || fmtDate(dateAt(st.cal, c.n), L, false) || '—';
    const count = {}; for (const it of c.es.flatMap((e) => e.its)) count[it.icon] = (count[it.icon] || 0) + 1;
    c.chips = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 6);
    c.size = c.es.reduce((a, e) => a + e.its.length, 0);
  }
  return ch;
}

function itemHtml(it, i) {
  return `<li class="${it.dim ? 'mb3-dim' : ''}"><div>${it.icon} ${h(it.title)}${it.apply ? ` <button class="menu_button mb3-apply" data-i="${i}" data-days="${it.apply.days}" data-fuzzy="${h(it.apply.fuzzy || '')}">${h(R.ui.apply)}</button>` : ''}</div>${it.ev.map(([k, t]) => `<div class="mb3-ev mb3-${k}">${KIND[k]} ${k === 'text' ? `“${h(t)}”` : h(t)}</div>`).join('')}</li>`;
}
function reasonHtml(e) {
  const U2 = R.ui2;
  if (!e.raw) return `<div class="mb3-raw mb3-dim">${h(U2.reasonNone)}</div>`;
  const drops = (e.raw.d || []).map(([why, raw]) => `<div>🗑 ${h(raw)} <span class="mb3-dim">— ${h(R.ui.why[`drop_${why}`] || why)}</span></div>`).join('');
  return `<div class="mb3-raw"><div class="mb3-dim">${h(U2.reasonNote)}</div><pre>${h(e.raw.a)}</pre>${drops ? `<div class="mb3-dim">${h(U2.reasonDropped)}</div>${drops}` : `<div class="mb3-dim">${h(U2.reasonAllKept)}</div>`}</div>`;
}
function entryHtml(e, st, L, open) {
  const x = e.x, U = R.ui, U2 = R.ui2;
  const head = [fmtDate(dateAt(st.cal, x.n), L, false), x.tod, roomOf(x.loc)].filter(Boolean).join(' · ');
  const list = e.its.map((it) => itemHtml(it, x.i)).join('') || `<li class="mb3-dim">${h(U.noChange)}</li>`;
  const edited = store()?.edited?.[e.fp] ? ` <span class="mb3-dim">✏️ ${h(U.edited)}</span>` : '';
  return `<div class="mb3-entry${e.hot ? ' mb3-hot' : ''}"><div class="mb3-head"><input type="checkbox" class="mb3-pickfp" data-fp="${h(e.fp)}" title="${h(U.pickTip)}"> <a href="#" class="mb3-go" data-i="${x.i}">#${x.i}</a> <span class="mb3-dim">${h(head)}</span>${edited}
    <a href="#" class="mb3-why" data-fp="${h(e.fp)}">🧠 ${h(U2.reason)}</a>
    <span class="mb3-acts"><a href="#" class="mb3-edit" data-i="${x.i}" title="${h(U.editTip)}">✏️ ${h(U.edit)}</a> <a href="#" class="mb3-redo" data-fp="${h(e.fp)}" title="${h(U.redoTip)}">🔁 ${h(U.redo)}</a> <a href="#" class="mb3-del" data-fp="${h(e.fp)}" title="${h(U.delTip)}">🗑 ${h(U.del)}</a></span></div><ul>${list}</ul>${open.has(e.fp) ? reasonHtml(e) : ''}</div>`;
}

// Big flow: day bars (height = how much changed, red = a big event) and chapter cards.
function flowHtml(st, L, chs, ui) {
  const days = new Map();
  for (const c of chs) { const d = days.get(c.n) || { n: c.n, size: 0, hot: false, first: chs.indexOf(c) }; d.size += c.size; d.hot ||= c.hot; days.set(c.n, d); }
  const ds = [...days.values()].slice(-40), max = Math.max(1, ...ds.map((d) => d.size));
  const bars = ds.map((d) => `<div class="mb3-bar${d.hot ? ' mb3-hotbar' : ''}${chs[ui.chap]?.n === d.n ? ' mb3-onbar' : ''}" data-chap="${d.first}" title="${h(fmtDate(dateAt(st.cal, d.n), L, false))}"><i style="height:${Math.round(6 + 44 * d.size / max)}px"></i><span>${h(fmtDate(dateAt(st.cal, d.n), L, false).replace(/^[^,]*,\s*/, '') || `D${d.n + 1}`)}</span></div>`).join('');
  const cards = chs.map((c, k) => k === ui.chap || ui.view === 'date' || chs.length - k <= ui.shown ? chapterHtml(c, k, st, L, ui) : '').filter(Boolean);
  return `<div class="mb3-bars">${bars}</div>${ui.view === 'date' ? dayGroups(chs, st, L, ui) : cards.reverse().join('')}`;
}
function chapterHtml(c, k, st, L, ui) {
  const date = [fmtDate(dateAt(st.cal, c.n), L, false), c.tod].filter(Boolean).join(' ');
  const first = c.es[0].x.i, last = c.es.at(-1).x.i;
  return `<div class="mb3-chap${c.hot ? ' mb3-hot' : ''}${k === ui.chap ? ' mb3-open' : ''}" data-chap="${k}">
    <div class="mb3-chead"><b>${h(c.title)}</b> <span class="mb3-dim">${h(date)} · ${h(roomOf(c.loc))} · ${h([...c.who].slice(0, 5).join(', '))}</span><span class="mb3-dim mb3-range">#${first}${last !== first ? `–${last}` : ''}</span></div>
    <div>${c.chips.map(([ic, n]) => `<span class="mb3-chip">${ic}${n > 1 ? ` ${n}` : ''}</span>`).join('')}</div>
    ${k === ui.chap ? `<div class="mb3-cbody">${c.es.map((e) => entryHtml(e, st, L, ui.open)).join('')}</div>` : ''}</div>`;
}
function dayGroups(chs, st, L, ui) {
  const out = []; let cur = null;
  chs.forEach((c, k) => { if (!cur || cur.n !== c.n) { cur = { n: c.n, items: [] }; out.push(cur); } cur.items.push(chapterHtml(c, k, st, L, ui)); });
  return out.reverse().slice(0, ui.shown).map((d) => `<h4 class="mb3-day">📅 ${h(fmtDate(dateAt(st.cal, d.n), L) || fill(R.ui.dayN, { n: d.n + 1 }))}</h4>${d.items.join('')}`).join('');
}

// Relationship map: people on a circle, a line per pair (official tie on it, colour = texture), barriers dashed.
const TEXC = ['#D4537E', '#D85A30', '#7F77DD', '#993556', '#E24B4A', '#5F5E5A', '#1D9E75', '#888780'];
function relHtml(st, L, ui) {
  const st2 = ledger2(), bp = R.bp, k2 = (a, b) => [a, b].sort().join('|'), pairs = new Map();
  const add = (a, b) => { if (a && b && a !== b) pairs.set(k2(a, b), [a, b].sort()); };
  Object.values(st.pair || {}).forEach((p) => add(p.a, p.b)); Object.values(st2.dir).forEach((d) => add(d.a, d.b));
  [...bp.tie, ...bp.barrier].forEach((x) => add(x.a, x.b));
  const score = {}; for (const [a, b] of pairs.values()) { score[a] = (score[a] || 0) + 1; score[b] = (score[b] || 0) + 1; }
  const people = Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, 9);
  if (!people.length) return `<p class="mb3-dim">${h(R.ui2.relNone)}</p>`;
  const W = 640, H = 340, cx = W / 2, cy = H / 2, r = people.length < 3 ? 120 : 130, pos = {};
  people.forEach((n, i) => { const a = (people.length === 2 ? Math.PI : -Math.PI / 2) + (2 * Math.PI * i) / people.length; pos[n] = [cx + r * 1.6 * Math.cos(a), cy + r * Math.sin(a)]; });
  let lines = '';
  for (const [k, [a, b]] of pairs) {
    if (!pos[a] || !pos[b]) continue;
    const tie = tieOf({ a, b, tie: st.pair?.[k]?.tie || '' }, st2, bp, R.V), da = st2.dir[`${a}>${b}`], db = st2.dir[`${b}>${a}`];
    const col = TEXC[(da?.tex ?? db?.tex ?? da?.cand ?? db?.cand ?? 7)], wall = bp.barrier.some((x) => k2(x.a, x.b) === k);
    const [x1, y1] = pos[a], [x2, y2] = pos[b], mx = (x1 + x2) / 2, my = (y1 + y2) / 2, on = ui.pair === k;
    lines += `<g class="mb3-pair" data-pair="${h(k)}" style="cursor:pointer"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${on ? 4 : 2}"${wall ? ' stroke-dasharray="6 4"' : ''}/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="14"/>${tie ? `<text x="${mx}" y="${my - 6}" text-anchor="middle" class="mb3-svgt">${h(tie.slice(0, 24))}</text>` : ''}</g>`;
  }
  const nodes = people.map((n) => { const [x, y] = pos[n]; return `<g class="mb3-node" data-who="${h(n)}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="30" class="mb3-svgc${ui.who === n ? ' mb3-svgon' : ''}"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="mb3-svgt">${h(n.slice(0, 6))}</text></g>`; }).join('');
  const legend = `<div class="mb3-dim mb3-legend">${L.rel.tex.slice(0, 7).map((t, i) => `<span style="color:${TEXC[i]}">━</span> ${h(t)}`).join(' · ')} · ┅ ${h(R.ui2.wall)}</div>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="mb3-svg">${lines}${nodes}</svg>${legend}${ui.pair ? pairDetail(ui.pair, st, st2, L) : `<p class="mb3-dim">${h(R.ui2.relTap)}</p>`}`;
}
function pairDetail(k, st, st2, L) {
  const [a, b] = k.split('|'), c = ctx(), S = store(), U2 = R.ui2, rows = [];
  (c.chat || []).forEach((m, i) => { for (const e of S?.rel?.[fingerprint(m)] || []) if ((e.a === a && e.b === b) || (e.a === b && e.b === a) || (e.k === 'tie' && [e.a, e.b].sort().join('|') === k)) rows.push({ i, e }); });
  const side = (x, y) => { const d = st2.dir[`${x}>${y}`]; if (!d) return '—'; const t = trend(d); return [d.tex != null && L.rel.tex[d.tex], t && L.rel.trend[t], d.inner && `「${d.inner}」`].filter(Boolean).join(' · ') || '—'; };
  const p = st.pair?.[k], touch = p?.touch && p.touch.lvl >= 1 ? `${L.touch[p.touch.lvl]} — ${fmtDate(dateAt(st.cal, p.touch.day), L, false)}` : '—';
  const lines = rows.slice(-12).reverse().map(({ i, e }) => `<li>#${i} ${e.k === 'mv' ? `${h(e.a)} → ${h(e.b)} · ${h(L.rel.moves[e.mv])}${e.inner ? ` · ${h(e.inner)}` : ''}` : e.k === 'tex' ? `🎨 ${h(e.a)} → ${h(e.b)}: ${h(L.rel.tex[e.t])}` : e.k === 'tie' ? `🤝 ${h(e.v)}` : '🔓'}${e.q ? `<div class="mb3-ev mb3-text">📜 “${h(e.q)}”</div>` : ''}</li>`).join('');
  return `<div class="mb3-detail"><b>${h(a)} – ${h(b)}</b><div>${h(a)} → ${h(b)}: ${h(side(a, b))}</div><div>${h(b)} → ${h(a)}: ${h(side(b, a))}</div><div>${h(R.ui2.done)}: ${h(touch)}</div><ul>${lines || `<li class="mb3-dim">${h(U2.relNone)}</li>`}</ul></div>`;
}

// Map: places as nested boxes (inside = inside), neighbours written on the box, 📍 = now. Tap a place for its replies.
function mapHtml(st, ui) {
  const P = st.places || {}, kids = {}, room = roomOf(st.loc), visits = {};
  for (const [n, p] of Object.entries(P)) (kids[p.up || ''] ||= []).push(n);
  for (const x of st.log) { const r = roomOf(x.loc); if (r) (visits[r] ||= []).push(x.i); }
  for (const p of R.bp.places || []) { const path = p.path.split(/\s*(?:>|→|›)\s*/).filter(Boolean); path.forEach((n, i) => { if (!P[n]) { P[n] = { up: path[i - 1] || '', near: {} }; (kids[path[i - 1] || ''] ||= []).push(n); } }); }
  const here = new Set(); { let n = room, d = 0; while (n && d++ < 8) { here.add(n); n = P[n]?.up; } }
  const box = (n, depth) => {
    if (depth > 6) return '';
    const near = Object.values(P[n]?.near || {}).map((x) => `<div class="mb3-near">↔ ${h(x.rel)}: ${h(x.b)}</div>`).join('');
    const v = visits[n]?.length || 0;
    return `<div class="mb3-place${n === room ? ' mb3-here' : here.has(n) ? ' mb3-path' : ''}${ui.place === n ? ' mb3-sel' : ''}" data-place="${h(n)}"><div class="mb3-pname">${n === room ? '📍 ' : ''}${h(n)}${v ? ` <span class="mb3-dim">×${v}</span>` : ''}</div>${near}${(kids[n] || []).length ? `<div class="mb3-pkids">${kids[n].map((k) => box(k, depth + 1)).join('')}</div>` : ''}</div>`;
  };
  const roots = (kids[''] || []).filter((n) => !P[n].up);
  if (!roots.length) return `<p class="mb3-dim">${h(R.ui.noPlaces)}</p>`;
  const sel = ui.place && P[ui.place] ? `<div class="mb3-detail"><b>${h(ui.place)}</b><div>${(visits[ui.place] || []).slice(-15).map((i) => `<a href="#" class="mb3-go" data-i="${i}">#${i}</a>`).join(' ') || h(R.ui2.mapNever)}</div>${Object.values(P[ui.place].near || {}).map((x) => `<div class="mb3-ev mb3-text">↔ ${h(x.rel)}: ${h(x.b)} — 📜 “${h(x.q)}”</div>`).join('')}</div>` : `<p class="mb3-dim">${h(R.ui2.mapTap)}</p>`;
  return `<div class="mb3-map">${roots.map((r) => box(r, 0)).join('')}</div>${sel}`;
}

// A person's layers: face (sheet + ledger), inner lines over time (with quotes), opened deep layers. Locked layers only in creator view.
function peopleHtml(st, L, ui) {
  const c = ctx(), S = store(), U2 = R.ui2, bp = R.bp;
  const names = Object.entries(st.names?.seen || {}).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  for (const p of bp.persons || []) if (!names.includes(p.name)) names.push(p.name);
  if (!names.length) return `<p class="mb3-dim">${h(R.ui.empty)}</p>`;
  const who = ui.who && names.includes(ui.who) ? ui.who : names[0], lp = (bp.persons || []).find((p) => p.name === who);
  const face = [lp?.role || st.role?.[who]?.v, ...(lp?.traits || []), ...(st.marks?.[who] || []), lp?.pers, st.wear?.[who] && `${R.ui.wear}: ${st.wear[who].v}`].filter(Boolean);
  const inner = [];
  (c.chat || []).forEach((m, i) => { for (const e of S?.rel?.[fingerprint(m)] || []) if (e.a === who && (e.inner || e.k === 'tex' || e.mv === 4)) inner.push({ i, e }); });
  const opened = (bp.deep || []).filter((d) => d.who === who && ledger2().open[d.id]), locked = (bp.deep || []).filter((d) => d.who === who && !ledger2().open[d.id]);
  const day = (d) => (d != null ? fmtDate(dateAt(st.cal, d), L, false) : '');
  return `<div class="mb3-pick">${names.slice(0, 14).map((n) => `<button class="menu_button${n === who ? ' mb3-on' : ''}" data-who="${h(n)}">${h(n)}</button>`).join('')}</div>
    <div class="mb3-layer"><div class="mb3-lt">${h(U2.layerFace)}</div>${face.length ? face.map(h).join(' · ') : `<span class="mb3-dim">—</span>`}${lp?.bg ? `<div class="mb3-dim">${h(lp.bg)}</div>` : ''}</div>
    <div class="mb3-layer"><div class="mb3-lt">${h(U2.layerInner)}</div>${inner.slice(-15).map(({ i, e }) => `<div class="mb3-lrow"><b>${h(day(e.day))}</b> #${i} → ${h(e.b)}: ${e.k === 'tex' ? `🎨 ${h(L.rel.tex[e.t])}` : `${e.mv === 4 ? '💥 ' : ''}${h(e.inner || L.rel.moves[e.mv])}`}${e.q ? `<div class="mb3-ev mb3-text">📜 “${h(e.q)}”</div>` : ''}</div>`).join('') || `<span class="mb3-dim">${h(U2.layerNone)}</span>`}</div>
    <div class="mb3-layer"><div class="mb3-lt">${h(U2.layerDeep)}</div>${opened.map((d) => `<div class="mb3-lrow">🔓 ${h(day(ledger2().open[d.id].day))} ${h(d.content)}<div class="mb3-ev mb3-text">📜 “${h(ledger2().open[d.id].q)}”</div></div>`).join('') || `<span class="mb3-dim">${h(U2.layerNoDeep)}</span>`}
    ${settings().maker && locked.length ? locked.map((d) => `<div class="mb3-lrow mb3-locked">🔒 ${h(d.content)} <span class="mb3-dim">— ${h(U2.opensWhen)}: ${h(d.opens || '?')}</span></div>`).join('') : ''}</div>`;
}

function render(box, ui) {
  const st = ledger(), U = R.ui, U2 = R.ui2, L = R.lang[uiLang()];
  const es = entries(st, U, L), chs = chapters(es, st, L);
  if (ui.chap == null || ui.chap >= chs.length) ui.chap = chs.length - 1;
  const nowLine = [fmtDate(dateAt(st.cal), L), st.cal.tod, st.loc, st.weather].filter(Boolean).join(' · ') || U.nothing;
  const tabs = [['flow', U2.byFlow], ['date', U.byDate], ['reply', U.byReply], ['rel', U2.byRel], ['map', U2.byMap], ['people', U2.byPeople]];
  let body = '';
  if (!es.length && ui.view !== 'people') body = `<p class="mb3-dim">${h(U.empty)}</p>`;
  else if (ui.view === 'flow' || ui.view === 'date') body = flowHtml(st, L, chs, ui);
  else if (ui.view === 'reply') body = es.slice().reverse().slice(0, ui.shown * 3).map((e) => entryHtml(e, st, L, ui.open)).join('');
  else if (ui.view === 'rel') body = relHtml(st, L, ui);
  else if (ui.view === 'map') body = mapHtml(st, ui);
  else if (ui.view === 'people') body = peopleHtml(st, L, ui);
  const more = (ui.view === 'flow' && chs.length > ui.shown) || (ui.view === 'reply' && es.length > ui.shown * 3) || ui.view === 'date';
  box.innerHTML = `<div class="mb3-log">
    <div class="mb3-top"><b>${h(U.now)}:</b> ${h(nowLine)}</div>
    <div class="mb3-tabs">${tabs.map(([k, t]) => `<button class="menu_button${ui.view === k ? ' mb3-on' : ''}" data-view="${k}">${h(t)}</button>`).join('')}</div>
    <div class="mb3-legend">📜 ${h(U.lg.text)} · 🎬 ${h(U.lg.dir)} · ✋ ${h(U.lg.user)} · ⚙️ ${h(U.lg.rule)} · 🧠 ${h(U2.reason)}</div>
    ${ui.view === 'reply' && es.length ? `<div class="mb3-bulk"><button class="menu_button mb3-delsel" title="${h(U.delSelTip)}">🗑 ${h(U.delSel)}</button><button class="menu_button mb3-redosel" title="${h(U.redoSelTip)}">🔁 ${h(U.redoSel)}</button><button class="menu_button mb3-delall" title="${h(U.delAllTip)}">⚠ ${h(U.delAll)}</button></div>` : ''}
    ${body}${more && ['flow', 'reply', 'date'].includes(ui.view) ? `<button class="menu_button mb3-more">${h(U.more)}</button>` : ''}</div>`;
}

export function openLedger() {
  const c = ctx(), box = document.createElement('div');
  const ui = { view: 'flow', chap: null, shown: 8, open: new Set(), pair: '', place: '', who: '' };
  const draw = () => { try { render(box, ui); } catch (e) { console.warn('[meatball3] log view', e); box.innerHTML = `<pre>${h(e.message)}</pre>`; } };
  box.addEventListener('click', (ev) => {
    if (ev.target.matches('.mb3-pickfp')) { ev.stopPropagation(); return; }
    const a = ev.target.closest('.mb3-edit,.mb3-redo,.mb3-del,.mb3-delsel,.mb3-redosel,.mb3-delall');
    if (a && box.contains(a)) {
      ev.preventDefault(); ev.stopPropagation();
      const U = R.ui, picked = [...box.querySelectorAll('.mb3-pickfp:checked')].map((x) => x.dataset.fp);
      if (a.matches('.mb3-edit')) { editReply(+a.dataset.i).then((ok) => ok && draw()); return; }
      if (a.matches('.mb3-del')) { if (confirm(U.delAsk)) { clearReplies([a.dataset.fp]); draw(); } return; }
      if (a.matches('.mb3-redo')) { clearReplies([a.dataset.fp], true); draw(); return; }
      if (a.matches('.mb3-delsel')) { if (picked.length && confirm(U.delSelAsk.replace('{n}', picked.length))) { clearReplies(picked); draw(); } return; }
      if (a.matches('.mb3-redosel')) { if (picked.length) { clearReplies(picked, true); draw(); } return; }
      if (a.matches('.mb3-delall')) { if (confirm(U.delAllAsk)) { clearAll(); draw(); } return; }
    }
    const t = ev.target.closest('[data-view],[data-chap],.mb3-more,.mb3-go,.mb3-why,.mb3-apply,[data-pair],[data-who],[data-place]');
    if (!t || !box.contains(t)) return;
    if (t.matches('.mb3-go')) { ev.preventDefault(); document.querySelector(`#chat .mes[mesid="${t.dataset.i}"]`)?.scrollIntoView({ block: 'start' }); return; }
    if (t.matches('.mb3-why')) { ev.preventDefault(); ev.stopPropagation(); ui.open.has(t.dataset.fp) ? ui.open.delete(t.dataset.fp) : ui.open.add(t.dataset.fp); draw(); return; }
    if (t.matches('.mb3-apply')) {
      ev.stopPropagation();
      const m = c.chat?.[+t.dataset.i], S = store(true), g = m && S.ev[fingerprint(m)];
      if (g) { g.push(t.dataset.fuzzy ? { k: 'time', days: 0, fuzzy: t.dataset.fuzzy, tod: '', by: 'user' } : { k: 'time', days: +t.dataset.days, tod: '', by: 'user' }); save(); refresh(); renderBar(); draw(); }
      return;
    }
    if (t.dataset.view) { ui.view = t.dataset.view; ui.shown = 8; }
    else if (t.matches('.mb3-more')) ui.shown += 8;
    else if (t.dataset.pair != null) ui.pair = ui.pair === t.dataset.pair ? '' : t.dataset.pair;
    else if (t.dataset.who != null) { ui.who = t.dataset.who; if (ui.view === 'rel') ui.view = 'people'; }
    else if (t.dataset.place != null) { ev.stopPropagation(); ui.place = ui.place === t.dataset.place ? '' : t.dataset.place; }
    else if (t.dataset.chap != null) { if (ev.target.closest('.mb3-cbody')) return; ui.chap = +t.dataset.chap === ui.chap && !t.matches('.mb3-bar') ? -1 : +t.dataset.chap; }
    draw();
  });
  draw();
  trWatch(box);   // the log is redrawn on every tab: translate each time (one request per view, cached)
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}
