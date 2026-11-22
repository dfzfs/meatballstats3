// The ledger is never stored: it is folded from the stored events every time.
import { fingerprint } from './clean.js';
import { newState, applyGroup } from './ledger1.js';
import { dateRaw, isFuzzy } from './time.js';

// ev: { fingerprint: [events] }. Messages are walked in chat order, so rerolls, deletions and edits fix themselves.
export function fold(chat, ev, V, pre) {
  const st = newState();
  st.log = [];                                    // one entry per sorted reply that changed something (for the calendar ledger; never sent to the AI)
  if (pre?.length) applyGroup(st, pre, V);        // lines a person entered before anything was sorted
  st.tl = [];                                     // every AI reply, read or not: its story day and the date the engine had then (for the calendar)
  chat.forEach((m, i) => {
    if (m.is_system) return;
    const g = ev[fingerprint(m)];
    if (!g) { if (!m.is_user) tlPush(st, i, false); return; }
    applyGroup(st, g, V);
    if (!m.is_user) tlPush(st, i, true, g);
    if (g.length) st.log.push({ i, n: st.cal.n, tod: st.cal.tod, loc: st.loc, with: [...st.with], passed: st.fresh.passed, fuzzy: st.fresh.fuzzy || '', was: st.fresh.was, dates: st.fresh.dates, fixes: st.fresh.fixes, g });
  });
  return st;
}
function tlPush(st, i, read, g) {
  const c = st.cal, has = c.doy != null, skip = (g || []).some((e) => e.k === 'skip');
  if (has && !st.tlAnchor) st.tlAnchor = { an: c.an, doy: c.doy, wd: c.wd, y: c.y, n: c.n };
  st.tl.push({ i, n: c.n, read: read && !skip, md: has ? dateRaw(c) : null, fz: isFuzzy(c), user: (g || []).some((e) => e.k === 'date' && e.by === 'user') });
}
// Fingerprints that still exist in the chat (any swipe). Results for anything else are removed when a chat opens.
export function prune(chat, ev, fpOfText) {
  const live = new Set();
  for (const m of chat) {
    live.add(fingerprint(m));
    for (const s of m.swipes || []) live.add(fpOfText(m.is_user, m.name, s));
  }
  let removed = 0;
  for (const fp of Object.keys(ev)) if (!live.has(fp)) { delete ev[fp]; removed++; }
  return removed;
}
