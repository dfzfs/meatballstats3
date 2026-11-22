// The log: what changed at each reply, and the evidence for it. Built only when opened.
import { ctx, store, save, ledger, R } from './store.js';
import { dateAt, fmtDate, span } from '../core/time.js';
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
// ===== v0.10 log: a dashboard of soft cards ("한눈에"), and each card opened large in its own tab =====
// Light on purpose: no drawings, only the chosen day's scenes, top pairs and last few events are built.
const TEXI = ['💗', '🔥', '🥀', '💔', '⛓️', '🌧️', '🤝', ''];
const TEXK = ['love', 'want', 'miss', 'bitter', 'forbid', 'grudge', 'warm', ''];
const TRI = { closer: '↗', back: '↘', waver: '〰' };
const AVC = ['#f4a3b8', '#9fb7ea', '#b9dfb4', '#f3c98f', '#c7b6ef', '#f1b49a', '#9fd6d6', '#d9c0a3', '#b8c4d8'];
const avOf = (n, all) => `<i class="mb3-av" style="background:${AVC[Math.max(0, all.indexOf(n)) % AVC.length]}">${h([...String(n)][0] || '?')}</i>`;
function dayList(chs) { const m = new Map(); chs.forEach((c, k) => { if (!m.has(c.n)) m.set(c.n, []); m.get(c.n).push([c, k]); }); return [...m.entries()].map(([n, sc]) => ({ n, scenes: sc })); }
function sceneRow(c, k, st, L, ui, M) {
  const first = c.es[0].x.i, last = c.es.at(-1).x.i, open = ui.chap === k;
  const its = c.es.flatMap((e) => e.its).filter((it) => !it.dim);
  const top = [...its.filter((it) => HOT.has(it.icon)), ...its.filter((it) => !HOT.has(it.icon))];
  const icon = top[0]?.icon || '📝', sum = top.slice(0, 2).map((it) => it.title).join(' · ') || R.ui.noChange;
  const head = [c.tod, roomOf(c.loc)].filter(Boolean).join(' · ') || fmtDate(dateAt(st.cal, c.n), L, false) || `#${first}`;
  return `<div class="mb3-scene${c.hot ? ' mb3-hot' : ''}${open ? ' mb3-open' : ''}" data-chap="${k}">
    <div class="mb3-sic">${icon}</div><div class="mb3-sb"><div class="mb3-sh">${h(head)}</div><div class="mb3-ss">${h(sum)}</div>
    ${c.who.size ? `<div class="mb3-swho">👥 ${h([...new Set([...c.who].map(M))].slice(0, 5).join(', '))}</div>` : ''}</div>
    <div class="mb3-sr">#${first}${last !== first ? `–${last}` : ''}</div>
    ${open ? `<div class="mb3-cbody">${c.es.map((e) => entryHtml(e, st, L, ui.open)).join('')}</div>` : ''}</div>`;
}
// Calendar: a real month when the story has dates, else "day N" cells. Colour = how much happened, dot = a big event.
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function calHtml(st, L, days, ui, big) {
  const info = new Map(days.map((d) => [d.n, { size: d.scenes.reduce((a, [c]) => a + c.size, 0), hot: d.scenes.some(([c]) => c.hot) }]));
  const lvl = (n) => { const x = info.get(n); return !x ? '' : x.size > 8 ? ' mb3-l3' : x.size > 3 ? ' mb3-l2' : ' mb3-l1'; };
  const cell = (n, label, sub = '') => { const x = info.get(n);
    return `<div class="mb3-cc${lvl(n)}${x?.hot ? ' mb3-hotc' : ''}${n === ui.day ? ' mb3-sel' : ''}${n === st.cal.n ? ' mb3-now' : ''}"${x ? ` data-day="${n}"` : ''}>${h(label)}${sub ? `<i>${h(sub)}</i>` : ''}</div>`; };
  const d0 = dateAt(st.cal, ui.day);
  if (d0.m != null && d0.d != null) {
    // which story day sits on each date of this month (by offset from the chosen day)
    const m = d0.m, len = DIM[m - 1], first = ui.day - (d0.d - 1), wd1 = d0.wd != null ? ((d0.wd - (d0.d - 1)) % 7 + 7) % 7 : null;
    const head = wd1 != null ? L.wd.map((w) => `<div class="mb3-cw">${h(String(w).slice(0, 1))}</div>`).join('') : '';
    const pad = wd1 != null ? '<div class="mb3-cc mb3-out"></div>'.repeat(wd1) : '';
    let cells = ''; for (let d = 1; d <= len; d++) cells += cell(first + d - 1, String(d));
    const ns = days.map((x) => x.n), prevM = ns.filter((n) => n < first).at(-1), nextM = ns.find((n) => n >= first + len);
    return `<div class="mb3-mon">${prevM != null ? `<span data-day="${prevM}">‹</span>` : '<span class="mb3-dim">‹</span>'}<b>${h(L.mon[m - 1])}</b>${nextM != null ? `<span data-day="${nextM}">›</span>` : '<span class="mb3-dim">›</span>'}</div>
      <div class="mb3-cal">${head}${pad}${cells}</div>`;
  }
  const last = Math.max(...days.map((x) => x.n), st.cal.n || 0), from = Math.max(0, last - (big ? 34 : 13));
  let cells = ''; for (let n = from; n <= last; n++) cells += cell(n, String(n + 1), n === from ? (R.ui2.dayCell || '일째') : '');
  return `<div class="mb3-cal mb3-calN">${cells}</div>`;
}
function flowCard(st, L, chs, ui, M, big) {
  const U2 = R.ui2, days = dayList(chs);
  if (!days.length) return `<p class="mb3-dim">${h(R.ui.empty)}</p>`;
  if (ui.day == null || !days.some((d) => d.n === ui.day)) ui.day = days.at(-1).n;
  const at = days.findIndex((d) => d.n === ui.day);
  const date = fmtDate(dateAt(st.cal, ui.day), L) || fill(U2.dayRel || '{n}일째', { n: ui.day + 1 });
  const prev = days[at - 1], gap = prev && ui.day - prev.n > 1 ? ` <span class="mb3-dim">· ⏩ ${h(fill(U2.tlGap || '{n}일 뒤', { n: ui.day - prev.n }))}</span>` : '';
  const scenes = days[at].scenes.slice().reverse();
  return `<div class="mb3-flow${big ? ' mb3-big' : ''}"><div class="mb3-calbox">${calHtml(st, L, days, ui, big)}
    <div class="mb3-leg"><span><b class="mb3-l1"></b>${h(U2.legLow || '조금')}</span><span><b class="mb3-l3"></b>${h(U2.legHigh || '많이')}</span><span><b class="mb3-legdot"></b>${h(U2.legBig || '큰 일')}</span><span class="mb3-dpen" data-setdate="1">✏️ ${h(U2.setDate || '날짜 정하기')}</span></div></div>
    <div class="mb3-daybox"><div class="mb3-dtitle">📅 ${h(date)}${gap}</div>${scenes.slice(0, big ? 99 : 2).map(([c, k]) => sceneRow(c, k, st, L, ui, M)).join('')}${!big && scenes.length > 2 ? `<div class="mb3-more2" data-view="flow">+${scenes.length - 2} ›</div>` : ''}</div></div>`;
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
  const st = ledger(), st2 = ledger2(), bp = R.bp, U = R.ui, U2 = R.ui2, L = R.lang[uiLang()];
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
    const dt = dateAt(st.cal), date = fmtDate(dt, L) || fill(U2.dayRel || '{n}일째', { n: (st.cal.n || 0) + 1 }), withs = [...new Set((st.with || []).map(M))];
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
  ui._info = { es, nowLine: [fmtDate(dateAt(st.cal), L), st.cal.tod, st.loc].filter(Boolean).join(' · ') || '-', fmt: (e) => [fmtDate(dateAt(st.cal, e.x.n), L, false), e.x.tod, roomOf(e.x.loc)].filter(Boolean).join(' · ') || '-' };
  box.innerHTML = `<div class="mb3-log2" data-th="${h(settings().theme || 'gray')}">
    <div class="mb3-top2">${mascotImg('idle')}<div><div class="mb3-tt">${h(U2.logTitle || '미트볼 일지')}</div><div class="mb3-dim">${h(fill(U2.logSub || '답 {n}개 읽음', { n: es.length }))}</div></div>
    <div class="mb3-seg">${tabs.map(([k, t]) => `<b class="${ui.view === k || (k === 'dash' && ui.view === 'reply') ? 'mb3-on' : ''}" data-view="${k}">${h(t)}</b>`).join('')}</div></div>
    ${body}</div>`;
}

// at = a chat index: open straight at that reply (its record, why, and ✏️ 🔁 🗑), with a link back to all replies
export function openLedger(at = null) {
  const c = ctx(), box = document.createElement('div');
  const ui = { view: 'dash', chap: -1, day: null, shown: 8, open: new Set(), pair: '', place: '', who: '', only: '' };
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
    const cb = ev.target.closest('.mb3-cyes,.mb3-cno,.mb3-cundo,.mb3-csend,.mb3-ccheck,.mb3-cclear,[data-setdate]');
    if (cb && box.contains(cb)) {
      ev.preventDefault(); ev.stopPropagation();
      if (cb.matches('.mb3-cclear')) { if (confirm(R.ui2.chatClearAsk || '대화를 지울까요? 이미 바꾼 기록은 그대로 남아요.')) { clearChat(); draw(); } return; }
      if (cb.dataset.setdate) { import('./ui.js').then((m) => m.setDate?.()).then(() => draw()); return; }
      if (cb.matches('.mb3-ccheck')) { chatSend(`🔍 ${R.ui2.checkBtn || '기록 대조'}`, ui._info, draw, { check: true }); return; }
      if (cb.matches('.mb3-csend')) { const ta = box.querySelector('.mb3-cta'); const v = ta?.value || ''; if (ta) ta.value = ''; chatSend(v, ui._info, draw); return; }
      const m = chatLog()[+cb.dataset.cm];
      if (cb.matches('.mb3-cyes')) chatDecide(m, true); else if (cb.matches('.mb3-cno')) chatDecide(m, false); else chatUndo(m);
      renderBar(); draw(); return;
    }
    const t = ev.target.closest('[data-view],[data-day],[data-chap],.mb3-more,.mb3-go,.mb3-why,.mb3-apply,[data-pair],[data-who],[data-place]');
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
    else if (t.dataset.day != null) { ui.day = +t.dataset.day; ui.chap = -1; }
    else if (t.matches('.mb3-more')) ui.shown += 8;
    else if (t.dataset.pair != null) { ui.pair = ui.pair === t.dataset.pair ? '' : t.dataset.pair; ui.view = 'rel'; }
    else if (t.dataset.who != null) { ui.who = t.dataset.who; ui.view = 'people'; }
    else if (t.dataset.place != null) { ev.stopPropagation(); ui.place = ui.place === t.dataset.place ? '' : t.dataset.place; }
    else if (t.dataset.chap != null) { if (ev.target.closest('.mb3-cbody')) return; ui.chap = +t.dataset.chap === ui.chap ? -1 : +t.dataset.chap; }
    draw();
  });
  box.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('.mb3-cta') && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); const v = ev.target.value; ev.target.value = ''; chatSend(v, ui._info, draw); }
  });
  draw();
  trWatch(box);   // the log is redrawn on every tab: translate each time (one request per view, cached)
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}
