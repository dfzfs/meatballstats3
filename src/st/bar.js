// The person's view: one status line above the input, and short notices. Never inside the chat text.
import { showName, nameMerger } from './tr.js';
import { ctx, settings, store, save, ledger, R, decide, fallState, bpLive } from './store.js';
import { dateAt, fmtDate, span, nowDate } from '../core/time.js';
import { refresh } from './inject.js';
import { trDom } from './tr.js';
import { fingerprint } from '../core/clean.js';
import { mascotImg, poke } from './mascot.js';
import { fillState, fillCount, drawFillRow } from './fill.js';

const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const uiLang = () => ((navigator.language || '').startsWith('ko') ? 'ko' : 'en');
const fill = (t, o) => String(t).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
let openLedger = () => {};
export const setOpener = (f) => { openLedger = f; };

export function renderBar() {
  try { draw(); } catch (e) { console.warn('[meatball3] status line failed', e); }
}
const PREV = { chat: null, v: {} };
function draw() {
  let el = document.getElementById('mb3_bar');
  const s = settings();
  try { drawFillRow(R.ui2); } catch (e) { /* settings not open */ }
  if (!s.on || !s.bar || !ctx().chat?.length) { if (el) el.style.display = 'none'; return; }
  if (!el) {
    const form = document.getElementById('send_form');
    if (!form) return;
    form.insertAdjacentHTML('beforebegin', '<div id="mb3_bar" title=""></div>');
    el = document.getElementById('mb3_bar');
    el.addEventListener('click', () => openLedger());
  }
  const st = ledger(), L = R.lang[uiLang()], U = R.ui;
  const F = fillState();
  if (!st.classified && !lastGuard() && !F && !store()?.ooc) { el.style.display = 'none'; return; }
  const date = nowDate(st.cal, L);
  const MN = nameMerger([...(st.with || []), ...(R.bp?.persons || []).map((p) => p.name), ...Object.keys(st.names?.seen || {})]), ws = [...new Set(st.with.map(MN))], who = ws.slice(0, 4).join(', ') + (ws.length > 4 ? ` +${ws.length - 4}` : '');
  // v0.29.1: the line shows where we are (the room and what it is in); the whole path stays in the log
  const place = String(st.loc || '').split(/\s*(?:>|→|›)\s*/).filter(Boolean).slice(-2).join(' › ');
  const passed = st.fresh?.passed > 0 ? `⏩ ${st.fresh.fuzzy ? L.span.fuzzy[st.fresh.fuzzy] : span(st.fresh.passed, L)}` : '';
  // v0.25: each piece is its own span; a piece whose value changed since the last draw glows once (date · place · who)
  const parts = [['d', date || '📅 ?'], ['t', st.cal.tod], ['l', place && `📍 ${place}`], ['w', who && `👥 ${who}`], ['p', passed]].filter(([, v]) => v);
  if (store()?.ooc) parts.unshift(['f', `💬 ${R.ui2?.oocOn || 'OOC 중 · 이야기 멈춤'}`]);
  if (F) { const n = fillCount(); parts.unshift(['f', `📚 ${F.paused ? R.ui2?.fillPaused || '정리 멈춤' : F.from != null ? R.ui2?.fillRangeRun || '구간 정리 중' : R.ui2?.fillRun || '처음부터 정리 중'} ${n.done}/${n.total}`]); }
  const chatId = ctx().chatId || ctx().getCurrentChatId?.() || '', same = PREV.chat === chatId;
  const glow = (k, v) => same && k !== 'f' && PREV.v[k] != null && PREV.v[k] !== v;
  const html = parts.map(([k, v]) => `<span class="mb3-bp${glow(k, v) ? ' mb3-bglow' : ''}">${h(v)}</span>`).join('<span class="mb3-sep">·</span>').replace(/^<span class="mb3-bp([^"]*)">📅 /, '<span class="mb3-bp$1">');
  PREV.chat = chatId; PREV.v = Object.fromEntries(parts);
  const g = lastGuard(), fr = settings().human === false ? [] : fallState().filter((f) => f.need);
  // v0.29: the note is damping a repeated figure or constant reaching back (core/worn.js): say so, quietly
  const W = R.wornNow, wornOn = !!(W && ((W.nums || []).length || W.recall || W.dense || W.spar));
  const face = R.sorting ? 'think' : g ? 'surprise' : fr.length ? 'party' : R.stalled ? 'sad' : 'idle';
  el.innerHTML = `${s.mascot !== false ? mascotImg(face, h(U.mascotTip || '')) : ''}${g ? `<span class="mb3-guard" title="${h(U.guardTip)}">⚠ ${h(U.guardChip)}</span> ` : ''}${fr.length ? `<span class="mb3-fall" title="${h(U.fallTip)}">💗 ${h(U.fallChip)}</span> ` : ''}${wornOn ? `<span class="mb3-worn" title="${h(U.wornTip || '')}">🔁 ${h(U.wornChip || '')}</span> ` : ''}<span class="mb3-bline"><span>📅</span> ${html}</span>`;
  el.querySelector('.mb3-cat')?.addEventListener('click', (e) => { e.stopPropagation(); poke(e.currentTarget); });
  el.querySelector('.mb3-guard')?.addEventListener('click', (e) => { e.stopPropagation(); guardPopup(); });
  el.querySelector('.mb3-fall')?.addEventListener('click', (e) => { e.stopPropagation(); fallPopup(); });
  el.querySelector('.mb3-worn')?.addEventListener('click', (e) => { e.stopPropagation(); wornPopup(); });
  el.title = U.ledger;
  el.style.display = '';
  Promise.resolve().then(() => trDom(el)).catch(() => {});   // English values (time of day, place) -> Korean on screen; cached, so usually no request
}

const toast = (msg, opt = {}) => { try { return window.toastr?.info(msg, '', { timeOut: 5000, ...opt }); } catch { return null; } };

// Called after a reply is sorted. `before` = ledger before, `fps` = the batch, `hint` = director hint or null.
export function afterSort(before, fps, hint) {
  const s = settings(), U = R.ui, L = R.lang[uiLang()];
  try { renderBar(); if (fps.length) guardAuto(fps.at(-1)); } catch (e) { /* the warning is optional */ }
  const after = ledger(), moved = after.cal.n - before.cal.n;
  const fz = after.fresh?.fuzzy ? L.span.fuzzy[after.fresh.fuzzy] : '';
  if (s.bar && moved > 0) toast(fill(U.passedToast, { s: fz || span(moved, L), a: fmtDate(dateAt(before.cal), L, false) || '?', b: nowDate(after.cal, L, false) || '?' }));
  // The instruction now goes to the classifier, so this notice is only for a skip nobody recorded (no time, no date).
  const said = (store()?.ev?.[fps.at(-1)] || []).some((e) => e.k === 'date' || (e.k === 'time' && (e.days || e.fuzzy)));
  const hs = hint?.fuzzy ? L.span.fuzzy[hint.fuzzy] : hint ? span(hint.days, L) : '';
  // v0.9: a time skip the person chose in 지시창 is applied at once (it is a decision, not a guess)
  if (hint?.user && (hint.days > 0 || hint.fuzzy) && moved <= 0 && !said) {
    const S = store(true), fp = fps.at(-1);
    (S.ev[fp] ||= []).push(hint.fuzzy ? { k: 'time', days: 0, fuzzy: hint.fuzzy, tod: '', by: 'user' } : { k: 'time', days: hint.days, tod: '', by: 'user' });
    save(); refresh(); renderBar(); return;
  }
  if (hint && hint.days > 0 && moved <= 0 && !said) {
    toast(fill(U.hintToast, { t: hint.text, s: hs }), {
      timeOut: 20000, extendedTimeOut: 10000,
      onclick: () => {
        const S = store(true), fp = fps.at(-1);
        (S.ev[fp] ||= []).push(hint.fuzzy ? { k: 'time', days: 0, fuzzy: hint.fuzzy, tod: '', by: 'user' } : { k: 'time', days: hint.days, tod: '', by: 'user' });
        save(); refresh(); renderBar(); toast(fill(U.hintDone, { s: hs }));
      },
    });
  }
}

// v0.8 vault guard. The last AI reply's open warning, if any: { fp, g }.
function lastGuard() {
  const S = store(), m = [...(ctx().chat || [])].reverse().find((x) => !x.is_user && !x.is_system);
  if (!S?.guard || !m) return null;
  const fp = fingerprint(m), g = S.guard[fp];
  return g && g.hits.length && !g.done ? { fp, g } : null;
}
const kindText = (U, k) => ({ sign: U.guardSign, revealed: U.guardRevealed, settled: U.guardSettled, rushed: U.guardRushed, crossed: U.guardCrossed, reversal: U.guardReversal, userGuess: U.guardGuess }[k] || k);
async function guardPopup() {
  const x = lastGuard(), c = ctx(), U = R.ui;
  if (!x) return;
  const rows = x.g.hits.map((t) => `<li><b>${h(t.who)}</b> · ${h(kindText(U, t.kind))}: <i>${h(t.q)}</i></li>`).join('');
  // the person's own character guessed it: not a leak — ask whether to open the vault
  const guess = x.g.hits.find((t) => t.kind === 'userGuess');
  if (guess) {
    const ok = await c.callGenericPopup(`<b>${h(U.guessTitle)}</b><ul>${rows}</ul><div class="mb3-dim">${h(U.guessHelp)}</div>`, c.POPUP_TYPE.CONFIRM, '', { okButton: U.vaultOpenBtn, cancelButton: U.guardKeep });
    if (ok) decide('vault', { who: guess.who, sid: guess.sid, open: true });
    x.g.done = true; save(); refresh(); renderBar(); return;
  }
  const rev = x.g.hits.find((t) => t.kind === 'reversal');
  const help = rev ? U.reversalHelp : U.guardHelp;
  const ok = await c.callGenericPopup(`<b>⚠ ${h(rev ? U.reversalTitle : U.guardTitle)}</b><ul>${rows}</ul><div class="mb3-dim">${h(help)}</div>`, c.POPUP_TYPE.CONFIRM, '', { okButton: U.guardRedo, cancelButton: U.guardKeep, customButtons: [{ text: U.guardFalse, result: 2 }] });
  if (ok === 2) { x.g.false = true; x.g.done = true; save(); renderBar(); }   // a false alarm: never counts toward "kept leak"
  else if (ok) redo(x.fp, rev || x.g.hits[0]);
  else { if (rev) decide('thread', { a: rev.a, b: rev.b, v: rev.v }); x.g.done = true; save(); refresh(); renderBar(); }   // keeping a reversal = the refusal is over
}
// Regenerate the last reply as a new swipe (the old one stays one swipe back).
function redo(fp, hit) {
  const S = store(), g = S?.guard?.[fp];
  if (g) { g.done = true; save(); }
  // v0.9: the rewrite carries one line saying what the version before did wrong (concrete, so stronger than a rule)
  R.redoLine = { kind: hit?.kind === 'reversal' ? 'refuse' : 'vault', who: hit?.who || g?.hits?.[0]?.who || '', v: hit?.v || '', t: Date.now() };
  const b = document.querySelector('#chat .last_mes .swipe_right');
  if (b) b.click(); else toast(R.ui.guardNoSwipe);
  renderBar();
}
// Setting "rewrite once by itself" (off by default): one automatic new swipe per reply, never more.
export function guardAuto(fp) {
  const s = settings(), S = store(), g = S?.guard?.[fp];
  if (!s.guardAuto || !g || g.auto || g.done) return;
  g.auto = true; save();
  toast(R.ui.guardAutoToast);
  setTimeout(() => redo(fp, g.hits[0]), 800);
}

// v0.29: what is being damped right now, in plain words (nothing to decide; it stops by itself)
function wornPopup() {
  const c = ctx(), U = R.ui, W = R.wornNow || {};
  const nums = (W.nums || []).length ? `<p><b>${h(U.wornNums || '')}</b><br>${W.nums.map((x) => `<span class="mb3-wchip">${h(x)}</span>`).join(' ')}</p>` : '';
  const recall = `${W.spar ? `<p>${h(U.wornSpar || '')}</p>` : ''}${W.dense ? `<p>${h(U.wornDense || '')}</p>` : ''}${W.recall ? `<p>${h(U.wornRecall || '')}</p>` : ''}`;
  c.callGenericPopup(`<div class="mb3-wpop"><b>🔁 ${h(U.wornTitle || '')}</b>${nums}${recall}<div class="mb3-dim">${h(U.wornHelp || '')}</div></div>`, c.POPUP_TYPE.TEXT);
}

// v0.9 step 3: the story has earned it (the person's condition quoted + enough story) — the person decides.
async function fallPopup() {
  const c = ctx(), U = R.ui, f = fallState().find((x) => x.need);
  if (!f) return;
  const ok = await c.callGenericPopup(`<b>💗 ${h(U.fallTitle.replace('{a}', f.a).replace('{b}', f.b))}</b><div class="mb3-dim">${h(U.fallHelp)}</div>`, c.POPUP_TYPE.CONFIRM, '', { okButton: U.fallOpen, cancelButton: U.fallNotYet });
  decide('fall', { a: f.a, b: f.b, open: !!ok }); refresh(); renderBar();
}
