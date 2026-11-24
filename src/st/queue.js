// The only place that calls a model. One call at a time, spaced out, never retried at once.
import { ctx, settings, store, save, ledger, ledger2, R, shape, bpLive, namesOf, fallState, openThreads } from './store.js';
import { pending, buildPrompt, absorb, addRelPrompt, absorbRel, DEFAULTS } from '../core/bundle.js';
import { fingerprint, cleanText } from '../core/clean.js';
import { guardBlock, parseGuard, quarantine, scan, hasSign } from '../core/vault.js';
import { words } from '../core/ledger2.js';
import { refresh } from './inject.js';
import { afterSort, renderBar } from './bar.js';
import { keepFixes } from './fix.js';
import { FILL_N, endFill } from './fill.js';

const GAP = 20e3, AFTER_REPLY = 3e3, WAIT_429 = 60e3, COOL = 600e3, TIMEOUT = 90e3, MAX_OUT = 16000;   // thinking + answer (a thinking model can spend 3k before writing); only what is used is paid
export const Q = { rush: false, busy: false, generating: false, lastCall: 0, calls: [], coolUntil: 0, notBefore: 0, fails: 0, pushedKey: '', tries: {}, noEffort: false, timer: null, log: { status: '', dropped: [], lastReq: '', lastAnswer: '' } };

export function kick(delay = AFTER_REPLY) { clearTimeout(Q.timer); Q.timer = setTimeout(tick, delay); }
export function reset() { clearTimeout(Q.timer); Q.pushedKey = ''; Q.tries = {}; Q.fails = 0; Q.log = { status: '', dropped: [], lastReq: '', lastAnswer: '' }; }
export const newReply = () => { if (Q.fails >= 5) Q.fails = 4; };          // after 5 failures: one more try per new reply

export async function request(prompt, stop = '</mb>', profile = '', maxOut = MAX_OUT) {
  const c = ctx(), s = settings(), pid = profile || s.profile;
  if (pid && c.ConnectionManagerRequestService) {
    const over = { temperature: 0.2, stop: [stop], ...(Q.noEffort ? {} : { reasoning_effort: 'min' }) };   // 'min' = the least thinking the model allows (off where it can be)
    const r = await c.ConnectionManagerRequestService.sendRequest(pid, prompt, maxOut, { stream: false, extractData: true, includePreset: false, includeInstruct: false }, over);
    return typeof r === 'string' ? r : (r?.content ?? '');
  }
  return await c.generateRaw({ prompt, responseLength: maxOut });       // no profile chosen: main connection, prompt only
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const is429 = (e) => /429|too many requests|rate.?limit|quota/i.test(`${e?.message} ${e?.cause?.message || e?.cause || ''}`);

// The classifier's note, kept per reply for "how it was judged" (last 300 replies, 1,500 letters each).
function keepRaw(S, fp, answer, r) {
  try {
    S.raw ||= {};
    // only the <mb> and <rel> blocks are kept (fixes rebuild from them); a model's talk around them only made chats bigger
    const A = String(answer || ''), blk = (tag) => (A.match(new RegExp(`<${tag}>[\\s\\S]*?(</${tag}>|$)`, 'i')) || [''])[0].trim();
    const kept = [blk('mb'), blk('rel')].filter(Boolean).join('\n') || A;
    S.raw[fp] = { a: kept.slice(0, 1500), t: Date.now(), d: (r.dropped || []).slice(0, 8).map((x) => [x.why, String(x.raw || '').slice(0, 80)]) };
    const ks = Object.keys(S.raw);
    if (ks.length > 300) ks.sort((a, b) => S.raw[a].t - S.raw[b].t).slice(0, ks.length - 300).forEach((k) => delete S.raw[k]);
  } catch (e) { /* the note is optional */ }
}

// The batch's hidden instruction for the log: the last reply in it that had one. h = a time skip found in it (or null).
function hintOf(S, b) {
  for (const fp of [...b.fps].reverse()) { const d = S?.dir?.[fp]; if (d?.t || d?.h) return { ...(d.h || { text: '', days: 0 }), src: d.t || '' }; }
  return null;
}
// Resolves when no sort call is running (or after `ms`). Used to hold a send until the signpost is fresh.
export async function idle(ms) {
  const end = Date.now() + ms;
  while (Q.busy && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
  return !Q.busy;
}
async function tick() {
  const s = settings(), chat = ctx().chat || [];
  if (!s.on || Q.busy || Q.generating || !chat.length || !R.V) return;
  const S0 = store(), F = S0?.fill;
  if (F?.paused) { Q.log.status = 'fill-paused'; return; }
  if (S0?.ooc) { Q.log.status = 'ooc'; return; }   // OOC: nothing is sorted while the person talks to the AI out of the story
  const b = pending(chat, S0?.ev || {}, F ? { ...DEFAULTS, fill: FILL_N, from: F.from, to: F.to } : undefined, S0?.dir);
  if (!b && F) { if (endFill(true)) { try { window.toastr?.success(R.ui2?.fillDone || '처음부터 정리 끝!'); } catch (e) { /* */ } } return; }
  if (!b || !(b.ready || Q.rush)) return;
  const key = b.fps.join('|');
  if (key === Q.pushedKey || Q.fails >= 5) { Q.log.status = Q.fails >= 5 ? 'stopped' : 'pushed'; return; }   // same request is never sent twice
  const now = Date.now(), cooling = now < Q.coolUntil;
  Q.calls = Q.calls.filter((t) => now - t < 60e3);
  const wait = Math.max(Q.lastCall + (cooling ? GAP * 2 : GAP) - now, Q.notBefore - now, Q.calls.length >= 3 ? Q.calls[0] + 60e3 - now : 0);
  if (wait > 0) return kick(wait + 50);
  const chatId = ctx().getCurrentChatId?.(), st = ledger(b.fill ? b.start : undefined), st2 = () => ledger2(b.fill ? b.start : undefined);
  const sh = shape(), opts = { groups: s.groups, bp: R.bp, notPeople: sh.notPeople, lang: 'en' };
  let { prompt, lg } = buildPrompt(R.prompts, b, st, R.lang, sh.seeds, opts), shown = prompt, rel = null;
  if (s.stage2 && R.deep) try { rel = addRelPrompt(prompt, lg, R.deep, b, st2(), R.bp, R.lang); prompt = rel.prompt; shown = rel.shown; } catch (e) { rel = null; console.warn('[meatball3] stage 2 prompt failed', e); }
  // v0.8 guard: the vault entries go only to this call; the shown copy never holds them
  const vbp = bpLive(), falls = fallState().filter((f) => f.open && f.keeps), habits = R.habits || [], gb = b.fill ? '' : guardBlock(vbp, R.lang[lg], { falls, habits });   // old replies: no guard check
  if (gb) { prompt += gb; shown += `\n\n[GUARD] (${vbp.vault.length})`; }
  Q.rush = false;
  Q.busy = true; Q.lastCall = now; Q.calls.push(now); Q.log.lastReq = shown; Q.log.status = 'sorting';
  R.sorting = true; try { renderBar(); } catch (e) { /* the cat is optional */ }
  try {
    const answer = await withTimeout(request(prompt, rel ? '</rel>' : '</mb>'), rel ? TIMEOUT * 2 : TIMEOUT);
    const live = new Set((ctx().chat || []).map(fingerprint));
    if (ctx().getCurrentChatId?.() !== chatId || !b.fps.every((fp) => live.has(fp))) return;    // rerolled or chat switched meanwhile: discard
    const S = store(true), hint = hintOf(S, b), r = absorb(S.ev, b, answer, st, R.V, hint, opts);
    if (r.parts) for (const [fp, a] of r.parts) keepRaw(S, fp, a, fp === b.fps.at(-1) ? r : {});   // 처음부터 정리: each reply keeps its own lines
    else keepRaw(S, b.fps.at(-1), answer, r);
    Q.log.lastAnswer = String(answer).slice(0, 2000); Q.log.dropped = r.dropped;
    if (r.pushed && b.fill) { skipped(S, b.fps, r.kind); save(); Q.log.status = `fill-skip:${r.kind}`; }   // 처음부터 정리: a broken answer skips these few, the rest goes on
    else if (r.pushed) { Q.pushedKey = key; Q.log.status = `pushed:${r.kind}`; }                      // broken answer: wait for the next reply, no re-call
    else { Q.fails = 0; Q.log.status = 'ok'; if (rel) { const x = absorbRel(S.rel, b, answer, st, R.bp, R.V, R.lang, rel.hidden, st2()); Q.log.dropped = [...r.dropped, ...x.dropped]; }
      try { afterAbsorb(S, b, answer, vbp, falls, gb, habits); } catch (e) { console.warn('[meatball3] guard failed', e); }
      try { keepFixes(b.fps); } catch (e) { console.warn('[meatball3] could not keep fixes', e); }   // ✋ the person's fixes stay on top
      save(); refresh(); if (!b.fill) try { afterSort(st, b.fps, hint); } catch (e) { console.warn('[meatball3] notice failed', e); } }
  } catch (e) {
    console.warn('[meatball3] sort call failed', e);
    const tries = (Q.tries[key] = (Q.tries[key] || 0) + 1);
    if (is429(e)) { Q.coolUntil = Date.now() + COOL; Q.notBefore = Date.now() + WAIT_429; } else if (e.message !== 'timeout') Q.noEffort = true;
    if (tries >= 2 && b.fill) { Q.fails++; try { const S = store(true); skipped(S, b.fps, 'error'); save(); } catch (er) { /* */ } Q.log.status = 'fill-skip:error'; }
    else if (tries >= 2) { Q.pushedKey = key; Q.fails++; Q.log.status = 'pushed:error'; } else Q.log.status = 'retry';
  } finally { Q.busy = false; R.sorting = false; R.stalled = Q.fails >= 5; try { renderBar(); } catch (e) { /* optional */ } if (Q.log.status === 'retry') kick(GAP); else kick(); }
}

// v0.8: after a sort — records that carry the vault are not kept (quarantine), and the guard's answer is kept per reply.
// After a sort (v0.9): quarantine, the guard's answers, the person's own moves marked, and a refusal given up for nothing.
function afterAbsorb(S, b, answer, bp, falls, gb, habits = []) {
  const live = (ctx().chat || []).filter((m) => !m.is_user && !m.is_system && b.fps.includes(fingerprint(m))).map((m) => ({ fp: fingerprint(m), text: cleanText(m.mes) }));
  // a lead the person ordered (typed instruction or press button) is not the character's own lead
  for (const fp of b.fps) {
    const d = S.dir?.[fp]; if (!d) continue;
    const dw = new Set(words(d.t || ''));
    for (const e of S.ev[fp] || []) if (e.k === 'lead' && !e.byUser && (d.press === 'lead' || words(e.v).some((w) => dw.has(w)))) e.byUser = true;
  }
  // a refusal given up with nothing new (yield on an open thread) -> warning; keeping it closes the thread (not for old replies read again)
  const open = b.fill ? [] : openThreads();
  for (const fp of b.fps) for (const y of (S.ev[fp] || []).filter((e) => e.k === 'yield')) {
    const t = open.find((t) => t.a === y.a && t.b === y.b && words(t.v).some((w) => y.v.toLowerCase().includes(w)));
    if (t) addGuard(S, fp, { who: t.a, kind: 'reversal', q: y.q || y.v, a: t.a, b: t.b, v: t.v, src: 'ai' });
  }
  if (!gb) return;
  // the lore as it stands AFTER this reply: a reply that opens a secret (열림 in its own <rel>) keeps its record of it
  let bpNow = bp; try { bpNow = bpLive(); } catch (e) { /* the earlier lore */ }
  const gone = [...quarantine(S.ev, b.fps, bpNow), ...quarantine(S.rel, b.fps, bpNow)];
  if (gone.length) Q.log.dropped = [...(Q.log.dropped || []), ...gone];
  // 거짓말 장부: a lie told to keep a secret goes from the record (it carries the secret), but THAT it happened stays —
  // no words, only who and on which reply (the secret card counts them)
  for (const g of gone) if (g.k === 'lie' && g.fp) { S.lieLog ||= {}; const a = (S.lieLog[g.fp] ||= []); if (!a.includes(g.who)) a.push(g.who); }
  // 털어놔도 돼 was on for this reply: the secret coming out is what was asked, not a leak
  const letFor = (fp) => new Set(S.sent?.[fp]?.let || []);
  for (const h of parseGuard(answer, b.text, live, bp, { falls, habits })) {
    if (h.cls === 'H') { if (!h.byUser) { S.habit ||= {}; const a = (S.habit[h.fp] ||= []); if (!a.includes(h.who)) a.push(h.who); } continue; }
    if (h.cls === 'G' && (h.kind === 'clue' || h.kind === 'near')) { if (!h.byUser) { S.clue ||= {}; (S.clue[h.fp] ||= []).push({ who: h.who, kind: h.kind, q: h.q }); } }
    else if (h.cls === 'G' && letFor(h.fp).has(h.who) && (h.kind === 'revealed' || h.kind === 'rushed' || h.kind === 'sign')) { if (h.kind === 'revealed') { S.vdec ||= {}; (S.vdec[h.fp] ||= []).push({ who: h.who, ...(h.sid ? { sid: h.sid } : {}), open: true, let: true }); delete S.letOut?.[h.who]; } }
    else if (h.cls === 'G') addGuard(S, h.fp, { who: h.who, ...(h.sid ? { sid: h.sid } : {}), kind: h.byUser && h.kind === 'revealed' ? 'userGuess' : h.kind, q: h.q, src: 'ai' });
    else if (h.cls === 'F') { S.cross ||= {}; (S.cross[h.fp] ||= []).push(h.who); addGuard(S, h.fp, { who: h.who, kind: 'crossed', q: h.q, src: 'ai' }); }
    else if (h.cls === 'K') { S.lost ||= {}; (S.lost[h.fp] ||= []).push(h.who); }
  }
}
// 처음부터 정리 could not read these (a broken answer, or the call failed twice): they are passed over, but marked so the
// log can show "read failed · 🔄 read again" instead of looking like replies where nothing changed
function skipped(S, fps, why) { for (const fp of fps) if (!(S.ev[fp] || []).length) S.ev[fp] = [{ k: 'drop', raw: '', why: `skip:${why}` }]; }
export function addGuard(S, fp, hit) {
  S.guard ||= {};
  const g = (S.guard[fp] ||= { hits: [], done: false, auto: false });
  if (!g.hits.some((x) => x.who === hit.who && x.kind === hit.kind && (x.sid || '') === (hit.sid || ''))) g.hits.push(hit);
  const ks = Object.keys(S.guard); if (ks.length > 100) delete S.guard[ks[0]];
}
// A new reply: sign words are looked for at once (no call).
export function guardNow(m) {
  const bp = bpLive();
  if ((!bp?.vault?.length && !bp?.harsh?.length) || !m || m.is_user) return [];
  const text = cleanText(m.mes), hits = scan(text, bp);
  // v0.9: a harsh attitude that turns into harm (code word scan; the guard's F check follows with the sort)
  const harm = [...(R.lang.en.rel.harmWords || []), ...(R.lang.ko.rel.harmWords || [])].find((w) => hasSign(text, w));
  const hx = harm && (bp.harsh || []).find((x) => text.includes(x.a) || namesOf(x.a).some((n) => text.includes(n)));
  if (hx) { const S0 = store(true), fp0 = fingerprint(m); S0.cross ||= {}; (S0.cross[fp0] ||= []).push(hx.a); addGuard(S0, fp0, { who: hx.a, kind: 'crossed', q: harm, src: 'word' }); save(); }
  // v0.9 call early: a sign word, or digging words in a reply where a vault person is named -> sort this reply now
  const ask = [...(R.lang.en.rel.askWords || []), ...(R.lang.ko.rel.askWords || [])].some((w) => hasSign(text, w));
  if (settings().rushCall !== false && (hits.length || (ask && bp.vault.some((x) => x.who.split('-').some((n) => namesOf(n.trim()).some((a) => a && text.includes(a))))))) Q.rush = true;
  const S = store(true), fp = fingerprint(m), let0 = new Set(S.sent?.[fp]?.let || []);
  const warn = hits.filter((h) => !let0.has(h.who));   // its secret was allowed out in this reply: a sign word is no warning
  if (!warn.length) return hx ? [hx] : [];
  for (const h of warn) addGuard(S, fp, { who: h.who, kind: 'sign', q: h.sign, src: 'word' });
  save();
  return warn;
}
