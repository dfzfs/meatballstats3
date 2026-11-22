// 「처음부터 정리」: an old chat is read again from its first reply, a few replies per call, in order.
// The record is rebuilt from scratch; the person's ✋ fixes, director notes and set dates stay and are put back on top.
// While it runs, no note goes to the story AI (the record is still behind the story). Pause / go on any time.
import { ctx, store, save } from './store.js';
import { cleanText, fingerprint, skipMsg } from '../core/clean.js';
import { Q, kick } from './queue.js';
import { refresh } from './inject.js';
import { renderBar } from './bar.js';
import { tipQ } from './tip.js';

export const FILL_N = 6;
export const fillState = () => store()?.fill || null;
export const filling = () => { const f = fillState(); return !!f && !f.paused; };
const inRange = (f) => (m, i) => !m.is_user && !skipMsg(m) && cleanText(m.mes) && i >= (f?.from ?? 0) && i <= (f?.to ?? Infinity);
export function fillCount(f = fillState()) {
  const S = store(), ai = (ctx().chat || []).filter(inRange(f));
  return { done: ai.filter((m) => S?.ev?.[fingerprint(m)]).length, total: ai.length };
}
const redraw = () => { try { refresh(); renderBar(); } catch (e) { /* */ } };
// from / to: message numbers (#) as SillyTavern shows them; none = the whole chat
export function startFill(from = null, to = null) {
  const S = store(true), whole = from == null && to == null, f = { at: Date.now() };
  if (!whole) { f.from = from ?? 0; f.to = to ?? null; }
  delete S.fillNext;
  if (whole) Object.assign(S, { ev: {}, rel: {}, raw: {}, edited: {}, guard: {} });
  else (ctx().chat || []).forEach((m, i) => { if (!inRange(f)(m, i)) return; const fp = fingerprint(m); for (const k of ['ev', 'rel', 'raw', 'edited', 'guard']) if (S[k]) delete S[k][fp]; });
  S.fill = f;
  save(); Q.pushedKey = ''; Q.fails = 0; Q.tries = {}; redraw(); kick(500);
}
export function pauseFill(on) {
  const S = store(true); if (!S.fill) return;
  S.fill.paused = !!on; save(); Q.pushedKey = ''; redraw(); if (!on) kick(500);
}
// finished = the queue ran out of replies to read (not 「그만두기」)
export function endFill(finished = false) {
  const S = store(true); if (!S.fill) return false;
  // a range that ended before the last reply: the replies after it were read on the old state → offer to go on from there
  const F = S.fill, last = (ctx().chat || []).length - 1;
  if (finished && F.from != null && F.to != null && F.to < last && (ctx().chat || []).some(inRange({ from: F.to + 1 }))) S.fillNext = F.to + 1; else delete S.fillNext;
  delete S.fill; save(); redraw(); return true;
}

// The row in the settings: start · progress · pause / go on · stop
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function drawFillRow(T) {
  const el = document.getElementById('mb3_fill_row'); if (!el?.querySelector) return;
  const f = fillState(), { done, total } = fillCount(), U = T || {};
  // The status line redraws this row on every message: typing «0 ~ 6» and then a redraw used to wipe the boxes, and
  // the start button then saw two empty boxes = the whole chat. Idle row already there: leave it (and what is typed) alone.
  // …but it is drawn again when what it shows changes (the ▶ continue button)
  const sig = `idle|${store()?.fillNext ?? ''}`;
  if (!f && el.dataset.sig === sig && el.querySelector('.mb3-fill-go')) return;
  el.dataset.sig = f ? '' : sig;
  el.innerHTML = !f
    ? `<div class="menu_button mb3-fill-go" title="${h(U.fillWholeTip || '')}">📚 ${h(U.fillBtn || '처음부터 정리')}</div>
       <span class="mb3-fill-sep"></span>
       <span class="mb3-fill-r">#<input class="text_pole mb3-fill-a" type="number" min="0" placeholder="${h(U.fillFirst || '처음')}" /> ~ #<input class="text_pole mb3-fill-b" type="number" min="0" placeholder="${h(U.fillLast || '끝')}" /></span>
       <div class="menu_button mb3-fill-rg">🎯 ${h(U.fillRangeBtn || '구간 정리')}</div>
       ${store()?.fillNext != null ? `<div class="menu_button mb3-fill-nx" title="${h(U.fillNextTip || '')}">▶ ${h(String(U.fillNext || '#{n}부터 끝까지 이어서').replace('{n}', store().fillNext))}</div>` : ''}
       ${tipQ(U.fillDesc || '', h)}`
    : `<b>📚 ${h(f.paused ? U.fillPaused || '정리 멈춤' : f.from != null ? U.fillRangeRun || '구간 정리 중' : U.fillRun || '처음부터 정리 중')}${f.from != null ? ` (#${f.from}~#${f.to === Infinity || f.to == null ? '' : f.to})` : ''} ${done}/${total}</b>
       <div class="menu_button mb3-fill-p">${h(f.paused ? U.fillGo || '이어 하기' : U.fillPause || '멈추기')}</div><div class="menu_button mb3-fill-x">${h(U.fillStop || '그만두기')}</div>`;
  const toast = (t) => { try { window.toastr?.warning(t); } catch (e) { /* */ } };
  // 📚 처음부터 정리: always the whole chat (the boxes are only for 🎯)
  el.querySelector('.mb3-fill-go')?.addEventListener('click', () => {
    const cnt = fillCount(null).total;
    if (!cnt) { toast(U.fillNone || '그 구간에는 AI 답이 없어요'); return; }
    if (confirm(String(U.fillAsk || '').replace('{n}', cnt).replace('{c}', Math.ceil(cnt / FILL_N)))) { startFill(); drawFillRow(T); }
  });
  // 🎯 구간 정리: only between the two numbers (an empty end = to the last reply); both empty = asks for a number
  el.querySelector('.mb3-fill-rg')?.addEventListener('click', () => {
    const num = (sel) => { const v = el.querySelector(sel)?.value?.trim(); return v === '' || v == null || isNaN(+v) ? null : Math.max(0, Math.floor(+v)); };
    let a = num('.mb3-fill-a'), b = num('.mb3-fill-b'); if (a != null && b != null && a > b) [a, b] = [b, a];
    if (a == null && b == null) { toast(U.fillRangeNeed || '구간 번호를 적어 주세요. 예: #0 ~ #6'); el.querySelector('.mb3-fill-a')?.focus(); return; }
    const cnt = fillCount({ from: a ?? 0, to: b ?? Infinity }).total;
    if (!cnt) { toast(U.fillNone || '그 구간에는 AI 답이 없어요'); return; }
    const ask = String(U.fillAskRange || '').replace('{a}', a ?? 0).replace('{b}', b ?? (ctx().chat || []).length - 1);
    if (confirm(ask.replace('{n}', cnt).replace('{c}', Math.ceil(cnt / FILL_N)))) { startFill(a ?? 0, b); drawFillRow(T); }
  });
  // ▶ after a range: the rest of the chat, on top of the range just rebuilt
  el.querySelector('.mb3-fill-nx')?.addEventListener('click', () => {
    const a = store()?.fillNext; if (a == null) return;
    const cnt = fillCount({ from: a, to: Infinity }).total;
    if (!cnt) { const S = store(true); delete S.fillNext; save(); drawFillRow(T); return; }
    const ask = String(U.fillAskRange || '').replace('{a}', a).replace('{b}', (ctx().chat || []).length - 1);
    if (confirm(ask.replace('{n}', cnt).replace('{c}', Math.ceil(cnt / FILL_N)))) { startFill(a, null); drawFillRow(T); }
  });
  el.querySelector('.mb3-fill-p')?.addEventListener('click', () => { pauseFill(!f.paused); drawFillRow(T); });
  el.querySelector('.mb3-fill-x')?.addEventListener('click', () => { if (confirm(U.fillStopAsk || '')) { endFill(); kick(500); drawFillRow(T); } });
}
