// The log: what changed at each reply, and the evidence for it. Built only when opened.
import { ctx, store, save, ledger, R } from './store.js';
import { dateAt, fmtDate, span, parseDate } from '../core/time.js';
import { applyFixes, undoFixes } from './fix.js';
import { startFill } from './fill.js';
import { placeReplies, ranges, keyOf, weekKey, dimOf, wdOf, addDays, rollDates } from '../core/calendar.js';
import { cleanText, fingerprint } from '../core/clean.js';
import { findEvidence, TIME_MARKS } from '../core/evidence.js';
import { uiLang, renderBar } from './bar.js';
import { refresh } from './inject.js';
import { fold2, tieOf, trend } from '../core/ledger2.js';
import { trWatch, showName, nameMerger } from './tr.js';
import { mascotImg } from './mascot.js';
import { chatHtml, chatLog, send as chatSend, decide as chatDecide, undo as chatUndo, clearChat } from './mbchat.js';
import { settings, ledger2, stateFor } from './store.js';
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
    out.push({ icon: '⏩', title: fill(U.passedLine, { s: fz || span(x.passed, L), a: fmtDate(x.was || {}, L, false) || '?', b: rfmt(x.i, L) || '?' }), ev });
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
    c.title = big ? `${big.icon} ${big.title}` : roomOf(c.loc) || rfmt(c.es[0]?.x.i, L) || '—';
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
  const head = [rfmt(x.i, L), x.tod, roomOf(x.loc)].filter(Boolean).join(' · ');
  const list = e.its.map((it) => itemHtml(it, x.i)).join('') || `<li class="mb3-dim">${h(U.noChange)}</li>`;
  const edited = store()?.edited?.[e.fp] ? ` <span class="mb3-dim">✏️ ${h(U.edited)}</span>` : '';
  return `<div class="mb3-entry${e.hot ? ' mb3-hot' : ''}"><div class="mb3-head"><input type="checkbox" class="mb3-pickfp" data-fp="${h(e.fp)}" title="${h(U.pickTip)}"> <a href="#" class="mb3-go" data-i="${x.i}">#${x.i}</a> <span class="mb3-dim">${h(head)}</span>${edited}
    <a href="#" class="mb3-why" data-fp="${h(e.fp)}">🧠 ${h(U2.reason)}</a>
    <span class="mb3-acts"><a href="#" class="mb3-edit" data-i="${x.i}" title="${h(U.editTip)}">✏️ ${h(U.edit)}</a> <a href="#" class="mb3-redo" data-fp="${h(e.fp)}" title="${h(U.redoTip)}">🔁 ${h(U.redo)}</a> <a href="#" class="mb3-del" data-fp="${h(e.fp)}" title="${h(U.delTip)}">🗑 ${h(U.del)}</a></span></div><ul>${list}</ul>${open.has(e.fp) ? reasonHtml(e) : ''}</div>`;
}

// Big flow: day bars (height = how much changed, red = a big event) and chapter cards.
// ===== v0.10 log: a dashboard of soft cards ("한눈에"), and each card opened large in its own tab =====
// Light on purpose: no drawings, only the chosen day's scenes, top pairs and last few events are built.
const TEXI = ['💗', '🔥', '🥀', '💔', '⛓️', '🌧️', '🤝', ''];
const TEXK = ['love', 'want', 'miss', 'bitter', 'forbid', 'grudge', 'warm', ''];
const TRI = { closer: '↗', back: '↘', waver: '〰' };
const AVC = ['#f4a3b8', '#9fb7ea', '#b9dfb4', '#f3c98f', '#c7b6ef', '#f1b49a', '#9fd6d6', '#d9c0a3', '#b8c4d8'];
const avOf = (n, all) => `<i class="mb3-av" style="background:${AVC[Math.max(0, all.indexOf(n)) % AVC.length]}">${h([...String(n)][0] || '?')}</i>`;
function sceneRow(c, k, st, L, ui, M) {
  const first = c.es[0].x.i, last = c.es.at(-1).x.i, open = ui.chap === k;
  const its = c.es.flatMap((e) => e.its).filter((it) => !it.dim);
  const top = [...its.filter((it) => HOT.has(it.icon)), ...its.filter((it) => !HOT.has(it.icon))];
  const icon = top[0]?.icon || '📝', sum = top.slice(0, 2).map((it) => it.title).join(' · ') || R.ui.noChange;
  const head = [c.tod, roomOf(c.loc)].filter(Boolean).join(' · ') || rfmt(first, L) || `#${first}`;
  return `<div class="mb3-scene${c.hot ? ' mb3-hot' : ''}${open ? ' mb3-open' : ''}" data-chap="${k}">
    <div class="mb3-sic">${icon}</div><div class="mb3-sb"><div class="mb3-sh">${h(head)}</div><div class="mb3-ss">${h(sum)}</div>
    ${c.who.size ? `<div class="mb3-swho">👥 ${h([...new Set([...c.who].map(M))].slice(0, 5).join(', '))}</div>` : ''}</div>
    <div class="mb3-sr">#${first}${last !== first ? `–${last}` : ''}</div>
    ${open ? `<div class="mb3-cbody">${c.es.map((e) => entryHtml(e, st, L, ui.open)).join('')}</div>` : ''}</div>`;
}
// One placement of every reply on the calendar per draw: the log, the calendar and the list all read it (one truth).
let PL = new Map(), PLACE = { list: [], undated: [], guessed: false };
const rd = (i) => { const r = PL.get(i); return r ? { y: r.y, m: r.m, d: r.d, wd: wdOf(r.y, r.m, r.d), approx: r.approx } : null; };
const rfmt = (i, L, wd = false) => { const o = rd(i); return o ? `${o.approx ? '≈ ' : ''}${fmtDate(o, L, wd)}` : ''; };
// Calendar: always a real year · month. Every AI reply sits on a date: exact days are coloured by how much happened,
// a reply inside a vague skip colours its whole week, and replies before any date wait in the 「미정」 tray.
function calModel() {
  const P = PLACE, day = new Map(), week = new Map();
  for (const r of P.list) { const m = r.approx ? week : day, k = r.approx ? r.wk : r.key; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  const months = [...new Set(P.list.map((r) => `${r.y}-${r.m}`))].map((s) => s.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { ...P, day, week, months };
}
const ymLabel = (y, m, L) => fill(L.fmt.y, { x: L.mon[m - 1], y });
function calHtml(st, L, M0, chs, ui, big) {
  const U2 = R.ui2, lastR = M0.list.at(-1);
  if (!ui.ym && lastR) ui.ym = `${lastR.y}-${lastR.m}`;
  if (!ui.ym) { const n = new Date(); ui.ym = `${n.getFullYear()}-${n.getMonth() + 1}`; }
  const [y, m] = ui.ym.split('-').map(Number), len = dimOf(y, m), pad = wdOf(y, m, 1);
  const step = (k) => { const t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${(t % 12) + 1}`; };
  const has = M0.months.some(([a, b]) => a === y && b === m) ? '' : ` <span class="mb3-dim">(${h(U2.calEmpty || '기록 없음')})</span>`;
  const opts = M0.months.map(([a, b]) => `<option value="${a}-${b}"${a === y && b === m ? ' selected' : ''}>${h(ymLabel(a, b, L))}</option>`).join('');
  const head = `<div class="mb3-mon"><span data-ym="${step(-1)}">‹</span>${M0.months.length > 1 ? `<select class="mb3-ymsel">${M0.months.some(([a, b]) => a === y && b === m) ? '' : `<option selected>${h(ymLabel(y, m, L))}</option>`}${opts}</select>` : `<b>${h(ymLabel(y, m, L))}</b>`}<span data-ym="${step(1)}">›</span>${has}</div><div class="mb3-ychip${M0.guessed ? ' mb3-yq' : ''}" data-year0="1">📆 ${h(M0.year0 != null ? fill(U2.year0Set || '첫 답 연도 {y}년 · 바꾸기', { y: M0.year0 }) : M0.guessed ? (U2.year0None || '연도를 정해 주세요') : fill(U2.year0Story || '본문 연도 {y}년 · 바꾸기', { y: M0.list[0]?.y }))}</div>`;
  const wd = L.wd.map((w, k) => `<div class="mb3-cw${k === 0 ? ' mb3-sun' : k === 6 ? ' mb3-sat' : ''}">${h(String(w).slice(0, 1))}</div>`).join('');
  let cells = '<div class="mb3-cc mb3-out"></div>'.repeat(pad), col = pad;
  // the day's look at a glance (like a phone calendar): up to 2 icons of what happened, the big ones first
  const iconsOf = (rs) => { const ids = new Set(rs.map((r) => r.i)), seen = new Set();
    const its = chs.flatMap((c) => c.es.filter((e) => ids.has(e.x.i)).flatMap((e) => e.its)).filter((it) => !it.dim && it.icon);
    return [...its.filter((it) => HOT.has(it.icon)), ...its.filter((it) => !HOT.has(it.icon))].map((it) => it.icon).filter((x) => !seen.has(x) && seen.add(x)).slice(0, 2).join(''); };
  const nowK = lastR && !lastR.approx ? lastR.key : '';
  const hotOf = (rs) => { const ids = new Set(rs.map((r) => r.i)); return chs.some((c) => c.hot && c.es.some((e) => ids.has(e.x.i))); };
  const strip = (wk) => { const rs = M0.week.get(wk); if (!rs) return '';
    return `<div class="mb3-wstrip${ui.sel === `w:${wk}` ? ' mb3-sel' : ''}" data-wk="${wk}">≈ ${h(U2.weekSome || '이 주 어딘가')} · ${h(ranges(rs.map((r) => r.i)))}</div>`; };
  let wkOfRow = keyOf(y, m, 1) && weekKey(y, m, 1);
  for (let d = 1; d <= len; d++) {
    const k = keyOf(y, m, d), rs = M0.day.get(k) || [], wk = weekKey(y, m, d), wkOn = M0.week.has(wk);
    const lv = !rs.length ? '' : rs.length > 4 ? ' mb3-l3' : rs.length > 1 ? ' mb3-l2' : ' mb3-l1';
    const dw = (pad + d - 1) % 7, ic = rs.length && big ? iconsOf(rs) : '';
    cells += `<div class="mb3-cc${lv}${wkOn ? ' mb3-wkon' : ''}${rs.length && hotOf(rs) ? ' mb3-hotc' : ''}${ui.sel === `d:${k}` ? ' mb3-sel' : ''}${rs.some((r) => r.user) ? ' mb3-mine' : ''}${k === nowK ? ' mb3-now' : ''}${dw === 0 ? ' mb3-sun' : dw === 6 ? ' mb3-sat' : ''}"${rs.length ? ` data-dk="${k}" title="${h(ranges(rs.map((r) => r.i)))}"` : wkOn ? ` data-wk="${wk}"` : ''}><b>${d}</b>${ic ? `<i class="mb3-ic">${h(ic)}</i>` : rs.length && big ? `<i>${rs.length}</i>` : ''}</div>`;
    col++;
    if (col % 7 === 0 || d === len) { cells += strip(wkOfRow); if (d < len) wkOfRow = weekKey(y, m, d + 1); }
  }
  const tray = M0.undated.length ? `<div class="mb3-tray">📭 ${h(U2.undated || '날짜 미정')} · ${h(ranges(M0.undated))}</div>` : '';
  return `${head}<div class="mb3-cal">${wd}${cells}</div>${tray}`;
}
// Every AI reply in order, from the first: one row per run of replies on the same date (or the same state).
function replyRuns(st, L) {
  const chat = ctx().chat || [], read = new Map((st.tl || []).map((x) => [x.i, x.read])), runs = [];
  chat.forEach((m, i) => {
    if (m.is_user || m.is_system) return;
    const r = PL.get(i), seen = read.get(i);
    const k = seen === false ? 'x' : !r ? 'u' : r.approx ? `w:${r.wk}` : `d:${r.key}`;
    const last = runs.at(-1);
    if (last && last.k === k) last.ids.push(i); else runs.push({ k, ids: [i], r });
  });
  return runs;
}
function listHtml(st, L, ui) {
  const U2 = R.ui2, runs = replyRuns(st, L);
  let lastY = null;
  // short: "12월 24일 (수)"; the year only where it changes
  const short = (i) => { const o = rd(i); if (!o) return ''; const y = o.y !== lastY ? `<i class="mb3-ry">${h(fill(L.fmt.y, { x: '', y: o.y }).replace(/[,\s]+$|^[,\s]+/g, ''))}</i>` : ''; lastY = o.y;
    return `${y}${o.approx ? '≈ ' : ''}${h(fill(L.fmt.md, { mon: L.mon[o.m - 1], d: o.d }))} <span class="mb3-dim">(${h(String(L.wd[o.wd]).slice(0, 1))})</span>`; };
  return `<div class="mb3-rlist"><div class="mb3-rlh">📜 ${h(U2.replyList || '답 순서대로')}</div>${runs.map((x) => {
    const a = x.ids[0], b = x.ids.at(-1), rg = a === b ? `#${a}` : `#${a}~#${b}`;
    const what = x.k === 'x' ? `<span class="mb3-dim">${h(U2.notRead || '아직 안 읽음')}</span>` : x.k === 'u' ? `<span class="mb3-dim">${h(U2.undated || '날짜 미정')}</span>` : short(a);
    const sel = ui.sel && x.k === ui.sel ? ' mb3-on' : '';
    const btn = x.k === 'x' ? `<b class="mb3-rbtn" data-reread="${a}-${b}">🔄 ${h(U2.readThese || '다시 읽기')}</b>` : `<b class="mb3-rbtn" data-setd="${a}" title="${h(U2.setThisDate || '이 답부터 날짜 바꾸기')}">✏️</b>`;
    return `<div class="mb3-rrow${sel}${x.k === 'x' ? ' mb3-rx' : ''}"${x.k.length > 1 ? ` data-go="${h(x.k)}"` : ''}><b class="mb3-rr">${rg}</b><span class="mb3-rd">${what}</span>${btn}</div>`;
  }).join('')}</div>`;
}
// The date of one reply, set by the person (the replies after it follow it). Text like "2월 24일" or "February 24".
async function setReplyDate(i) {
  const c = ctx(), U2 = R.ui2, L = R.lang[uiLang()];
  const v = await c.Popup.show.input(fill(U2.setDateOf || '#{i}의 날짜', { i }), U2.setDateHint || '예: 2월 24일 · February 24 · 1524년 3월 2일', rfmt(i, L).replace(/^≈ /, ''));
  if (v == null || v === false || !String(v).trim()) return false;
  if (!parseDate(String(v), R.V)) { window.toastr?.warning(U2.dateBad || '날짜로 못 읽었어요. 예: 2월 24일'); return false; }
  return !!applyFixes([{ i, lines: [`date: ${String(v).trim()}`] }], 'date');
}
async function setYear0() {
  const c = ctx(), U2 = R.ui2, first = PLACE.list[0];
  const v = await c.Popup.show.input(fill(U2.year0Title || '첫 답(#{i})의 연도', { i: first?.i ?? '?' }), U2.year0Hint || '숫자만. 비우면 본문을 따라요.', String(store()?.year0 ?? ''));
  if (v == null || v === false) return false;
  const S = store(true), n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  if (String(v).trim() === '') delete S.year0; else if (Number.isFinite(n)) S.year0 = n; else return false;
  save(); return true;
}
// 🎲 Undated replies and vague skips get dates by a roll of the dice (no AI). Rolls again until nothing is left (a story with no
// date at all first gets a start day; then its vague skips). One undo for the whole roll.
function rollDice(ui, draw) {
  const U2 = R.ui2, y0 = store()?.year0 ?? null, nowY = new Date().getFullYear(), undo = [];
  for (let k = 0; k < 4; k++) {
    const P = placeReplies(ledger(), nowY, y0), rolls = rollDates(P, ledger().tl, nowY);
    if (!rolls.length) break;
    // a guessed year (no year in the story, none set) is never written down: only month · day, the year stays a guess
    const yr = (d) => (!P.guessed && d.y >= 100 ? `${d.y}년 ` : '');
    const u = applyFixes(rolls.map((r) => ({ i: r.i, lines: [`date: ${yr(r.date)}${r.date.m}월 ${r.date.d}일`] })), '🎲');
    if (!u) break; undo.unshift(...u);
  }
  if (!undo.length) { window.toastr?.info(U2.diceNone || '정할 날짜가 없어요. 흐릿한 주(빗금)나 미정 답이 없어요.'); return; }
  ui._dice = undo; ui.sel = ''; ui.ym = ''; draw();
  window.toastr?.success(fill(U2.diceDone || '🎲 답 {n}개의 날짜를 주사위로 정했어요. 마음에 안 들면 ↩ 되돌리기 · 다시 누르면 남은 것만 굴려요.', { n: undo.length }));
}
function flowCard(st, L, chs, ui, M, big) {
  const U2 = R.ui2, M0 = calModel();
  if (!M0.list.length && !M0.undated.length) return `<p class="mb3-dim">${h(R.ui.empty)}</p>`;
  // what is picked: a day ("d:2026-12-15") or a week ("w:2026-12-13"); default = where the story is now
  const valid = (s) => s && (s.startsWith('d:') ? M0.day.has(s.slice(2)) : M0.week.has(s.slice(2)));
  if (!valid(ui.sel)) { const r = M0.list.at(-1); ui.sel = r ? (r.approx ? `w:${r.wk}` : `d:${r.key}`) : ''; if (r) ui.ym = `${r.y}-${r.m}`; }
  const picked = !ui.sel ? M0.undated.map((i) => ({ i })) : ui.sel.startsWith('d:') ? M0.day.get(ui.sel.slice(2)) : M0.week.get(ui.sel.slice(2));
  const ids = new Set(picked.map((r) => r.i));
  let title = U2.undated || '날짜 미정';
  if (ui.sel.startsWith('d:')) { const [y, m, d] = ui.sel.slice(2).split('-').map(Number); title = fmtDate({ y, m, d, wd: wdOf(y, m, d) }, L); }
  else if (ui.sel.startsWith('w:')) { const [y, m, d] = ui.sel.slice(2).split('-').map(Number), e = addDays({ y, m, d }, 6), md = (mm, dd) => fill(L.fmt.md, { mon: L.mon[mm - 1], d: dd });
    title = fill(U2.weekOf || '{a}~{b} 사이 어딘가', { a: md(m, d), b: md(e.m, e.d) }); }
  const scenes = chs.map((c, k) => [c, k]).filter(([c]) => c.es.some((e) => ids.has(e.x.i)));
  const noRec = [...ids].filter((i) => !chs.some((c) => c.es.some((e) => e.x.i === i)));
  const top = `<div class="mb3-caltop">${ui._dice ? `<span class="mb3-diceundo">↩ ${h(U2.diceUndo || '되돌리기')}</span>` : ''}<span class="mb3-fillday" data-mb3tip="${h(U2.fillDatesTip || '')}">🎲 ${h(U2.fillDates || '미정 날짜 정하기')}</span></div>`;
  return `<div class="mb3-flow${big ? ' mb3-big mb3-flow3' : ''}"><div class="mb3-calbox">${top}${calHtml(st, L, M0, chs, ui, big)}
    <div class="mb3-leg"><span><b class="mb3-l1"></b>${h(U2.legL1 || '답 1개')}</span><span><b class="mb3-l2"></b>${h(U2.legL2 || '2~4')}</span><span><b class="mb3-l3"></b>${h(U2.legL3 || '5개+')}</span><span><b class="mb3-legnow"></b>${h(U2.legNow || '지금')}</span><span><b class="mb3-legwk"></b>${h(U2.legWeek || '그 주 어딘가')}</span><span><b class="mb3-legdot"></b>${h(U2.legBig || '큰 일')}</span><span><b class="mb3-legmine"></b>${h(U2.legMine || '정한 날짜')}</span><span class="mb3-dpen" data-setdate="1">✏️ ${h(U2.setDate || '날짜 정하기')}</span></div></div>
    ${big ? listHtml(st, L, ui) : ''}<div class="mb3-daybox"><div class="mb3-dtitle">📅 ${h(title)} <span class="mb3-dim">· ${h(ranges([...ids]))}</span></div>${scenes.slice(0, big ? 99 : 2).map(([c, k]) => sceneRow(c, k, st, L, ui, M)).join('')}${!big && scenes.length > 2 ? `<div class="mb3-more2" data-view="flow">+${scenes.length - 2} ›</div>` : ''}${noRec.length ? `<div class="mb3-dim mb3-norec">${h(ranges(noRec))} · ${h(U2.noRecord || '기록할 변화 없음 · 또는 아직 안 읽음')}</div>` : ''}</div></div>`;
}
function pairsOf(st, st2, bp, M) {
  const k2 = (a, b) => [a, b].sort().join('|'), raw = new Map();
  const add = (a, b) => { if (a && b && a !== b) raw.set(k2(a, b), [a, b].sort()); };
  Object.values(st.pair || {}).forEach((p) => add(p.a, p.b)); Object.values(st2.dir).forEach((d) => add(d.a, d.b));
  [...bp.tie, ...bp.barrier].forEach((x) => add(x.a, x.b));
  const out = new Map();
  for (const [k, [a, b]] of raw) {
    const A = M(a), B = M(b); if (A === B) continue;
    const kk = k2(A, B), o = out.get(kk) || { k, A: [A, B].sort()[0], B: [A, B].sort()[1], raws: [], score: 0 };
    o.raws.push([a, b]); const d1 = st2.dir[`${a}>${b}`], d2 = st2.dir[`${b}>${a}`]; o.score += (d1?.moves?.length || 0) + (d2?.moves?.length || 0) + (st.pair?.[k] ? 1 : 0);
    out.set(kk, o);
  }
  return [...out.values()].sort((x, y) => y.score - x.score);
}
function pairCard(P, st, st2, bp, L, ui, M, all) {
  const U2 = R.ui2, k2 = (a, b) => [a, b].sort().join('|');
  const feel = (from, to) => { for (const [a, b] of P.raws) for (const [x, y] of [[a, b], [b, a]]) { if (M(x) !== from || M(y) !== to) continue; const d = st2.dir[`${x}>${y}`]; if (!d) continue;
    const t = d.tex ?? d.cand, tr = trend(d); if (t == null && !tr && !d.inner && !d.feel?.length) continue; return { t, tr, q: d.inner || '', feel: d.feel || [] }; } return null; };
  let tie = '', wall = null;
  for (const [a, b] of P.raws) { tie ||= tieOf({ a, b, tie: st.pair?.[k2(a, b)]?.tie || '' }, st2, bp, R.V) || ''; wall ||= bp.barrier.find((x) => k2(x.a, x.b) === k2(a, b)) || null; }
  const row = (x, y) => { const f = feel(x, y);
    // the person's words first; else the sharpest line Meatball read (the kind is only a small tag)
    const words = f?.feel?.length ? f.feel.map((w) => `<span class="mb3-feel mb3-f-${f.t != null ? TEXK[f.t] || 'warm' : 'warm'}">💞 ${h(w)} <i class="mb3-mine">✋</i></span>`).join('')
      : f?.q ? `<span class="mb3-inner">「${h(f.q)}」</span>${f.t != null && f.t < 7 ? `<span class="mb3-kind">${TEXI[f.t]} ${h(L.rel.tex[f.t])}</span>` : ''}`
      : f?.t != null && f.t < 7 ? `<span class="mb3-feel mb3-f-${TEXK[f.t]}">${TEXI[f.t]} ${h(L.rel.tex[f.t])}</span>` : '';
    return `<div class="mb3-prow"><span class="mb3-dir">${h(x)} → ${h(y)}</span>${f ? `${words}${f.tr ? `<span class="mb3-trend mb3-tr-${f.tr}">${TRI[f.tr]} ${h(L.rel.trend[f.tr])}</span>` : ''}` : `<span class="mb3-dim">${h(U2.relNoFeel || '아직 기록 없음')}</span>`}</div>`; };
  return `<div class="mb3-pair2${ui.pair === P.k ? ' mb3-on' : ''}" data-pair="${h(P.k)}">
    <div class="mb3-ptop">${avOf(P.A, all)}<b>${h(P.A)}</b><span class="mb3-amp">⇄</span><b>${h(P.B)}</b>${avOf(P.B, all)}</div>
    <div class="mb3-ptie">${tie ? `🤝 ${h(tie)}` : h(U2.relNoTie || '공식 관계 없음')}${wall ? ` · 🚧 ${h(wall.v)}` : ''}</div>
    ${row(P.A, P.B)}${row(P.B, P.A)}</div>`;
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
function peopleChips(names, who, all) {
  return names.map((n) => { const lp = (R.bp.persons || []).find((p) => p.name === n);
    return `<span class="mb3-pchip${n === who ? ' mb3-on' : ''}" data-who="${h(n)}">${avOf(n, all)}${h(n)}${lp?.role ? ` <small>${h(lp.role)}</small>` : ''}</span>`; }).join('');
}
function personSheet(st, L, who, M) {
  const c = ctx(), S = store(), U2 = R.ui2, bp = R.bp, raws = new Set([who, ...Object.keys(st.names?.seen || {}).filter((n) => M(n) === who)]);
  const lp = (bp.persons || []).find((p) => raws.has(p.name)), any = (f) => [...raws].map(f).find(Boolean);
  const face = [lp?.role || any((n) => st.role?.[n]?.v), ...(lp?.traits || []), ...[...raws].flatMap((n) => st.marks?.[n] || []), lp?.pers].filter(Boolean);
  const wear = any((n) => st.wear?.[n]?.v);
  const inner = []; (c.chat || []).forEach((m, i) => { for (const e of S?.rel?.[fingerprint(m)] || []) if (raws.has(e.a) && (e.inner || e.k === 'tex' || e.mv === 4)) inner.push({ i, e }); });
  const day = (d) => (d != null ? fmtDate(dateAt(st.cal, d), L, false) : '');
  const opened = (bp.deep || []).filter((d) => raws.has(d.who) && ledger2().open[d.id]), locked = (bp.deep || []).filter((d) => raws.has(d.who) && !ledger2().open[d.id]);
  return `<div class="mb3-psheet">
    <div class="mb3-pcard"><div class="mb3-lt">${h(U2.layerFace)}</div>${face.length || wear ? `${face.map((x) => `<span class="mb3-tag">${h(x)}</span>`).join('')}${wear ? `<span class="mb3-tag">👕 ${h(wear)}</span>` : ''}` : '<span class="mb3-dim">—</span>'}${lp?.bg ? `<div class="mb3-dim">${h(lp.bg)}</div>` : ''}</div>
    <div class="mb3-pcard"><div class="mb3-lt">${h(U2.layerInner)}</div>${inner.slice(-8).reverse().map(({ i, e }) => `<div class="mb3-lrow"><span class="mb3-dim">${h(day(e.day))} #${i}</span> → ${h(M(e.b))}: ${e.k === 'tex' ? `${TEXI[e.t] || ''} ${h(L.rel.tex[e.t])}` : `${e.mv === 4 ? '💥 ' : ''}${h(e.inner || L.rel.moves?.[e.mv] || '')}`}</div>`).join('') || '<span class="mb3-dim">—</span>'}</div>
    <div class="mb3-pcard"><div class="mb3-lt">${h(U2.layerDeep)}</div>${opened.map((d) => `<div class="mb3-lrow">🔓 ${h(d.content)}</div>`).join('') || `<span class="mb3-dim">${locked.length ? `🔒 ${locked.length}` : '—'}</span>`}
    ${settings().maker && locked.length ? locked.map((d) => `<div class="mb3-lrow mb3-locked">🔒 ${h(d.content)} <span class="mb3-dim">— ${h(U2.opensWhen)}: ${h(d.opens || '?')}</span></div>`).join('') : ''}</div></div>`;
}

function render(box, ui) {
  ui._info = null;
  const st0 = ledger();
  PLACE = placeReplies(st0, new Date().getFullYear(), store()?.year0 ?? null); PL = new Map(PLACE.list.map((r) => [r.i, r]));
  const st = st0, st2 = ledger2(), bp = R.bp, U = R.ui, U2 = R.ui2, L = R.lang[uiLang()];
  const es = entries(st, U, L), chs = chapters(es, st, L);
  const rawNames = [...Object.keys(st.names?.seen || {}), ...(bp.persons || []).map((p) => p.name), ...(st.with || [])];
  const M = nameMerger(rawNames), all = [...new Set(rawNames.map(M))];
  const tabs = [['dash', U2.tabDash || '한눈에'], ['flow', U2.tabFlow || '흐름'], ['rel', U2.tabRel || '관계'], ['people', U2.tabPeople || '인물'], ['map', U2.tabMap || '지도'], ['chat', `💬 ${U2.tabChat || '미트볼'}`]];
  const S0 = stateFor(), nSecret = (S0.vaults || []).filter((v) => !v.open).length, nRefuse = (st.refused || []).filter((r) => !r.out).length, nWarn = (S0.guard || []).length;
  const pairs = pairsOf(st, st2, bp, M), people = [...new Set([...(bp.persons || []).map((p) => M(p.name)), ...Object.entries(st.names?.seen || {}).sort((a, b) => b[1] - a[1]).map(([n]) => M(n))])].slice(0, 12);
  const who = ui.who && people.includes(M(ui.who)) ? M(ui.who) : people[0];
  const more = (view, t) => `<span class="mb3-more2" data-view="${view}">${h(t || U2.seeAll || '전체')} ›</span>`;
  const card = (title, inner, extra = '') => `<div class="mb3-card ${extra}"><div class="mb3-ch">${title}</div>${inner}</div>`;
  let body = '';
  if (ui.view === 'reply' && ui.only) {
    const one = es.find((e) => e.fp === ui.only), redoing = !one && store()?.ev && !store().ev[ui.only];
    body = card(`🐾 ${h(U2.oneReply || '이 답의 기록')} <a href="#" class="mb3-all">${h(U.allReplies)} ›</a>`, one ? entryHtml(one, st, L, ui.open) : `<p class="mb3-dim">${h(redoing ? U.notReadYet : U.noChange)}</p>`);
  } else if (ui.view === 'flow') {
    body = card(`📖 ${h(U2.tabFlow || '흐름')}`, flowCard(st, L, chs, ui, M, true), 'mb3-wide');
  } else if (ui.view === 'rel') {
    body = card(`💞 ${h(U2.tabRel || '관계')}`, pairs.length ? pairs.slice(0, 20).map((P) => pairCard(P, st, st2, bp, L, ui, M, all)).join('') + (ui.pair ? pairDetail(ui.pair, st, st2, L) : `<p class="mb3-dim">${h(U2.relTap2 || '카드를 누르면 근거가 보여요')}</p>`) : `<p class="mb3-dim">${h(U2.relNone)}</p>`, 'mb3-wide');
  } else if (ui.view === 'chat') {
    body = card(`💬 ${h(U2.chatTitle || '미트볼에게 말하기')} <span class="mb3-dim" style="margin-left:auto;font-weight:500;font-size:12px">${h(U2.chatSub || '고칠 게 있으면 그냥 말해요')}</span>${chatLog().length ? `<span class="mb3-cclear" title="${h(U2.chatClearTip || '')}">🗑 ${h(U2.chatClear || '대화 지우기')}</span>` : ''}`, chatHtml(mascotImg('happy')), 'mb3-wide');
  } else if (ui.view === 'map') {
    body = card(`🗺️ ${h(U2.tabMap || '지도')}`, `<p class="mb3-dim">${h(U2.mapHow || '')}</p>${mapHtml(st, ui)}`, 'mb3-wide');
  } else if (ui.view === 'people') {
    body = card(`👤 ${h(U2.tabPeople || '인물')}`, people.length ? `<div class="mb3-pchips">${peopleChips(people, who, all)}</div>${personSheet(st, L, who, M)}` : `<p class="mb3-dim">${h(U.empty)}</p>`, 'mb3-wide');
  } else {
    const lastP = PLACE.list.at(-1), date = (lastP && rfmt(lastP.i, L, true)) || R.ui2.undated || '날짜 미정', withs = [...new Set((st.with || []).map(M))];
    const recent = es.slice(-12).reverse().flatMap((e) => e.its.filter((it) => !it.dim).map((it) => ({ it, i: e.x.i }))).sort((a, b) => (HOT.has(b.it.icon) - HOT.has(a.it.icon)) || b.i - a.i).slice(0, 3);
    const now = `<div class="mb3-card mb3-hero">${mascotImg('happy')}<div class="mb3-hl">${h(U.now)} <span class="mb3-talk" data-view="chat">💬 ${h(U2.chatShort || '고쳐 달라고 하기')}</span></div><div class="mb3-hd">${h(date)}</div>${st.cal.tod ? `<span class="mb3-htod">${h(st.cal.tod)}</span>` : ''}
      ${st.loc ? `<div class="mb3-hp" data-view="map" style="cursor:pointer">📍 ${h(st.loc)} ›</div>` : ''}<div class="mb3-hw">${withs.map((n) => { const w = [...st.with].filter((x) => M(x) === n).map((x) => st.wear?.[x]?.v).find(Boolean); return `<span>${avOf(n, all)}${h(n)}${w ? ` · ${h(w)}` : ''}</span>`; }).join('')}</div></div>
      <div class="mb3-tiles"><div class="mb3-tile mb3-t1"><b>${nSecret}</b><span>🔒 ${h(U2.tSecret || '비밀')}</span></div><div class="mb3-tile mb3-t2"><b>${nRefuse}</b><span>🚫 ${h(U2.tRefuse || '거절 중')}</span></div><div class="mb3-tile mb3-t3"><b>${nWarn}</b><span>⚠ ${h(U2.tWarn || '경고')}</span></div></div>
      ${card(`${h(U2.recent || '최근 일')} ${more('flow', U2.tabFlow)}`, recent.map(({ it, i }) => `<div class="mb3-rline">${it.icon} ${h(it.title)}<i>#${i}</i></div>`).join('') || `<p class="mb3-dim">${h(U.empty)}</p>`)}`;
    body = `<div class="mb3-grid"><div class="mb3-col1">${now}</div><div class="mb3-col2">
      ${card(`💞 ${h(U2.tabRel || '관계')} ${more('rel')}`, pairs.length ? pairs.slice(0, 2).map((P) => pairCard(P, st, st2, bp, L, ui, M, all)).join('') : `<p class="mb3-dim">${h(U2.relNone)}</p>`)}
      ${card(`📖 ${h(U2.tabFlow || '흐름')} ${more('flow')}`, flowCard(st, L, chs, ui, M, false))}</div>
      ${card(`👤 ${h(U2.tabPeople || '인물')}`, `<div class="mb3-pchips">${peopleChips(people.slice(0, 6), null, all)}</div>`, 'mb3-span')}</div>`;
  }
  ui._info = { st, es, nowLine: [fmtDate(dateAt(st.cal), L), st.cal.tod, st.loc].filter(Boolean).join(' · ') || '-', fmt: (e) => [rfmt(e.x.i, L), e.x.tod, roomOf(e.x.loc)].filter(Boolean).join(' · ') || '-' };
  box.innerHTML = `<div class="mb3-log2" data-th="${h(settings().theme || 'gray')}">
    <div class="mb3-top2">${mascotImg('idle')}<div><div class="mb3-tt">${h(U2.logTitle || '미트볼 일지')}</div><div class="mb3-dim">${h(fill(U2.logSub || '답 {n}개 읽음', { n: es.length }))}</div></div>
    <div class="mb3-seg">${tabs.map(([k, t]) => `<b class="${ui.view === k || (k === 'dash' && ui.view === 'reply') ? 'mb3-on' : ''}" data-view="${k}">${h(t)}</b>`).join('')}</div></div>
    ${body}</div>`;
}

// at = a chat index: open straight at that reply (its record, why, and ✏️ 🔁 🗑), with a link back to all replies
export function openLedger(at = null) {
  const c = ctx(), box = document.createElement('div');
  const ui = { view: 'dash', chap: -1, sel: '', ym: '', shown: 8, open: new Set(), pair: '', place: '', who: '', only: '' };
  const m = at != null ? c.chat?.[at] : null;
  if (m && !m.is_user) { ui.view = 'reply'; ui.only = fingerprint(m); ui.open.add(ui.only); }
  const draw = () => { try { render(box, ui); const ms = box.querySelector('.mb3-msgs'); if (ms) ms.scrollTop = ms.scrollHeight; box.querySelector('.mb3-cta')?.focus?.(); } catch (e) { console.warn('[meatball3] log view', e); box.innerHTML = `<pre>${h(e.message)}</pre>`; } };
  box.addEventListener('click', (ev) => {
    if (ev.target.matches('.mb3-pickfp')) { ev.stopPropagation(); return; }
    const a = ev.target.closest('.mb3-edit,.mb3-redo,.mb3-del,.mb3-delsel,.mb3-redosel,.mb3-delall');
    if (a && box.contains(a)) {
      ev.preventDefault(); ev.stopPropagation();
      const U = R.ui, picked = [...box.querySelectorAll('.mb3-pickfp:checked')].map((x) => x.dataset.fp);
      if (a.matches('.mb3-edit')) { editReply(+a.dataset.i).then((ok) => ok && draw()); return; }
      if (a.matches('.mb3-del')) { if (confirm(U.delAsk)) { clearReplies([a.dataset.fp]); draw(); } return; }
      if (a.matches('.mb3-redo')) { clearReplies([a.dataset.fp], true); draw(); const fp = a.dataset.fp; let n = 0; const w = setInterval(() => { if (store()?.ev?.[fp] || ++n > 40 || !box.isConnected) { clearInterval(w); if (box.isConnected) draw(); } }, 1500); return; }
      if (a.matches('.mb3-delsel')) { if (picked.length && confirm(U.delSelAsk.replace('{n}', picked.length))) { clearReplies(picked); draw(); } return; }
      if (a.matches('.mb3-redosel')) { if (picked.length) { clearReplies(picked, true); draw(); } return; }
      if (a.matches('.mb3-delall')) { if (confirm(U.delAllAsk)) { clearAll(); draw(); } return; }
    }
    if (ev.target.closest('.mb3-all')) { ev.preventDefault(); ui.only = ''; draw(); return; }
    const cb = ev.target.closest('.mb3-cyes,.mb3-cno,.mb3-cundo,.mb3-csend,.mb3-ccheck,.mb3-cclear,[data-setdate],[data-setd],[data-reread],[data-year0]');
    if (cb && box.contains(cb)) {
      ev.preventDefault(); ev.stopPropagation();
      if (cb.matches('.mb3-cclear')) { if (confirm(R.ui2.chatClearAsk || '대화를 지울까요? 이미 바꾼 기록은 그대로 남아요.')) { clearChat(); draw(); } return; }
      // ✏️: the date of the picked day's first reply (or the first reply when nothing is picked)
      if (cb.dataset.setdate) { const P0 = PLACE.list, sel = ui.sel || '', r = sel.startsWith('d:') ? P0.find((x) => !x.approx && `d:${x.key}` === sel) : sel.startsWith('w:') ? P0.find((x) => x.approx && `w:${x.wk}` === sel) : null;
        setReplyDate(r ? r.i : PLACE.undated[0] ?? P0[0]?.i ?? 0).then((ok) => { if (ok) { ui.sel = ''; ui.ym = ''; renderBar(); } draw(); }); return; }
      if (cb.dataset.setd) { setReplyDate(+cb.dataset.setd).then((ok) => { if (ok) { ui.sel = ''; ui.ym = ''; renderBar(); } draw(); }); return; }
      if (cb.dataset.year0) { setYear0().then((ok) => { if (ok) { ui.sel = ''; ui.ym = ''; } draw(); }); return; }
      if (cb.dataset.reread) { const [a, b] = cb.dataset.reread.split('-').map(Number); if (confirm(fill(R.ui2.readTheseAsk || '#{a}~#{b}를 다시 읽을까요? (AI 약 {c}번)', { a, b, c: Math.ceil(((b - a) / 2 + 1) / 6) }))) { startFill(a, b); draw(); } return; }
      if (cb.matches('.mb3-ccheck')) { chatSend(`🔍 ${R.ui2.checkBtn || '기록 대조'}`, ui._info, draw, { check: true }); return; }
      if (cb.matches('.mb3-csend')) { const ta = box.querySelector('.mb3-cta'); const v = ta?.value || ''; if (ta) ta.value = ''; chatSend(v, ui._info, draw); return; }
      const m = chatLog()[+cb.dataset.cm];
      if (cb.matches('.mb3-cyes')) chatDecide(m, true); else if (cb.matches('.mb3-cno')) chatDecide(m, false); else chatUndo(m);
      renderBar(); draw(); return;
    }
    const t = ev.target.closest('[data-view],[data-dk],[data-wk],[data-ym],[data-go],.mb3-fillday,.mb3-diceundo,[data-chap],.mb3-more,.mb3-go,.mb3-why,.mb3-apply,[data-pair],[data-who],[data-place]');
    if (!t || !box.contains(t)) return;
    if (t.matches('.mb3-go')) { ev.preventDefault(); document.querySelector(`#chat .mes[mesid="${t.dataset.i}"]`)?.scrollIntoView({ block: 'start' }); return; }
    if (t.matches('.mb3-why')) { ev.preventDefault(); ev.stopPropagation(); ui.open.has(t.dataset.fp) ? ui.open.delete(t.dataset.fp) : ui.open.add(t.dataset.fp); draw(); return; }
    if (t.matches('.mb3-apply')) {
      ev.stopPropagation();
      const m = c.chat?.[+t.dataset.i], S = store(true), g = m && S.ev[fingerprint(m)];
      if (g) { g.push(t.dataset.fuzzy ? { k: 'time', days: 0, fuzzy: t.dataset.fuzzy, tod: '', by: 'user' } : { k: 'time', days: +t.dataset.days, tod: '', by: 'user' }); save(); refresh(); renderBar(); draw(); }
      return;
    }
    if (t.dataset.view) { ui.view = t.dataset.view; ui.shown = 8; ui.only = ''; }
    else if (t.dataset.dk) { ui.sel = `d:${t.dataset.dk}`; ui.chap = -1; }
    else if (t.dataset.wk) { ui.sel = `w:${t.dataset.wk}`; ui.chap = -1; }
    else if (t.dataset.ym) { ui.ym = t.dataset.ym; }
    else if (t.dataset.go) { const g = t.dataset.go, r = PLACE.list.find((x) => (x.approx ? `w:${x.wk}` : `d:${x.key}`) === g); ui.sel = g; ui.chap = -1; if (r) ui.ym = `${r.y}-${r.m}`; }
    else if (t.matches('.mb3-fillday')) { rollDice(ui, draw); return; }
    else if (t.matches('.mb3-diceundo')) { undoFixes(ui._dice); ui._dice = null; ui.sel = ''; draw(); return; }
    else if (t.matches('.mb3-more')) ui.shown += 8;
    else if (t.dataset.pair != null) { ui.pair = ui.pair === t.dataset.pair ? '' : t.dataset.pair; ui.view = 'rel'; }
    else if (t.dataset.who != null) { ui.who = t.dataset.who; ui.view = 'people'; }
    else if (t.dataset.place != null) { ev.stopPropagation(); ui.place = ui.place === t.dataset.place ? '' : t.dataset.place; }
    else if (t.dataset.chap != null) { if (ev.target.closest('.mb3-cbody')) return; ui.chap = +t.dataset.chap === ui.chap ? -1 : +t.dataset.chap; }
    draw();
  });
  box.addEventListener('change', (ev) => { if (ev.target.matches?.('.mb3-ymsel')) { ui.ym = ev.target.value; draw(); } });
  box.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('.mb3-cta') && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); const v = ev.target.value; ev.target.value = ''; chatSend(v, ui._info, draw); }
  });
  draw();
  trWatch(box);   // the log is redrawn on every tab: translate each time (one request per view, cached)
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}
