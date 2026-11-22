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
    const wrapF = (r) => (r.m.is_user ? `<user>${r.t}</user>` : (dirs?.[fingerprint(r.m)]?.t ? `<director>${String(dirs[fingerprint(r.m)].t).trim()}</director>\n\n${r.t}` : r.t));
    const text = rows.filter((r) => r.i > before && r.i <= pick.at(-1).i).map(wrapF).join('\n\n').slice(-cfg.maxIn);
    return { text, fps: pick.map((r) => fingerprint(r.m)), catchUp: false, ready: true, fill: true, start: before + 1 };
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
export function buildPrompt(prompts, bundle, st, langs, seeds = [], opts = {}) {
  const lg = opts.lang || langOf(bundle.text), L = langs[lg], notP = (opts.notPeople || []).filter(Boolean);
  const names = knownNames(st.names, seeds, bundle.text).filter((n) => !notP.includes(n)).join(' · ') || '-';
  const fillIn = { '{{STATE}}': stateText(st, L), '{{NAMES}}': names, '{{TEXT}}': bundle.text, '{{KEYS}}': keysBlock(opts.groups, lg),
    '{{LORE}}': opts.bp ? loreSurface(opts.bp, L, lg) : '', '{{NOTPEOPLE}}': notP.length ? `\n${L.lore.notPeople}\n${notP.join(' · ')}\n` : '' };
  return { lg, prompt: prompts[lg].replace(/\{\{(STATE|NAMES|TEXT|KEYS|LORE|NOTPEOPLE)\}\}/g, (k) => fillIn[k]) };
}
// Take the classifier's answer in. Broken answers change nothing (the batch waits for the next reply).
export function absorb(ev, bundle, answer, st, V, hint = null, opts = {}) {
  const kind = brokenKind(answer);
  if (kind) return { pushed: true, kind, dropped: [] };
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
