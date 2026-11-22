// 🎲 「미정 날짜 정하기」: undated replies and vague weeks get dates by a roll of the dice (no AI), written as the person's dates.
// The last roll is kept in the chat's store, so ↩ undo still works after the log is closed (until the next roll).
import { store, save, ledger } from './store.js';
import { applyFixes, undoFixes } from './fix.js';
import { placeReplies, rollDates } from '../core/calendar.js';

export const lastRoll = () => store()?.dice || null;
// Rolls until nothing is left (a story with no date first gets a start day, then its vague weeks). Returns the fixes or null.
export function roll() {
  const y0 = store()?.year0 ?? null, nowY = new Date().getFullYear(), undo = [], fixes = [];
  for (let k = 0; k < 4; k++) {
    const st = ledger(), P = placeReplies(st, nowY, y0), rolls = rollDates(P, st.tl, nowY);
    if (!rolls.length) break;
    // a guessed year (no year in the story, none set) is never written down: only month · day, the year stays a guess
    const yr = (d) => (!P.guessed && d.y >= 100 ? `${d.y}년 ` : '');
    const fx = rolls.map((r) => ({ i: r.i, lines: [`date: ${yr(r.date)}${r.date.m}월 ${r.date.d}일`] }));
    if (!fx.length) break;
    const u = applyFixes(fx, '🎲');
    if (!u) break;
    undo.unshift(...u); fixes.push(...fx.filter((f) => u.some((x) => x.i === f.i)));
  }
  if (!undo.length) return null;
  const S = store(true); S.dice = { undo, n: undo.length, at: Date.now() }; save();
  return { undo, fixes };
}
export function undoRoll() {
  const S = store(true), d = S?.dice; if (!d) return false;
  undoFixes(d.undo); delete S.dice;
  for (const m of S.mbchat || []) if (m.prop?.dice && m.prop.state === 'done') m.prop.state = 'undone';   // the talk's copy of the same roll
  save(); return true;
}
// Something else took the same replies back (the Meatball talk's own undo): forget the roll
export function forgetRoll() { const S = store(true); if (S?.dice) { delete S.dice; save(); } }
