// Every AI reply on a real calendar (year · month · day). Pure: built from the folded ledger's timeline.
//   exact   the engine had a date for that day
//   approx  inside a vague skip ("a few days later"): only the week is shown
//   none    no date anywhere in the story yet (goes to the 「미정」 tray)
import { dateRaw } from './time.js';

const DOY0 = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const doy = (m, d) => DOY0[m - 1] + d - 1;
// Date.UTC reads years 0-99 as 1900-1999: build the date and set the full year after (stories set in year 50 exist)
export const utc = (y, m, d) => { const x = new Date(Date.UTC(2000, m - 1, d)); x.setUTCFullYear(y, m - 1, d); return x; };
export const wdOf = (y, m, d) => utc(y, m, d).getUTCDay();
export const keyOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const dimOf = (y, m) => utc(y, m + 1, 0).getUTCDate();
// Weeks start on Sunday (like the month grid): the key of the Sunday of that date's week.
export function weekKey(y, m, d) { const x = addDays({ y, m, d }, -wdOf(y, m, d)); return keyOf(x.y, x.m, x.d); }
export function addDays(o, k) { const x = utc(o.y, o.m, o.d); x.setUTCDate(x.getUTCDate() + k); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
export const dayDiff = (a, b) => Math.round((utc(b.y, b.m, b.d) - utc(a.y, a.m, a.d)) / 864e5);   // b - a, in days

// A year for a story that never said one: the year closest to `nowY` whose calendar puts that date on that weekday.
function guessYear(m, d, wd, nowY) {
  if (wd == null) return nowY;
  for (let k = 0; k <= 12; k++) for (const y of [nowY - k, nowY + k]) if (wdOf(y, m, Math.min(d, dimOf(y, m))) === wd) return y;
  return nowY;
}

// year0: the year the person set for the first dated reply (wins over the story's and the guess)
export function placeReplies(st, nowY = new Date().getFullYear(), year0 = null) {
  const tl = st.tl || [], A = st.tlAnchor;
  const out = [], undated = [];
  let year = null, guessed = false, prev = null;
  for (const t of tl) {
    let md = t.md && t.md.m != null ? t.md : null;
    if (!md && A && t.n <= A.n) { const r = dateRaw({ ...A, fz: null }, t.n); if (r.m != null) md = r; }   // before the first date: counted back from it
    if (!md) { undated.push(t.i); continue; }
    // the year: one the reply names itself; else carried on, +1 when the date wraps (December -> January, or a date set
    // set more than half a year "before" the last one: time only goes forward; a few days back is a correction)
    if (year == null) {
      // the person's year for the first dated reply wins; the years after it are carried on from it as usual, and a
      // year written later in the story stays as written (it was shifted along with the rest before: 1524 → 1022)
      if (year0 != null) year = year0; else if (t.yx != null) year = t.yx; else if (md.y != null) year = md.y;
      else { year = guessYear(md.m, md.d, md.wd, nowY); guessed = true; }
    } else {
      const wrap = prev && doy(md.m, md.d) + 180 < doy(prev.m, prev.d) ? year + 1 : year;
      // a year named in the reply counts if the person wrote it, or if it does not send time backwards
      const back = t.yx != null && (t.yx < year || (t.yx === year && wrap > year));
      year = t.yx != null && (t.yu || !back) ? t.yx : wrap;
    }
    const d = Math.min(md.d, dimOf(year, md.m));
    out.push({ i: t.i, n: t.n, y: year, m: md.m, d, key: keyOf(year, md.m, d), wk: weekKey(year, md.m, d), approx: !!t.fz, read: t.read, user: t.user });
    prev = md;
  }
  if (year0 != null && out.length) guessed = false;
  return { list: out, undated, guessed, year0 };
}
// "#3", "#3~#7", "#3~#7, #12"
export function ranges(ids) {
  const s = [...new Set(ids)].sort((a, b) => a - b), out = [];
  for (const x of s) { const r = out.at(-1); if (r && x - r[1] <= 2) r[1] = x; else out.push([x, x]); }
  return out.map(([a, b]) => (a === b ? `#${a}` : `#${a}~#${b}`)).join(', ');
}

// 🎲 「미정 날짜 정하기」: no AI, a roll of the dice. Returns [{ i, date: { y, m, d } }] to be written as the person's dates.
//   no date anywhere yet   → the first read reply gets a random day of the year (the story's year, the set one or this year)
//   a vague skip («며칠 뒤» · «몇 주 뒤»), i.e. a run of ≈ replies → its first reply gets a random day of the striped week
//   the calendar shows for it, after the day before and never past a date the text names later.
// place = placeReplies(...); tl = st.tl (for which replies were read); rnd = () => [0, 1)
export function rollDates(place, tl, nowY, rnd = Math.random) {
  const read = new Map((tl || []).map((t) => [t.i, t.read !== false])), out = [];
  const R = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const list = place.list || [];
  if (!list.length) {
    const i = (place.undated || []).find((x) => read.get(x) !== false);
    if (i == null) return out;
    const y = place.year0 ?? nowY, m = R(1, 12);
    return [{ i, date: { y, m, d: R(1, dimOf(y, m)) } }];
  }
  let last = null, delta = 0;                      // last: the (possibly moved) date of the reply before; delta: how far the current run moved
  for (let k = 0; k < list.length; k++) {
    const r = list[k], at = { y: r.y, m: r.m, d: r.d };
    if (!r.approx) { delta = 0; last = at; continue; }
    if (k && list[k - 1].approx) { last = addDays(at, delta); continue; }     // inside a run: follows its first reply
    if (!last) { last = at; continue; }
    if (read.get(r.i) === false) { last = at; continue; }
    // a day inside the striped week the calendar shows for it (Sun–Sat), after the day before and not past a date the text names later
    const [wy, wm, wdd] = r.wk.split('-').map(Number), next = list.slice(k + 1).find((x) => !x.approx);
    const days = [0, 1, 2, 3, 4, 5, 6].map((j) => addDays({ y: wy, m: wm, d: wdd }, j))
      .filter((x) => dayDiff(last, x) >= 1 && (!next || dayDiff(x, next) >= 0));
    const date0 = days.length ? days[R(0, days.length - 1)] : at;
    const date = date0;
    out.push({ i: r.i, date });
    delta = dayDiff(at, date); last = date;
  }
  return out;
}
