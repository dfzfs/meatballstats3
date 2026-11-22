// Stage 1 ledger: how each event changes "now". Pure data in, pure data out.
import { newCal, applyDate, dateAt, FUZZY_NOM } from './time.js';
import { newDict, learn, addAlias, resolve } from './names.js';

export const newState = () => ({
  cal: newCal(), loc: '', weather: '', mood: '', with: [], wear: {}, body: {}, gone: {}, pos: {}, items: {}, marks: {}, places: {}, slips: {}, facts: [],
  know: [], promise: [], pair: {}, role: {}, lies: [], owes: [], refused: [], yields: [], presses: [], leads: [], asides: [], seeds: [], money: {}, stats: {}, names: newDict(), notes: [], fresh: null, classified: false, hadEvents: false, gn: 0, posG: {}, itemsG: {}, hist: [],
});
const pairOf = (st, a, b) => (st.pair[[a, b].sort().join('|')] ||= { a, b, tie: '', call: {}, touch: null });
const cap = (arr, n) => { while (arr.length > n) arr.shift(); };

function setDate(st, date, force, maxJump) {
  const before = dateAt(st.cal), r = applyDate(st.cal, date, force, maxJump);
  if (r === 'kept') st.notes.push({ day: st.cal.n, text: date, engine: before });   // the story wrote an older date: the engine wins
  cap(st.notes, 10);
  st.fresh?.dates.push({ r, text: date, before, after: dateAt(st.cal), force: !!force });
}

// One group = the events of one classified batch.
export function applyGroup(st, events, V) {
  const day0 = st.cal.n, was = dateAt(st.cal), had = [...st.with], first = !st.hadEvents;   // empty groups (replies before install) don't count
  st.classified = true; if (events.some((e) => e.k !== 'dir' && e.k !== 'drop')) st.hadEvents = true;
  st.gn = (st.gn || 0) + 1;   // reply counter: the signpost repeats a prop only right after it changed
  st.fresh = { passed: 0, was, arrived: [], fixes: [], cut: false, dates: [], slips: [] };
  const N = (n) => resolve(st.names, n, V) || learn(st.names, n, V);
  // a date may jump far ahead only when this reply also says a long time passed ("months later", "the next spring")
  const longSkip = events.some((e) => e.k === 'time' && ((e.days || 0) >= 30 || e.fuzzy === 'mo' || e.fuzzy === 'y')), maxJump = longSkip ? 275 : 120;
  for (const e of events) if (e.k === 'alias') addAlias(st.names, e.who, e.v, V);
  const mentioned = new Set();
  for (const e of events) for (const n of [e.who, e.a, e.b, ...(e.add || [])]) if (n) mentioned.add(resolve(st.names, n, V) || n);
  for (const n of mentioned) learn(st.names, n, V);
  for (const e of events) {
    const day = st.cal.n;
    switch (e.k) {
      case 'cut': st.fresh.cut = true; st.pos = {}; st.weather = ''; st.mood = ''; break;   // scene-bound things end with the scene
      case 'pos': st.pos[N(e.who)] = e.v; (st.posG ||= {})[N(e.who)] = st.gn; break;
      case 'mark': { const n = N(e.who), m = (st.marks[n] ||= []); if (!m.includes(e.v)) m.push(e.v); cap(m, 6); break; }
      case 'item': { const n = N(e.who), it = (st.items[n] ||= []), i = it.findIndex((x) => x.toLowerCase() === e.v.toLowerCase());
        if (e.sign === '-') { if (i >= 0) it.splice(i, 1); } else if (i < 0) it.push(e.v); cap(it, 8); (st.itemsG ||= {})[n] = st.gn; break; }
      case 'near': { const a = (st.places[e.a] ||= { up: '', near: {} }); a.near[`${e.rel}:${e.b}`] = { rel: e.rel, b: e.b, q: e.q }; st.places[e.b] ||= { up: '', near: {} }; break; }
      case 'slip': { const n = N(e.who), key = `${n}|${e.v.toLowerCase()}`, s = (st.slips[key] ||= { who: n, v: e.v, count: 0, q: e.q });
        s.count++; s.q = e.q; s.day = day; st.fresh.slips.push(s);
        if (s.count >= 2 && !st.facts.some((f) => f.key === key)) { st.facts.push({ key, who: n, v: e.v }); cap(st.facts, 8); }
        break; }
      case 'time': {
        if (e.fuzzy) {                                     // "a few days later": a placeholder length, no date until the text names one
          const nom = FUZZY_NOM[e.fuzzy] || FUZZY_NOM.d;
          if (!st.cal.fz) st.cal.fz = { from: st.cal.n, unit: e.fuzzy, nom }; else st.cal.fz.nom += nom;
          st.cal.n += nom; st.fresh.fuzzy = e.fuzzy;
        } else st.cal.n += e.days || 0;
        if (e.tod || e.days || e.fuzzy) st.cal.tod = e.tod || '';
        if (e.date) setDate(st, e.date, false, maxJump); break; }
      case 'date': setDate(st, e.date, e.force, maxJump); break;
      case 'loc': {
        const path = e.v.split(/\s*(?:>|→|›)\s*/).map((x) => x.trim()).filter(Boolean);
        for (let i = 0; i < path.length; i++) { const p = (st.places[path[i]] ||= { up: '', near: {} }); if (i > 0) p.up = path[i - 1]; }
        st.loc = e.v; break; }
      case 'weather': case 'mood': st[e.k] = e.v; break;
      case 'with': {
        if (e.full) st.with = [];
        for (const n of e.del.map(N)) { st.with = st.with.filter((x) => x !== n); delete st.pos[n]; }
        for (const n of e.add.map(N)) {
          if (st.gone[n] && st.gone[n].v !== 'believed') { if (!st.fresh.fixes.includes(n)) st.fresh.fixes.push(n); continue; }   // the dead stay dead
          if (!st.with.includes(n)) st.with.push(n);
        }
        break; }
      case 'wear': { const n = N(e.who), w = st.wear[n];
        if (!e.delta || !w || w.day !== day) { st.wear[n] = { v: e.delta ? e.v : e.v.replace(/\s*·\s*/g, ', '), day, g: st.gn }; if (!e.delta) break; if (!w || w.day !== day) break; }
        // put on / take off, piece by piece, on the same story day
        const key = (x) => x.replace(/^[+\-]\s*/, '').replace(/\s*\(.*$/, '').replace(/\s+(off|on|벗음|입음)$/i, '').trim().toLowerCase();
        let pieces = w.v.split(/\s*[,·]\s*/).filter(Boolean);
        for (const d of e.v.split(/\s*,\s*(?=[+\-])/)) {
          const k = key(d);
          pieces = pieces.filter((p) => !(key(p).includes(k) || k.includes(key(p))));
          pieces.push(d.trim().startsWith('-') ? d.trim() : d.trim().replace(/^\+\s*/, ''));
        }
        st.wear[n] = { v: pieces.slice(-6).join(', '), day, g: st.gn }; break; }
      case 'body': if (e.healed) delete st.body[N(e.who)]; else st.body[N(e.who)] = { v: e.v, day: first ? null : day, brief: !!e.brief, g: st.gn }; break;   // first reading: when it began is unknown
      case 'gone': { const n = N(e.who); if (!st.gone[n] || e.force) st.gone[n] = { v: e.v, q: e.q, day }; if (e.v !== 'believed') st.with = st.with.filter((x) => x !== n); break; }
      case 'know': {
        const key = e.v.toLowerCase().slice(0, 40), n = N(e.who);
        const k = st.know.find((x) => x.key === key) || (st.know.push({ key, what: e.v, who: [], day }), st.know.at(-1));
        if (!k.who.includes(n)) k.who.push(n);
        cap(st.know, 12); break; }
      case 'promise': {
        const a = N(e.a), b = N(e.b);
        st.promise = st.promise.filter((p) => !(p.a === a && p.b === b && p.v === e.v));
        st.promise.push({ a, b, v: e.v, day }); cap(st.promise, 8); break; }
      case 'call': { const a = N(e.a), b = N(e.b); pairOf(st, a, b).call[`${a}>${b}`] = e.v; break; }
      case 'touch': { const p = pairOf(st, N(e.a), N(e.b)); if (!p.touch || e.v > p.touch.lvl) p.touch = { lvl: e.v, day }; break; }
      case 'tie': pairOf(st, N(e.a), N(e.b)).tie = e.v; break;
      case 'role': st.role[N(e.who)] = { v: e.v, day }; break;
      case 'lie': case 'owe': {
        const a = N(e.a), b = N(e.b), list = e.k === 'lie' ? st.lies : st.owes, low = e.v.toLowerCase();
        const same = (x) => x.a === a && x.b === b && (x.v.toLowerCase().includes(low.slice(0, 12)) || low.includes(x.v.toLowerCase().slice(0, 12)));
        if (e.off) { const x = list.find((y) => same(y) && !y.out); if (x) { x.out = true; x.outDay = day; } }
        else if (!list.some((y) => same(y) && !y.out)) { list.push({ a, b, v: e.v, q: e.q || '', day, out: false }); cap(list, 12); }
        break; }
      case 'refuse': { st.refused.push({ a: N(e.a), b: N(e.b), v: e.v, q: e.q || '', day, g: st.gn, out: false }); cap(st.refused, 8); break; }
      // v0.9 step 2: kept with the reply counter (g) so the note can tell how recent they are
      case 'yield': st.yields.push({ a: N(e.a), b: N(e.b), v: e.v, q: e.q || '', g: st.gn, day }); cap(st.yields, 12); break;
      case 'press': st.presses.push({ a: N(e.a), b: N(e.b), v: e.v, q: e.q || '', g: st.gn, day }); cap(st.presses, 12); break;
      case 'lead': st.leads.push({ who: N(e.who), v: e.v, g: st.gn, day, byUser: !!e.byUser }); cap(st.leads, 20); break;
      case 'aside': st.asides.push({ a: N(e.a), b: N(e.b), v: e.v, g: st.gn, day }); cap(st.asides, 8); break;
      case 'seed': { const n = N(e.who), w = e.v.toLowerCase(); st.seeds = st.seeds.filter((x) => !(x.who === n && w.split(/\s+/).some((t) => t.length >= 3 && x.v.toLowerCase().includes(t)))); st.seeds.push({ who: n, v: e.v, q: e.q || '', g: st.gn, day }); cap(st.seeds, 24); break; }   // a later seed with the same word replaces the old
      // v0.9: the person closed a refusal thread (button); stored on the reply it was closed after, so undoing that reply reopens it
      case 'unrefuse': { const x = st.refused.find((r) => !r.out && r.a === N(e.a) && r.b === N(e.b) && r.v === e.v); if (x) x.out = true; break; }
      case 'money': {
        const n = N(e.who), cur = st.money[n], m = e.v.match(/^([=+\-])?\s*([\d,.]+)\s*(.*)$/);
        if (m && (m[1] === '+' || m[1] === '-') && cur?.num != null && (!m[3] || m[3] === cur.unit)) { const x = cur.num + (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(/,/g, '')); st.money[n] = { num: x, unit: cur.unit, v: `${x} ${cur.unit}`.trim(), day }; }
        else if (m && m[1] !== '+' && m[1] !== '-') { const x = parseFloat(m[2].replace(/,/g, '')); st.money[n] = { num: x, unit: m[3].trim(), v: `${x} ${m[3].trim()}`.trim(), day }; }
        else st.money[n] = { num: null, unit: '', v: e.v.replace(/^=\s*/, ''), day };
        break; }
      case 'stat': { const n = N(e.who); (st.stats[n] ||= {})[e.item] = e.v; break; }
    }
  }
  // who was in the scene after each reply (for the rhythm of the shallow layer: a line comes when a situation starts, then every few replies)
  (st.hist ||= []).push({ gn: st.gn, with: [...st.with], cut: !!st.fresh.cut }); cap(st.hist, 80);
  st.fresh.passed = first ? 0 : st.cal.n - day0;
  if (first) st.fresh.fuzzy = '';   // the first reading has no "previous scene"
  if (!st.fresh.cut && had.length) st.fresh.arrived = st.with.filter((n) => !had.includes(n));
  return st;
}
