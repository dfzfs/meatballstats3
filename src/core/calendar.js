// Every AI reply on a real calendar (year · month · day). Pure: built from the folded ledger's timeline.
//   exact   the engine had a date for that day
//   approx  inside a vague skip ("a few days later"): only the week is shown
//   none    no date anywhere in the story yet (goes to the 「미정」 tray)
import { dateRaw } from './time.js';

const DOY0 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const doy = (m, d) => DOY0[m - 1] + d - 1;
const wdOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
export const keyOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const dimOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// Weeks start on Sunday (like the month grid): the key of the Sunday of that date's week.
export function weekKey(y, m, d) { const t = Date.UTC(y, m - 1, d) - wdOf(y, m, d) * 864e5, x = new Date(t); return keyOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }

// A year for a story that never said one: the year closest to `nowY` whose calendar puts that date on that weekday.
function guessYear(m, d, wd, nowY) {
  if (wd == null) return nowY;
  for (let k = 0; k <= 12; k++) for (const y of [nowY - k, nowY + k]) if (wdOf(y, m, Math.min(d, dimOf(y, m))) === wd) return y;
  return nowY;
}

export function placeReplies(st, nowY = new Date().getFullYear()) {
  const tl = st.tl || [], A = st.tlAnchor;
  const out = [], undated = [];
  let year = null, guessed = false, prev = null;
  for (const t of tl) {
    let md = t.md && t.md.m != null ? t.md : null;
    if (!md && A && t.n <= A.n) { const r = dateRaw({ ...A, fz: null }, t.n); if (r.m != null) md = r; }   // before the first date: counted back from it
    if (!md) { undated.push(t.i); continue; }
    if (year == null) {
      if (md.y != null) year = md.y;
      else { year = guessYear(md.m, md.d, md.wd, nowY); guessed = true; }
    } else if (md.y != null) { year = md.y; guessed = false; }
    else if (prev && doy(md.m, md.d) + 180 < doy(prev.m, prev.d)) year += 1;   // December -> January: the next year
    const d = Math.min(md.d, dimOf(year, md.m));
    out.push({ i: t.i, n: t.n, y: year, m: md.m, d, key: keyOf(year, md.m, d), wk: weekKey(year, md.m, d), approx: !!t.fz, read: t.read, user: t.user });
    prev = md;
  }
  return { list: out, undated, guessed };
}
// "#3", "#3~#7", "#3~#7, #12"
export function ranges(ids) {
  const s = [...new Set(ids)].sort((a, b) => a - b), out = [];
  for (const x of s) { const r = out.at(-1); if (r && x - r[1] <= 2) r[1] = x; else out.push([x, x]); }
  return out.map(([a, b]) => (a === b ? `#${a}` : `#${a}~#${b}`)).join(', ');
}
