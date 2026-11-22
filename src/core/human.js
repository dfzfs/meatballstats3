// v0.9 steps 2-3: lines that make a character act like a person — harsh attitude, the lead switch, one warmer
// remark, old small things remembered (seeds) and offhand care, and falling for someone once the story has earned it.
// Everything here is counted inside Meatball from quoted records (folded per reply); only plain "may" lines go out.
import { runLength, words, ROMANCE, BREAK } from './ledger2.js';

const fill = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : m));
const key2 = (a, b) => [a, b].sort().join('|');

// ---------------------------------------------------------------------------------------------------------------
// The story so far between two people, as kinds of events (not counts: the same thing again is not more story).
// Folded in chat order from stored events. Returns { 'A|B': { kinds: Set, firstDay, replies } }.
export function foldArc(chat, ev, rel, fingerprint) {
  const arc = {}, seen = {}, ai = (chat || []).filter((m) => !m.is_user && !m.is_system);
  const get = (a, b) => (arc[key2(a, b)] ||= { kinds: new Set(), firstDay: null, firstAt: null, closerDays: new Set(), clash: false, touch: 0, inner: new Set() });
  ai.forEach((m, i) => {
    const fp = fingerprint(m);
    for (const e of rel?.[fp] || []) {
      if (!e.a || !e.b) { if (e.k === 'open' && e.id) seen[e.id] = true; continue; }
      const x = get(e.a, e.b);
      if (x.firstDay == null) { x.firstDay = e.day ?? 0; x.firstAt = i; }
      if (e.k === 'mv') {
        if (e.mv === 0) { x.closerDays.add(e.day ?? 0); if (x.clash) x.kinds.add('clashBack'); if (x.closerDays.size >= 2) x.kinds.add('days'); }
        if (e.mv === 4) { x.clash = true; if (x.inner.has(`${e.a}>${e.b}`)) x.kinds.add('burst'); }
        if (e.inner) x.inner.add(`${e.a}>${e.b}`);
      }
    }
    for (const e of ev?.[fp] || []) {
      const pair = e.a && e.b ? [e.a, e.b] : null;
      if (e.k === 'touch' && pair) { const x = get(...pair); if (x.firstDay == null) { x.firstDay = 0; x.firstAt = i; } if ((+e.v || 0) > x.touch) { if (x.touch) x.kinds.add('touch'); x.touch = +e.v || 0; } }
      if ((e.k === 'owe' || e.k === 'promise') && pair) get(...pair).kinds.add('debt');
      if (e.k === 'aside' && pair) get(...pair).kinds.add('aside');
      if (e.k === 'lead' && !e.byUser) for (const x of Object.entries(arc)) if (x[0].split('|').includes(e.who)) x[1].kinds.add('lead');
    }
  });
  for (const x of Object.values(arc)) x.replies = x.firstAt == null ? 0 : ai.length - x.firstAt;
  return arc;
}

// Falling (빠짐) state per lore line: open only when all three keys fit — the person's written condition (quoted gate),
// enough story (kinds, days, replies; inside Meatball only) and the person's own confirmation (or the auto setting).
// A broken tie (breakup, enemies, quoted) after it opened closes it; opening again needs new story after that.
export function foldFall(bp, st1, st2, arcs, S, chat, fingerprint, o = {}) {
  const out = [], dec = {};
  for (const m of chat || []) { if (m.is_user || m.is_system) continue; for (const d of S?.fdec?.[fingerprint(m)] || []) dec[`${d.a}>${d.b}`] = d.open; }
  for (const f of bp?.fall || []) {
    const arc = arcs[key2(f.a, f.b)] || { kinds: new Set(), firstDay: null, replies: 0 };
    const days = arc.firstDay == null ? 0 : (st1.cal?.n ?? 0) - arc.firstDay;
    const min = { kinds: f.opens ? (o.kinds || 4) : (o.kindsNoGate || 6), days: o.days ?? 14, replies: o.replies ?? 60 };
    const code = arc.kinds.size >= min.kinds && days >= min.days && arc.replies >= min.replies;
    const gate = !f.opens || !!st2?.open?.[`fall:${f.a}>${f.b}`];
    const tie = st2?.tie?.[key2(f.a, f.b)], broken = !!(tie && BREAK.test(tie.v));
    const confirmed = dec[`${f.a}>${f.b}`];
    const ready = code && gate && !broken;
    const open = ready && (confirmed === true || (o.auto && confirmed !== false));
    out.push({ ...f, open, ready, need: confirmed == null && ready && !o.auto, kinds: [...arc.kinds], days, replies: arc.replies, gate, code, broken });
  }
  return out;
}

// The rows. opts: { user, cue, tail (end of the last reply), lover(a,b), marks (Map mark->replies ago), count(mark, within),
//   rare (gap multiplier), jitter (0..3 from the last reply), busy (Set of people with an event line this reply),
//   crossed (Set: crossed a limit in the last reply), lost (Set: lost their manner twice lately), falls (foldFall),
//   lastRel (rel events of the last reply), vaultClosed (Set of people with a closed vault), threads }
export function rows4(st1, st2, bp, L, o = {}) {
  const R = L.rel, here = st1.with || [], now = [], deep = [], gn = st1.gn || 0, rare = o.rare || 1;
  if (!bp) return { now, deep };
  const row = (kind, text, extra = {}) => now.push({ layer: 'now', kind, text: `- ${text}`, src: 'v09b', ...extra });
  const bg = (kind, text) => deep.push({ layer: 'deep', kind, text: `- ${text}`, src: 'v09b' });
  const both = (a, b) => here.includes(a) && here.includes(b);
  const ago = (m) => o.marks?.get(m) ?? 99;
  const lover = o.lover || (() => false), busy = o.busy || new Set();
  const today = st1.cal?.n ?? 0;
  const rested = (a, b) => [st2?.dir?.[`${a}>${b}`], st2?.dir?.[`${b}>${a}`]].some((d) => d?.clashDay != null && today - d.clashDay < 3);
  const hidden = (a, b) => (bp.hide || []).some((x) => key2(x.a, x.b) === key2(a, b) && here.includes(x.c));
  const third = (a, b) => here.some((n) => n !== a && n !== b);
  const falls = (o.falls || []).filter((f) => f.open && both(f.a, f.b));
  const fallen = (a, b) => falls.some((f) => f.a === a && f.b === b);
  const runOf = (a, b) => runLength(st1.hist, (w) => w.includes(a) && w.includes(b));

  // ---- harsh (혐성): attitude in the background; "need not go along" only after going along too easily lately
  for (const x of bp.harsh || []) {
    if (!both(x.a, x.b)) continue;
    bg('harshBg', fill(R.harshBg, { a: x.a, b: x.b, edge: x.v }) + (x.limit && R.harshLimit ? fill(R.harshLimit, { a: x.a, limit: x.limit }) : ''));
    if (lover(x.a, x.b) || rested(x.a, x.b) || fallen(x.a, x.b) || busy.has(x.a)) continue;
    if (o.crossed?.has(x.a)) { row('harshAfter', fill(R.harshAfter, { a: x.a }), { mark: `harshAfter:${x.a}` }); continue; }
    if (ago(`harshAfter:${x.a}`) < 4 || ago(`harsh:${x.a}`) < 2) continue;
    const own = new Set(words(x.v)), lines = new Set([...(bp.line || []).filter((l) => l.who === x.a).flatMap((l) => words(l.v))]);
    const yieldP = (st1.yields || []).filter((y) => y.a === x.a && y.b === x.b && gn - y.g <= 6).reduce((s, y) => s + (words(y.v).some((w) => own.has(w) || lines.has(w)) || (st1.refused || []).some((r) => r.a === x.a && words(r.v).some((w) => y.v.includes(w))) ? 1 : 0.5), 0);
    const closer = (st2?.dir?.[`${x.a}>${x.b}`]?.moves || []).filter((m) => m === 0).length * 0.5;
    const pushedBack = (st1.refused || []).filter((r) => r.a === x.a && gn - r.g <= 6).length;
    if (yieldP + closer - pushedBack >= 2) row('harsh', fill(R.harshA, { a: x.a, b: x.b }), { mark: `harsh:${x.a}` });
    else if (runOf(x.a, x.b) <= 1) row('harshStart', fill(R.harshStart, { a: x.a, b: x.b }), { mark: `harsh:${x.a}` });
  }

  // ---- lead switch (주도 전환): after a long stretch led by the person (or by their hidden instruction)
  const people = here.filter((n) => n !== o.user);
  for (const a of people) {
    const others = here.filter((n) => n !== a), b = others.includes(o.user) ? o.user : others[0];
    if (!b || busy.has(a) || rested(a, b) || hidden(a, b)) continue;
    const mine = (st1.leads || []).filter((l) => l.who === a && !l.byUser).at(-1);
    const from = mine ? mine.g : (st1.hist || []).find((h) => h.with.includes(a))?.gn ?? gn;
    const span = gn - from;
    const theirs = new Set((st1.leads || []).filter((l) => l.g > from && (l.who === o.user || l.byUser)).map((l) => l.g));
    const want = st2?.dir?.[`${a}>${b}`]?.inner || st2?.dir?.[`${a}>${b}`]?.tex != null || (bp.inner || []).concat(bp.texture || []).some((x) => x.a === a && x.b === b);
    const back = (st2?.dir?.[`${a}>${b}`]?.moves || []).slice(-2).includes(1);
    const pressed = (o.threads || []).some((t) => t.a === a && t.mode === 'press');
    if (!want || back || pressed || theirs.size < 2) continue;
    const tries = o.count?.(`lead:${a}`, span + 1) || 0;
    const need = Math.round((tries >= 2 ? 16 : 8) * rare);
    if (span < need || ago(`lead:${a}`) < 4) continue;
    row('lead', fill(tries ? R.leadB : R.leadA, { a, b }), { mark: `lead:${a}` });
    break;
  }

  // ---- one remark a shade warmer than the tie allows (한 뼘): rare, after a scene change, never right after a tie change
  for (const a of people) {
    for (const b of here.filter((n) => n !== a)) {
      const d = st2?.dir?.[`${a}>${b}`], warm = (d?.tex != null && (ROMANCE.includes(d.tex) || d.tex === 6)) || (bp.texture || []).some((x) => x.a === a && x.b === b);
      if (!warm || lover(a, b) || hidden(a, b) || busy.has(a) || rested(a, b)) continue;
      const lastRec = (st1.asides || []).filter((x) => x.a === a && x.b === b).at(-1), since = Math.min(ago(`aside:${a}>${b}`), lastRec ? gn - lastRec.g : 99);
      const gap = Math.round(10 * rare) + (o.jitter || 0);
      const cut = (st1.hist || []).slice(-Math.min(since, 80)).some((h) => h.cut);
      const tieNew = st2?.tie?.[key2(a, b)] && today - (st2.tie[key2(a, b)].day ?? -99) < 3;
      if (since < gap || !cut || tieNew) continue;
      const tie = st2?.tie?.[key2(a, b)]?.v || (bp.tie || []).find((x) => key2(x.a, x.b) === key2(a, b))?.v || R.tieDefault;
      row('aside', fill(R.asideA, { a, b, tie }), { mark: `aside:${a}>${b}` });
    }
  }

  // ---- seeds (기억 씨앗): small old things, brought back only when old enough and the scene echoes them; offhand care
  const ctxWords = new Set(words([o.cue, o.tail, st1.loc, st1.weather, ...Object.values(st1.items || {}).flat()].filter(Boolean).join(' ')));
  const seeds = st1.seeds || [], common = (w) => seeds.filter((s) => words(`${s.v} ${s.q}`).includes(w)).length > 1;
  const tied = (n, b) => [`${n}>${b}`, `${b}>${n}`].some((k) => st2?.dir?.[k]?.tex != null) || (bp.texture || []).some((x) => (x.a === n && x.b === b) || (x.a === b && x.b === n));   // texture either way
  for (const s of seeds) {
    const b = s.who, a = here.find((n) => n !== b && tied(n, b));
    if (!a || !here.includes(b) || o.marks?.has(`seed:${b}:${s.v}`)) continue;
    if (today - (s.day ?? today) < (o.seedDays ?? 7) || gn - s.g < (o.seedReplies ?? 40)) continue;
    if (Math.min(...[...(o.marks?.keys() || [])].filter((k) => k.startsWith('seed:') || k.startsWith('care:')).map((k) => ago(k)), 99) < Math.round(15 * rare)) break;
    const sw = words(`${s.v} ${s.q}`), hit = sw.filter((w) => ctxWords.has(w));
    if (hit.length >= 2 || hit.some((w) => !common(w))) { bg('seedBg', fill(R.seedBg, { b, seed: s.v })); row('seed', fill(R.seedC, { a, b }), { mark: `seed:${b}:${s.v}` }); break; }
  }
  for (const b of here) {
    const body = st1.body?.[b], a = here.find((n) => n !== b && n !== o.user && tied(n, b));
    if (!a || !body || body.brief || gn - (body.g ?? gn) < 2 || o.marks?.has(`care:${b}:${body.v}`)) continue;
    if (Math.min(...[...(o.marks?.keys() || [])].filter((k) => k.startsWith('seed:') || k.startsWith('care:')).map((k) => ago(k)), 99) < Math.round(15 * rare)) break;
    row('care', fill(R.care, { a, b, state: body.v }), { mark: `care:${b}:${body.v}` });
    break;
  }

  // ---- fallen (빠짐): the base line takes the leak line's place; collapse · pull · receive are rare specials
  for (const f of falls) {
    const keeps = f.keeps || fill(R.keepsDefault, { a: f.a });
    bg('fallBg', fill(R.fallBg, { a: f.a, b: f.b, keeps }));
    if (rested(f.a, f.b)) continue;
    const k = runOf(f.a, f.b);
    if (k <= 1 || (k - 1) % 3 === 0) row('fallBase', fill(R.fallBase, { a: f.a, b: f.b, how: f.how, keeps }));
    if (o.lost?.has(f.a)) { row('regroup', fill(R.regroup, { a: f.a }), { mark: `regroup:${f.a}` }); continue; }
    if (third(f.a, f.b) || ago(`regroup:${f.a}`) < 6) continue;
    const last = (o.lastRel || []).filter((e) => e.a === f.b && e.b === f.a && e.k === 'mv').map((e) => e.mv);
    const before = st2?.dir?.[`${f.b}>${f.a}`]?.moves || [];
    if (last.includes(1) && !o.marks?.has(`pull:${f.a}:${o.lastFp}`)) row('fallPull', fill(R.fallPull, { a: f.a, b: f.b }), { mark: `pull:${f.a}:${o.lastFp}` });
    else if (last.includes(0) && before.slice(-2, -1)[0] === 1 && ago(`receive:${f.a}`) >= 6) row('fallReceive', fill(R.fallReceive, { a: f.a, b: f.b }), { mark: `receive:${f.a}` });
    else if (last.includes(0) && !o.vaultClosed?.has(f.a) && ago(`collapse:${f.a}`) >= Math.round(6 * rare)) row('fallCollapse', fill(R.fallCollapse, { a: f.a, b: f.b }), { mark: `collapse:${f.a}` });
  }
  return { now, deep };
}
