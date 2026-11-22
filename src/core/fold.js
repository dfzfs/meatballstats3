// The ledger is never stored: it is folded from the stored events every time.
import { fingerprint } from './clean.js';
import { newState, applyGroup } from './ledger1.js';

// ev: { fingerprint: [events] }. Messages are walked in chat order, so rerolls, deletions and edits fix themselves.
export function fold(chat, ev, V, pre) {
  const st = newState();
  st.log = [];                                    // one entry per sorted reply that changed something (for the calendar ledger; never sent to the AI)
  if (pre?.length) applyGroup(st, pre, V);        // lines a person entered before anything was sorted
  chat.forEach((m, i) => {
    if (m.is_system) return;
    const g = ev[fingerprint(m)];
    if (!g) return;
    applyGroup(st, g, V);
    if (g.length) st.log.push({ i, n: st.cal.n, tod: st.cal.tod, loc: st.loc, with: [...st.with], passed: st.fresh.passed, fuzzy: st.fresh.fuzzy || '', was: st.fresh.was, dates: st.fresh.dates, fixes: st.fresh.fixes, g });
  });
  return st;
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
