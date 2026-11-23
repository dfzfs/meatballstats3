// 관계 2.0 (v0.25): one pair's story, folded from what is already stored per reply — nothing here is sent to the AI.
//   dist     how far apart the two feel, 5 (close) … 95 (far). A rough picture for the person, never a rule:
//            다가감 −7 · 물러섬 +7 · 금 감 +10 · 터짐 (romantic −4, else +6) · a feeling named (romantic −3, 원망 +5, 정 −2)
//            a lovers tie pulls it to ≤ 25, a breakup / enemies to ≥ 75; a new touch level caps it (손 50 · 포옹 40 · 입맞춤 25 · 그 이상 15)
//   events   every rel line and touch for the pair, with chat index; milestones (tie · touch · burst · first feeling) marked
//   fresh    what is new since the card was last seen (the avatars slide from the old distance, the line draws in)
import { ctx, store, save, ledger, R } from './store.js';
import { fingerprint } from '../core/clean.js';
import { ROMANCE, BREAK } from '../core/ledger2.js';

const key2 = (a, b) => [a, b].sort().join('|');
const clamp = (x) => Math.max(5, Math.min(95, x));
const isLover = (v) => (R.V?.loverTie || []).some((w) => String(v || '').toLowerCase().includes(String(w).toLowerCase()));
const CAP = [null, 70, 50, 40, 25, 15];

export function pairStory(P, M) {
  const c = ctx(), S = store() || {}, st = ledger(), bp = R.bp || {};
  const mine = (a, b) => { const A = M(a), B = M(b); return (A === P.A && B === P.B) || (A === P.B && B === P.A); };
  const bpTie = (bp.tie || []).find((x) => mine(x.a, x.b))?.v || '';
  let d = isLover(bpTie) ? 30 : BREAK.test(bpTie) ? 75 : 60, touch = 0;
  const texSeen = new Set(), pts = [{ i: -1, d }], ev = [];
  let together = 0;
  for (const x of st.log || []) if ((x.with || []).some((n) => M(n) === P.A) && (x.with || []).some((n) => M(n) === P.B)) together++;
  (c.chat || []).forEach((m, i) => {
    if (m.is_user || m.is_system) return;
    const fp = fingerprint(m), rel = S.rel?.[fp] || [], st1 = S.ev?.[fp] || [];
    let moved = false;
    for (const e of rel) {
      if (e.k === 'open' || e.k === 'drop' || !e.a || !mine(e.a, e.b)) continue;
      const from = M(e.a), to = M(e.b);
      if (e.k === 'mv') {
        if (e.mv === 5 && !e.inner) continue;
        const romantic = [0, 1, 2, 3, 4].some((t) => texSeen.has(t));
        d += [-7, 7, 0, 10, romantic ? -4 : 6, 0][e.mv] || 0;
        ev.push({ i, kind: e.mv === 4 ? 'burst' : 'mv', mv: e.mv, from, to, inner: e.inner, q: e.q, big: e.mv === 4 || e.mv === 3 });
      } else if (e.k === 'tex') {
        d += ROMANCE.includes(e.t) ? -3 : e.t === 5 ? 5 : e.t === 6 ? -2 : 0;
        const first = !texSeen.has(e.t); texSeen.add(e.t);
        ev.push({ i, kind: 'tex', t: e.t, from, to, q: e.q, big: first && e.t < 7 });
      } else if (e.k === 'tie') {
        if (isLover(e.v)) d = Math.min(d, 25); else if (BREAK.test(e.v)) d = Math.max(d, 75);
        ev.push({ i, kind: 'tie', v: e.v, q: e.q, big: true, user: !!e.user });
      } else continue;
      moved = true;
    }
    for (const e of st1) {
      if (e.k !== 'touch' || !(e.v > 0) || !mine(e.a, e.b)) continue;
      const up = e.v > touch;
      if (up) { touch = e.v; if (CAP[e.v] != null) d = Math.min(d, CAP[e.v]); }
      ev.push({ i, kind: 'touch', v: e.v, big: up });
      moved = true;
    }
    d = clamp(d);
    if (moved) pts.push({ i, d, big: ev.some((x) => x.i === i && x.big) });
  });
  const k = P.k, seen = S.rseen?.[k] || null;
  const fresh = { first: !seen, moved: !!seen && seen.n !== ev.length, d0: seen ? seen.d : d, touch: !!seen && touch > (seen.touch || 0) };
  return { k, dist: d, pts, events: ev, touch, together, fresh };
}
export function markPairsSeen(list) {
  const S = store(true); S.rseen ||= {};
  let ch = false;
  for (const p of list) { const now = { d: p.dist, n: p.events.length, touch: p.touch }, was = S.rseen[p.k]; if (!was || was.d !== now.d || was.n !== now.n || was.touch !== now.touch) { S.rseen[p.k] = now; ch = true; } }
  if (ch) save();
}
