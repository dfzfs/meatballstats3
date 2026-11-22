// Builds the three signpost layers from the ledger.
// v0.6: Meatball knows everything but repeats little; no "N days ago" counts. v0.7: props are no longer echoed right
// after they changed (the story then ticked them off); only lasting clothes and injuries come back now and then. The shallow layer carries this reply's lines and leak level (see rows2).
import { estTokens } from './clean.js';
import { dateAt, fmtDate, span, nowDate } from './time.js';

export const BUDGET = { deep: 160, mid: 150, now: 120, total: 520, wearRemind: 6, bodyRemind: 4, pairs: 3, nowLines: 3, staleDays: 1, wearDays: 7, bodyDays: 120, promiseDays: 7, knowDays: 7 };

function fit(head, rows, budget, lg) {
  const out = [...rows];
  while (out.length && estTokens([head, ...out.map((r) => r.text)].join('\n'), lg) > budget) out.pop();
  return out;
}
const join = (...xs) => xs.filter(Boolean).join(' · ');
// "A > B > C" -> "C (A > B)"; neighbours of the room, from the place tree (only what the text said).
export function placeLine(st) {
  const path = String(st.loc || '').split(/\s*(?:>|→|›)\s*/).filter(Boolean);
  if (!path.length) return { here: '', around: [] };
  const room = path.at(-1), here = path.length > 1 ? `${room} (${path.slice(0, -1).join(' > ')})` : room;
  const around = Object.values(st.places?.[room]?.near || {}).slice(0, 3).map((x) => `${x.rel}: ${x.b}`);
  return { here, around };
}

export function build(st, L, lg, B = BUDGET) {
  const S = L.sp, cal = st.cal, today = cal.n, here = st.with;
  if (!st.classified) return { deep: '', mid: '', now: '', rows: [], tokens: 0 };
  const on = (day) => (day == null ? '' : fmtDate(dateAt(cal, day), L, false));   // a date when one is known; never a count
  const dash = (x) => (x ? ` — ${x}` : '');
  const remind = (g, first) => { const d = g == null ? -1 : (st.gn || 0) - g; return d >= first && (d - first) % first === 0; };
  const row = (layer, text, src) => ({ layer, text, src });

  // deep: dead / left -> who knows what -> promises -> pair lines
  let deep = [];
  for (const [n, g] of Object.entries(st.gone).sort((a, b) => b[1].day - a[1].day).slice(0, 4)) deep.push(row('deep', `- ${n}: ${S[g.v]}${dash(on(g.day))}`, g.q));
  for (const k of st.know.filter((k) => today - k.day <= B.knowDays && k.who.some((n) => here.includes(n))).slice(-2)) deep.push(row('deep', `- ${k.what.replace(/["“”「」]/g, '').slice(0, 80)} — ${S.knownTo}: ${k.who.join(', ')}`, 'know'));
  for (const p of st.promise.filter((p) => today - p.day <= B.promiseDays).slice(-3)) deep.push(row('deep', `- ${S.promise}: ${p.a} → ${p.b}: ${p.v}`, 'promise'));
  const pairs = Object.values(st.pair).filter((p) => here.includes(p.a) && here.includes(p.b)).slice(-B.pairs);
  for (const p of pairs) {
    const calls = Object.entries(p.call).map(([k, v]) => `${k.replace('>', ' → ')} ${S.calls}: ${v}`);
    const touch = p.touch && p.touch.lvl >= 3 ? L.touch[p.touch.lvl] : '';   // never "none": only what happened
    const text = join(B.tieOf ? B.tieOf(p) : p.tie, ...calls, touch);
    if (text) deep.push(row('deep', `- ${p.a}–${p.b}: ${text}`, 'pair'));
  }
  for (const x of (st.lies || []).filter((x) => !x.out && here.includes(x.a) && here.includes(x.b)).slice(-2)) deep.push(row('deep', `- ${S.lie.replace('{a}', x.a).replace('{b}', x.b).replace('{v}', x.v)}`, x.q || 'lie'));
  for (const x of (st.owes || []).filter((x) => !x.out && here.includes(x.a) && here.includes(x.b)).slice(-2)) deep.push(row('deep', `- ${S.owe.replace('{a}', x.a).replace('{b}', x.b).replace('{v}', x.v)}`, 'owe'));
  for (const n of here) if (st.marks?.[n]?.length) deep.push(row('deep', `- ${n}: ${st.marks[n].slice(0, 3).join(', ')}`, 'mark'));
  for (const f of (st.facts || []).filter((f) => here.includes(f.who)).slice(-2)) deep.push(row('deep', `- ${S.notHere.replace('{name}', f.who).replace('{what}', f.v)}`, 'slip'));
  deep = fit(S.deepHead, deep, B.deep, lg);

  // mid: date line first, then one line per person in the scene
  const dateStr = nowDate(cal, L);   // no date clue yet: say nothing ("since the story began" is false on chats installed mid-story)
  const pl = placeLine(st);
  let mid = [row('mid', join(dateStr, cal.tod, pl.here, st.weather, st.mood), cal.src || 'time')];
  if (pl.around.length) mid.push(row('mid', `${S.nearby}: ${pl.around.join(' · ')}`, 'near'));
  const plain = [];
  here.forEach((n, i) => {
    const w = st.wear[n], b = st.body[n];
    const wv = w ? w.v.split(/\s*,\s*(?=[+\-])|\s*·\s*/).map((p) => (/^[+\-]/.test(p) ? p.slice(1).trim().replace(/^([^(]*?)\s*(\(.*)?$/, (_, a, b) => `${a} ${p[0] === '-' ? S.off : S.on}${b ? ` ${b}` : ''}`) : p)).join(' · ') : '';
    // v0.7: what just changed is already in the last reply, so echoing it only made the story tick it off again.
    // Position and held items never come here; clothes and a lasting injury come back as a quiet reminder
    // (clothes every 6 replies after the change, a lasting injury every 4), when they could have slipped out of view.
    const wear = w && remind(w.g, B.wearRemind || 6) && wv;
    const body = b && !b.brief && remind(b.g, B.bodyRemind || 4) && b.v;
    const pos = '', held = '', role = st.role?.[n]?.v;
    const money = st.money?.[n]?.v, stats = Object.entries(st.stats?.[n] || {}).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
    const who = role ? `${n} (${role})` : n;
    if (i >= 5 || !(wear || body || pos || held || money || stats)) plain.push(who); else mid.push(row('mid', `${who}: ${join(pos, wear, body, held && `${S.holds}: ${held}`, money && `${S.money}: ${money}`, stats)}`, 'with'));
  });
  if (plain.length) mid.push(row('mid', mid.length > 1 ? `${S.also}: ${plain.join(', ')}` : plain.join(', '), 'with'));
  mid = fit(S.midHead, mid.filter((r) => r.text), B.mid, lg);

  // now: only what just changed. No dispositions, no "has not".
  let fresh = [];
  const f = st.fresh || {};
  if (f.passed > 0) {
    const was = fmtDate(f.was || {}, L, false);
    const s = f.fuzzy ? L.span.fuzzy[f.fuzzy] || L.span.fuzzy.d : span(f.passed, L);
    fresh.push(row('now', `- ${S.passed.replace('{s}', s)}${was ? ` (${S.was} ${was})` : ''}${f.fuzzy ? ` — ${S.dayUnknown}` : ''}`, 'time'));
  }
  for (const n of f.fixes || []) fresh.push(row('now', `- ${S.correction.replace('{name}', n).replace('{state}', S[st.gone[n].v])}`, st.gone[n].q));
  for (const x of f.slips || []) if (x.count < 2) fresh.push(row('now', `- ${S.slipFix.replace('{name}', x.who).replace('{what}', x.v)}`, 'slip'));
  for (const n of f.arrived || []) {
    const k = st.know.filter((k) => !k.who.includes(n) && k.who.some((x) => here.includes(x))).at(-1);
    fresh.push(row('now', `- ${n}: ${S.arrived}${k ? `; ${S.outside}: ${k.what}` : ''}`, 'with'));
  }
  fresh = fit(S.nowHead, fresh.slice(0, B.nowLines), B.now, lg);

  const text = (head, rows) => (rows.length ? [head, ...rows.map((r) => r.text)].join('\n') : '');
  const out = { deep: text(S.deepHead, deep), mid: text(S.midHead, mid), now: text(S.nowHead, fresh) };
  const total = () => estTokens(out.deep, lg) + estTokens(out.mid, lg) + estTokens(out.now, lg);
  while (total() > B.total && deep.length) { deep.pop(); out.deep = text(S.deepHead, deep); }
  return { ...out, rows: [...deep, ...mid, ...fresh], tokens: total() };
}

// The [CURRENT STATE] block of the classifier prompt (not sent to the main model).
export function stateText(st, L) {
  const stage = join(nowDate(st.cal, L), st.cal.tod, st.loc, st.weather, st.mood);
  const people = st.with.map((n) => join(n, st.role?.[n]?.v, st.pos?.[n], st.wear[n]?.v, st.body[n]?.v, st.marks?.[n]?.join(', '), st.items?.[n]?.length ? `+ ${st.items[n].join(', ')}` : '', st.money?.[n]?.v, ...Object.entries(st.stats?.[n] || {}).map(([k, v]) => `${k} ${v}`))).join('\n');
  return [stage, people].filter(Boolean).join('\n') || '-';
}
