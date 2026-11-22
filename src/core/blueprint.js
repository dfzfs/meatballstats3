// Reads the lore sheet (설정집, formerly "blueprint"): one "key: value | extra: value" line each. A bad line is dropped alone.
// Only the classifier sees it — never the main model. Hidden layers ("깊은속") go only to the hidden-layer block.
import { estTokens } from './clean.js';

const KEY = { '인물': 'person', person: 'person', '애정끔': 'noromance', noromance: 'noromance', '사이': 'tie', tie: 'tie', '장벽': 'barrier', barrier: 'barrier',
  '숨김': 'hide', hide: 'hide', '결': 'texture', texture: 'texture', '속': 'inner', inner: 'inner', '아픈곳': 'sore', '아픈 곳': 'sore', sore: 'sore', '깊은속': 'deep', '깊은 속': 'deep', deep: 'deep',
  '세계': 'world', world: 'world', '장소': 'place', place: 'place', '모름': 'unknown', unknown: 'unknown', '통로': 'channel', channel: 'channel',
  '금고': 'vault', vault: 'vault', '본모습': 'self', self: 'self', '선': 'line', line: 'line', '외면': 'avoid', avoid: 'avoid',
  '태도': 'harsh', '혐성': 'harsh', harsh: 'harsh', '빠짐': 'fall', fall: 'fall' };
const EXTRA = { '별칭': 'alias', alias: 'alias', '열림': 'opens', opens: 'opens', '직위': 'role', '신분': 'role', role: 'role', '특징': 'traits', traits: 'traits',
  '성격': 'pers', personality: 'pers', '배경': 'bg', background: 'bg', '옆': 'near', near: 'near',
  '신호': 'signs', '금지신호': 'signs', signs: 'signs', '보임': 'shows', '보여도됨': 'shows', shows: 'shows',
  '덮개': 'cover', cover: 'cover', '풀림': 'release', release: 'release', '한계': 'limit', limit: 'limit', '남음': 'keeps', '간지': 'keeps', keeps: 'keeps' };
const pairOf = (lhs, sep) => { const p = lhs.split(sep).map((x) => x.trim()); return p.length === 2 && p[0] && p[1] ? p : null; };

export const emptyBlueprint = () => ({ world: [], persons: [], places: [], noromance: [], tie: [], barrier: [], hide: [], keep: [], unknown: [], channel: [], vault: [], self: [], line: [], avoid: [], harsh: [], fall: [], warn: [], texture: [], inner: [], sore: [], deep: [], dropped: [], lines: 0 });
export function readBlueprint(text) {
  const bp = emptyBlueprint();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/←.*$/, '').trim();
    if (!line || /^[#\[]/.test(line) || /^\/\//.test(line)) continue;
    const m = line.match(/^([^:：]{1,12})[:：]\s*(.+)$/), k = m && KEY[m[1].trim().toLowerCase()];
    if (!k) { bp.dropped.push({ raw, why: 'key' }); continue; }
    const [main, ...rest] = m[2].split('|').map((x) => x.trim());
    const extra = Object.fromEntries(rest.map((x) => { const e = x.match(/^([^:：]+)[:：]\s*(.+)$/); return e && EXTRA[e[1].trim().toLowerCase()] ? [EXTRA[e[1].trim().toLowerCase()], e[2].trim()] : null; }).filter(Boolean));
    const eq = main.indexOf('='), lhs = (eq < 0 ? main : main.slice(0, eq)).trim(), v = eq < 0 ? '' : main.slice(eq + 1).trim();
    const bad = () => bp.dropped.push({ raw, why: 'form' });
    const list = (s) => String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    if (k === 'world') bp.world.push(m[2].trim().slice(0, 200));
    else if (k === 'person') bp.persons.push({ name: lhs, alias: list(extra.alias), role: extra.role || '', traits: list(extra.traits), pers: extra.pers || '', bg: extra.bg || '' });
    else if (k === 'place') bp.places.push({ path: lhs, near: extra.near || '' });
    else if (k === 'noromance') bp.noromance.push(lhs);
    // 숨김 has two forms: "A-B → C" (the pair hides their relationship from C) and "A>B = what" (A keeps what from B)
    else if (k === 'hide' && eq > 0 && pairOf(lhs, '>')) { const p = pairOf(lhs, '>'); if (v) bp.keep.push({ a: p[0], b: p[1], v }); else { bad(); continue; } }
    else if (k === 'hide') { const h = main.split(/→|->/).map((x) => x.trim()), p = h.length === 2 && pairOf(h[0], '-'); if (p) bp.hide.push({ a: p[0], b: p[1], c: h[1] }); else { bad(); continue; } }
    // 모름: who = what nobody knows yet (the writer has not decided either) · 통로: who = where that person's feeling leaks
    else if (k === 'unknown' || k === 'channel') { if (lhs && v) bp[k].push({ who: lhs, v }); else { bad(); continue; } }
    // v0.8 금고: who (or A-B) = what must stay hidden | 신호: words that give it away | 보임: what may show | 열림: when
    // v0.9: | 덮개: what those around take it for (a cover story the main model gets instead of a gap to fill)
    else if (k === 'vault') { if (lhs && v) bp.vault.push({ who: lhs, v, signs: list(extra.signs), shows: extra.shows || '', cover: extra.cover || '', opens: extra.opens || '' }); else { bad(); continue; } }
    // 본모습: who = what that person used to be like (sparks) · 선: who = what that person will not let pass (refusal) | 풀림: when it may pass
    else if (k === 'self') { if (lhs && v) bp.self.push({ who: lhs, v }); else { bad(); continue; } }
    else if (k === 'line') { if (lhs && v) bp.line.push({ who: lhs, v, release: extra.release || '' }); else { bad(); continue; } }
    // v0.9 외면: B>A = why B does not dig into A's secret (a motive, not a ban)
    // v0.9 태도: A>B = A's attitude toward B | 한계: the line it never crosses · 빠짐: A>B = how A shows it once fallen | 열림 | 남음
    else if (k === 'harsh') { const p = pairOf(lhs, '>'); if (p && v) bp.harsh.push({ a: p[0], b: p[1], v, limit: extra.limit || '' }); else { bad(); continue; } }
    else if (k === 'fall') { const p = pairOf(lhs, '>'); if (p && v) bp.fall.push({ a: p[0], b: p[1], how: v, opens: extra.opens || '', keeps: extra.keeps || '' }); else { bad(); continue; } }
    else if (k === 'avoid') { const p = pairOf(lhs, '>'); if (p && v) bp.avoid.push({ b: p[0], a: p[1], v }); else { bad(); continue; } }
    else if (k === 'tie' || k === 'barrier') { const p = pairOf(lhs, '-'); if (p && v) bp[k].push({ a: p[0], b: p[1], v }); else { bad(); continue; } }
    else if (k === 'deep') { const p = pairOf(lhs, '>'); if (v && lhs) bp.deep.push({ id: `${lhs}#${bp.deep.length}`, who: p ? p[0] : lhs, to: p ? p[1] : '', content: v, opens: extra.opens || '' }); else { bad(); continue; } }
    else { const p = pairOf(lhs, '>'); if (p && v) bp[k].push({ a: p[0], b: p[1], v }); else { bad(); continue; } }
    bp.lines++;
  }
  // v0.9: a "may show" / cover / avoid value that holds a sign word would undo the vault: warn on screen (it is still read)
  const signs = bp.vault.flatMap((x) => x.signs.map((g) => String(g).toLowerCase()).filter((g) => g.length >= 2));
  const leaky = (t) => signs.find((g) => String(t || '').toLowerCase().includes(g));
  for (const x of bp.vault) for (const f of ['shows', 'cover']) { const g = leaky(x[f]); if (g) bp.warn.push({ who: x.who, field: f, sign: g }); }
  for (const x of bp.avoid) { const g = leaky(x.v); if (g) bp.warn.push({ who: x.b, field: 'avoid', sign: g }); }
  // any other value that reaches the main model (those lines would be dropped by the firewall without a word)
  for (const [f, list] of [['unknown', bp.unknown], ['hide', bp.keep], ['inner', bp.inner], ['self', bp.self], ['channel', bp.channel], ['texture', bp.texture], ['tie', bp.tie], ['harsh', bp.harsh], ['fall', bp.fall.map((x) => ({ ...x, v: `${x.how} ${x.keeps}` }))]]) for (const x of list) { const g = leaky(x.v); if (g) bp.warn.push({ who: x.who || x.a, field: f, sign: g }); }
  return bp;
}

// Two cuts of one sheet. Surface (every reply): world + who is who + lasting traits. Deep (relationship reading): + character and ties.
// Hidden layers never appear here.
function capLines(head, lines, max, lg) {
  const out = [];
  for (const l of lines) { if (estTokens([head, ...out, l].join('\n'), lg) > max) break; out.push(l); }
  return out.length ? `${head}\n${out.join('\n')}\n\n` : '';
}
export function loreSurface(bp, L, lg, max = 150) {
  if (!bp) return '';
  const W = L.lore, lines = [...bp.world.slice(0, 1).map((w) => `${W.world}: ${w}`),
    ...bp.persons.map((p) => [p.name + (p.alias.length ? ` (${p.alias.join(', ')})` : ''), p.role, p.traits.join(', ')].filter(Boolean).join(' · '))];
  return capLines(W.head, lines, max, lg);
}
export function loreDeep(bp, L, lg, max = 400) {
  if (!bp) return '';
  const W = L.lore, lines = [...bp.world.slice(0, 2).map((w) => `${W.world}: ${w}`),
    ...bp.persons.map((p) => [p.name + (p.alias.length ? ` (${p.alias.join(', ')})` : ''), p.role, p.traits.join(', '), p.pers, p.bg].filter(Boolean).join(' · ')),
    ...bp.tie.map((x) => `${x.a}–${x.b}: ${x.v}`), ...bp.barrier.map((x) => `${x.a}–${x.b}: ${W.barrier} ${x.v}`), ...bp.sore.map((x) => `${x.a} → ${x.b}: ${W.sore} ${x.v}`)];
  return capLines(W.headDeep, lines, max, lg);
}
// Names and aliases from the sheet: seeds for the name dictionary.
export const loreNames = (bp) => (bp?.persons || []).map((p) => ({ name: p.name, alias: p.alias }));
