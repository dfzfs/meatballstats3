// 비밀 2.0 (v0.24): one card per secret, folded from what is already stored per reply — nothing here is sent to the AI.
//   stage    🔒 locked → 👀 hint (clues from two replies) → 🤨 suspect (4 clues, or someone reasoning toward it)
//            → ⚠ close (a slip in the last 3 replies) → 🔓 open
//   events   clue · slip (sign word / revealed / rushed) · lie (only that it happened) · open, by chat index
//   people   keeper 🗝 · knows ✓ (a 'know' record that touches the secret) · unknown
//   fresh    what is new since the card was last looked at (the lock wobbles once / opens once)
import { ctx, store, save, ledger, ledger2, bpLive, bpAll, letActive } from './store.js';
import { fingerprint } from '../core/clean.js';
import { foldPressure, hasSign } from '../core/vault.js';
import { touches, hideId } from '../core/ledger2.js';

export const STAGES = ['locked', 'hint', 'suspect', 'close', 'open'];

export function secretView() {
  const c = ctx(), chat = c.chat || [], S = store() || {}, all = bpAll(S), live = bpLive(), st = ledger(), st2 = ledger2();
  const vaults = (all.vault || []).filter((x) => !x.goal);
  if (!vaults.length) return [];
  const ai = [];
  chat.forEach((m, i) => { if (!m.is_user && !m.is_system) ai.push({ i, fp: fingerprint(m) }); });
  const idxOf = new Map(ai.map((a) => [a.fp, a.i])), lastIdx = ai.slice(-3).map((a) => a.i);
  const pressure = foldPressure(chat, S, all, fingerprint), letOn = letActive();
  const people = [...new Set([...(all.persons || []).map((p) => p.name), ...Object.keys(st.names?.seen || {})])].filter(Boolean).slice(0, 12);
  return vaults.map((x) => {
    const keepers = x.who.split('-').map((n) => n.trim()).filter(Boolean);
    const open = !(live.vault || []).some((y) => y.who === x.who);
    const ev = [];
    for (const a of ai) {
      for (const k of S.clue?.[a.fp] || []) if (k.who === x.who) ev.push({ i: a.i, kind: k.kind === 'near' ? 'near' : 'clue', q: k.q });
      const g = S.guard?.[a.fp];
      if (g && !g.false) for (const h of g.hits || []) if (h.who === x.who && ['sign', 'revealed', 'rushed', 'userGuess'].includes(h.kind)) ev.push({ i: a.i, kind: 'slip', sub: h.kind, q: h.q });
      if ((S.lieLog?.[a.fp] || []).includes(x.who)) ev.push({ i: a.i, kind: 'lie' });
      for (const d of S.vdec?.[a.fp] || []) if (d.who === x.who) ev.push({ i: a.i, kind: d.open ? 'open' : 'relock', by: d.let ? 'let' : 'user' });
      for (const e of S.rel?.[a.fp] || []) if (e.k === 'open' && e.id === `vault:${x.who}`) ev.push({ i: a.i, kind: 'open', by: 'story', q: e.q });
    }
    ev.sort((p, q) => p.i - q.i);
    const clues = ev.filter((e) => e.kind === 'clue' || e.kind === 'near'), slips = ev.filter((e) => e.kind === 'slip'), lies = ev.filter((e) => e.kind === 'lie');
    const pr = pressure[x.who] || 0, recentSlip = slips.some((e) => lastIdx.includes(e.i));
    const stage = open ? 'open' : recentSlip ? 'close' : pr >= 2 ? 'suspect' : pr === 1 ? 'hint' : 'locked';
    // who knows: a 'know' record whose content touches the secret (its words or a sign word)
    const knows = new Set();
    for (const k of st.know || []) if (touches(x.v, k.what) || (x.signs || []).some((g) => hasSign(k.what, g))) for (const n of k.who) knows.add(n);
    const chips = people.filter((n) => !keepers.includes(n)).map((n) => ({ name: n, state: knows.has(n) ? 'knows' : 'unknown' }));
    const seen = S.vseen?.[x.who] || null;
    const fresh = { clue: !!seen && clues.length > (seen.clues || 0), open: !!seen && open && !seen.open, first: !seen };
    return { who: x.who, v: x.v, typed: !!x.typed, signs: x.signs || [], shows: x.shows || '', cover: x.cover || '', opens: x.opens || '',
      open, stage, pressure: pr, clues, slips, lies, events: ev, keepers, chips, letOn: letOn.has(x.who), fresh };
  });
}
// The card was looked at: what it shows now is "seen" (the next new clue wobbles the lock again)
export function markSeen(list) {
  const S = store(true); S.vseen ||= {};
  let ch = false;
  for (const v of list) { const now = { clues: v.clues.length, open: v.open }, was = S.vseen[v.who]; if (!was || was.clues !== now.clues || was.open !== now.open) { S.vseen[v.who] = now; ch = true; } }
  if (ch) save();
}
// The other locks a story has: lore 선 with a 풀림, 숨김 A-B → C. Open = the relationship reading marked it, or the person did.
export function otherLocks() {
  const S = store() || {}, bp = bpAll(S), st2 = ledger2();
  const out = [];
  (bp.line || []).forEach((x, i) => { if (x.release) out.push({ id: `line:${x.who}:${i}`, kind: 'line', who: x.who, v: x.v, opens: x.release, open: !!st2.open[`line:${x.who}:${i}`], byUser: S.gopen?.[`line:${x.who}:${i}`] != null }); });
  for (const x of bp.hide || []) out.push({ id: hideId(x), kind: 'hide', who: `${x.a}–${x.b}`, v: x.c, opens: '', open: !!st2.open[hideId(x)], byUser: S.gopen?.[hideId(x)] != null });
  return out;
}
