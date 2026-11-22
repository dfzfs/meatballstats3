// Batches: which replies are waiting to be sorted, and the text that goes to the classifier.
import { cleanText, fingerprint, langOf } from './clean.js';
import { knownNames } from './names.js';
import { parse, brokenKind, toEvents } from './parse.js';
import { stateText } from './signpost.js';
import { relInputs, toRelEvents, parseRel } from './ledger2.js';
import { keysBlock, activeKeys } from './keys.js';
import { loreSurface, loreDeep } from './blueprint.js';

export const DEFAULTS = { minChars: 1500, maxReplies: 3, maxIn: 60000, catchUp: 40000 };

// Returns null when nothing waits. { text, fps, ready, catchUp }: fps = fingerprints of the waiting replies (events attach to the last).
// dirs: { fingerprint: hidden instruction that produced that reply } — put just before the reply as <director>…</director>.
export function pending(chat, ev, cfg = DEFAULTS, dirs = null) {
  const rows = chat.map((m, i) => ({ m, i, t: m.is_system ? '' : cleanText(m.mes) })).filter((r) => r.t);
  const ai = rows.filter((r) => !r.m.is_user);
  // 「처음부터 정리」: the next few unread replies from the start, in order (the text stays under maxIn)
  if (cfg.fill) {
    const lo = cfg.from ?? 0, hi = cfg.to ?? Infinity, todo = ai.filter((r) => r.i >= lo && r.i <= hi && !ev[fingerprint(r.m)]);
    if (!todo.length) return null;
    let before = -1; for (const r of ai) if (r.i < todo[0].i && ev[fingerprint(r.m)]) before = r.i;
    const pick = []; let n = 0;
    for (const r of todo) { if (pick.length >= cfg.fill || (pick.length && n + r.t.length > cfg.maxIn)) break; pick.push(r); n += r.t.length; }
    const picked = new Set(pick.map((r) => r.i));
    // every picked reply starts with its number, so each line of the answer can go back to the reply it happened in
    const wrapF = (r) => (r.m.is_user ? `<user>${r.t}</user>` : `${picked.has(r.i) ? `[#${r.i}]\n` : ''}${dirs?.[fingerprint(r.m)]?.t ? `<director>${String(dirs[fingerprint(r.m)].t).trim()}</director>\n\n${r.t}` : r.t}`);
    const text = rows.filter((r) => r.i > before && r.i <= pick.at(-1).i).map(wrapF).join('\n\n').slice(-cfg.maxIn);
    return { text, fps: pick.map((r) => fingerprint(r.m)), ids: pick.map((r) => r.i), catchUp: false, ready: true, fill: true, start: before + 1 };
  }
  let lastDone = -1;
  for (const r of ai) if (ev[fingerprint(r.m)]) lastDone = r.i;
  const wait = ai.filter((r) => r.i > lastDone);
  if (!wait.length) return null;
  const waiting = new Set(wait.map((r) => r.i));
  const dirOf = (r) => (dirs && waiting.has(r.i) ? String(dirs[fingerprint(r.m)]?.t || '').trim() : '');
  const wrap = (r) => (r.m.is_user ? `<user>${r.t}</user>` : dirOf(r) ? `<director>${dirOf(r)}</director>\n\n${r.t}` : r.t);
  // Too many unread replies (first install on a long chat, or switched back on): read only the tail once.
  const catchUp = wait.length > cfg.maxReplies;
  const from = catchUp ? 0 : lastDone;
  const text = rows.filter((r) => r.i > from && r.i <= wait.at(-1).i).map(wrap).join('\n\n').slice(-(catchUp ? cfg.catchUp : cfg.maxIn));
  const own = wait.reduce((a, r) => a + r.t.length, 0);
  return { text, fps: wait.map((r) => fingerprint(r.m)), catchUp, ready: catchUp || own >= cfg.minChars || wait.length >= cfg.maxReplies };
}

// The classifier prompt for one batch. `prompts` = { ko, en } surface prompt texts.
// opts: groups (switched-on key groups), bp (lore sheet), notPeople (title / director names), lang ('en' | 'ko' to force).
const FILL_DATES = {
  ko: `[처음부터 정리: 날짜는 꼭]
지난 답 여러 개를 이어 붙인 글이다. 이번에는 날짜 · 시간을 비워 두지 않는 게 중요한 일이다. 이 항목은 규칙 1 · 14보다 앞선다.
- [지금 상태]에 날짜가 없으면 date를 반드시 적는다. 글의 요일 · 계절 · 명절 · 날씨 · 학기 · 옷차림 단서로 그럴듯한 날을 고른다(눈 → 12월 중순, 벚꽃 → 4월 초). 단서가 하나도 없어도 날을 하나 골라 적는다.
- 글 안에서 날이 바뀌면(다음 날 · 아침이 밝았다 · 자고 일어남 · 주말이 지나) 반드시 time: +1d 처럼 며칠인지 적는다. 여러 번 바뀌면 모두 더한 값.
- 얼마나 지났는지 흐릿해도 비우지 말고 time: +?d / +?w / +?mo 를 적는다.
[답 번호] 글 속 답마다 앞에 [#번호]가 있다. <mb> 안의 줄마다 그 일이 일어난 답의 번호를 맨 앞에 붙인다. 답 순서대로 적는다.
예: #12 date: 3월 2일 / #12 loc: 학교 / #14 time: +1d 아침 / #15 with: 지호
`,
  en: `[Rebuild from the start: dates matter]
This is several old replies joined together. This time, leaving date and time empty is the mistake to avoid. This overrides rules 1 and 14.
- If [CURRENT STATE] has no date, you must write date. Pick a plausible day from clues (weekday, season, holiday, weather, school term, clothes: snow → mid December, cherry blossoms → early April). With no clue at all, still pick a day.
- When the day changes in the text (next day, morning came, woke up, after the weekend) you must write time: +1d etc. If it changes several times, write the total.
- If how long passed is vague, do not leave it out: time: +?d / +?w / +?mo.
[Reply numbers] Each reply in the text starts with [#number]. Start every line inside <mb> with the number of the reply where it happened, in reply order.
e.g. #12 date: March 2 / #12 loc: school / #14 time: +1d morning / #15 with: Jiho
`,
};
export function buildPrompt(prompts, bundle, st, langs, seeds = [], opts = {}) {
  const lg = opts.lang || langOf(bundle.text), L = langs[lg], notP = (opts.notPeople || []).filter(Boolean);
  const names = knownNames(st.names, seeds, bundle.text).filter((n) => !notP.includes(n)).join(' · ') || '-';
  const fillIn = { '{{STATE}}': stateText(st, L), '{{NAMES}}': names, '{{TEXT}}': bundle.text, '{{KEYS}}': keysBlock(opts.groups, lg),
    '{{LORE}}': opts.bp ? loreSurface(opts.bp, L, lg) : '', '{{NOTPEOPLE}}': notP.length ? `\n${L.lore.notPeople}\n${notP.join(' · ')}\n` : '' };
  let prompt = prompts[lg].replace(/\{\{(STATE|NAMES|TEXT|KEYS|LORE|NOTPEOPLE)\}\}/g, (k) => fillIn[k]);
  // 「처음부터 정리」: several old replies at once. Dates were mostly left empty; here a date is part of the job.
  if (bundle.fill) prompt = prompt.replace(/\n\[(키|KEYS)\]/, (m) => `\n${(FILL_DATES[lg] || FILL_DATES.en).trimEnd()}\n${m}`);
  return { lg, prompt };
}
// Take the classifier's answer in. Broken answers change nothing (the batch waits for the next reply).
// 「처음부터 정리」 answers carry "#12 time: +1d" lines: the <mb> lines per reply number (unnumbered lines follow the line before;
// a number outside the batch goes to the nearest reply before it). null = no numbers at all (old-style answer: all on the last).
export function splitByReply(answer, ids) {
  if (!ids?.length) return null;
  const s = String(answer || ''), m = s.match(/<mb>([\s\S]*?)(<\/mb>|<rel>|$)/i); if (!m) return null;
  const out = new Map(ids.map((i) => [i, []])), last = ids.at(-1);
  let cur = null, any = false;
  for (const raw of m[1].split(/\r?\n/)) {
    const t = raw.trim(); if (!t || /^none$/i.test(t)) continue;
    const n = t.match(/^[-*•]?\s*\[?#\s*(\d+)\]?\s*[:.)]?\s*/);
    if (n) { any = true; const k = +n[1]; cur = ids.includes(k) ? k : [...ids].reverse().find((i) => i <= k) ?? ids[0]; out.get(cur).push(t.slice(n[0].length)); }
    else out.get(cur ?? last).push(t);
  }
  return any ? out : null;
}
export function absorb(ev, bundle, answer, st, V, hint = null, opts = {}) {
  const kind = brokenKind(answer);
  if (kind) return { pushed: true, kind, dropped: [] };
  const split = bundle.fill ? splitByReply(answer, bundle.ids) : null;
  if (split) {
    // one record per reply: the calendar sees the day change on the reply where it happened
    const dropped = [], parts = new Map(), toks = { active: opts.groups ? activeKeys(opts.groups) : null, notPeople: opts.notPeople };
    bundle.ids.forEach((i, k) => {
      const fp = bundle.fps[k], sub = `<mb>\n${split.get(i).join('\n') || 'none'}\n</mb>`;
      const r = toEvents(parse(sub), bundle.text, V, st.with, toks);
      ev[fp] = r.ev; dropped.push(...r.dropped); parts.set(fp, sub);
    });
    const extra = [...(hint ? [{ k: 'dir', v: String(hint.text || '').slice(0, 120), days: hint.days || 0, ...(hint.fuzzy ? { fuzzy: hint.fuzzy } : {}), src: String(hint.src || '').slice(0, 500) }] : []),
      ...dropped.slice(0, 5).map((d) => ({ k: 'drop', raw: String(d.raw || '').slice(0, 120), why: d.why }))];
    ev[bundle.fps.at(-1)].push(...extra);
    const rel = (String(answer).match(/<rel>[\s\S]*$/i) || [''])[0];
    parts.set(bundle.fps.at(-1), `${parts.get(bundle.fps.at(-1))}\n${rel}`.trim());
    return { pushed: false, lines: bundle.fps.reduce((a, fp) => a + ev[fp].length, 0), dropped, parts };
  }
  const r = toEvents(parse(answer), bundle.text, V, st.with, { active: opts.groups ? activeKeys(opts.groups) : null, notPeople: opts.notPeople });
  for (const fp of bundle.fps) ev[fp] ||= [];
  // Kept for the log only (applyGroup ignores them): the hidden instruction and up to 5 dropped lines.
  const extra = [...(hint ? [{ k: 'dir', v: String(hint.text || '').slice(0, 120), days: hint.days || 0, ...(hint.fuzzy ? { fuzzy: hint.fuzzy } : {}), src: String(hint.src || '').slice(0, 500) }] : []),
    ...r.dropped.slice(0, 5).map((d) => ({ k: 'drop', raw: String(d.raw || '').slice(0, 120), why: d.why }))];
  ev[bundle.fps.at(-1)] = [...r.ev, ...extra];
  return { pushed: false, lines: r.ev.length, dropped: r.dropped };
}

// Stage 2 rides on the same call: the relationship block is appended to the surface prompt. Returns the hidden list for absorbRel.
export function addRelPrompt(prompt, lg, deepPrompts, bundle, st2, bp, langs) {
  const inp = relInputs(st2, bp, bundle.text, langs[lg]);
  const d = deepPrompts[lg].replace('{{LORE_DEEP}}', () => (bp ? loreDeep(bp, langs[lg], lg) : '')).replace('{{BASELINE}}', () => inp.baseline);
  return { prompt: prompt + d.replace('{{HIDDEN}}', () => inp.hiddenText), hidden: inp.hidden,
    shown: prompt + d.replace('{{HIDDEN}}', () => (inp.hidden.length ? '(…)' : '-')) };   // `shown` is safe to display: no hidden content
}
// Take the <rel> part in. A missing or broken <rel> stores an empty reading (stage 1 is never affected, nothing is re-called).
export function absorbRel(rel, bundle, answer, st1, bp, V, langs, hidden, st2 = null) {
  const prevTie = (a, b) => st2?.tie?.[[a, b].sort().join('|')]?.v || '';
  let r = { ev: [], dropped: [] };
  try { if (parseRel(answer).found) r = toRelEvents(answer, bundle.text, V, langs, { names: st1.names, day: st1.cal.n, bp, hidden, prevTie }); } catch (e) { r = { ev: [], dropped: [{ raw: '', why: `rel-error: ${e.message}` }] }; }
  rel[bundle.fps.at(-1)] = r.ev;
  return r;
}
