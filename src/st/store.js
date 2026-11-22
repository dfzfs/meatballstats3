// One slot in the chat metadata + global settings. Nothing else is stored.
import { mergeVocab, cleanText, langOf, fpOfText } from '../core/clean.js';
import { fold, prune } from '../core/fold.js';
import { build, BUDGET } from '../core/signpost.js';
import { enLine } from './tr.js';
import { fingerprint } from '../core/clean.js';
import { fold2, rows2, tieOf } from '../core/ledger2.js';
import { readBlueprint, emptyBlueprint } from '../core/blueprint.js';
import { rows3, firewall, foldVault, liveBp, threads, foldSent, compose, hasSign, foldPressure } from '../core/vault.js';
import { rows4, foldArc, foldFall } from '../core/human.js';
import { estTokens } from '../core/clean.js';
import { findSkip } from '../core/hint.js';

const KEY = 'meatball_status3';   // not 'meatball3': the 1st build (meatballstats3) uses that slot
const DEFAULTS = Object.freeze({ mascot: true, on: true, profile: '', bar: true, stage2: true, burst: true, groups: {}, loreByChar: {}, maker: false, waitSort: false, waitMax: 20,
  translate: true, spark: true, guardAuto: false, vaultLines: true, refuseSteps: true, rushCall: true, rarity: 1, human: true, fallAuto: false, readHidden: false });   // everything sent to AI is English (always); only the screen is translated (Google)
export const ctx = () => SillyTavern.getContext();
export const R = { habits: [], pieces: null, lang: null, V: null, prompts: null, deep: null, ui: null, ui2: null, bp: emptyBlueprint(), bpOn: false, loreSrc: '', bookLore: '' };     // loaded text resources

export async function loadResources(base) {
  const get = async (f, json) => { const r = await fetch(new URL(f, base)); if (!r.ok) throw new Error(`${f}: ${r.status}`); return json ? r.json() : r.text(); };
  const [en, ko, pen, pko] = await Promise.all([get('lang/en.json', 1), get('lang/ko.json', 1), get('prompts/surface.en.txt'), get('prompts/surface.ko.txt')]);
  R.lang = { en, ko }; R.V = mergeVocab(en, ko); R.prompts = { en: pen, ko: pko };
  R.deep = { en: await get('prompts/deep.en.txt'), ko: await get('prompts/deep.ko.txt') };
  R.ui2 = (navigator.language || '').startsWith('ko') ? ko.ui2 : en.ui2;
  R.ui = (navigator.language || '').startsWith('ko') ? ko.ui : en.ui;
}
export function settings() {
  const { extensionSettings } = ctx();
  const s = (extensionSettings[KEY] ||= structuredClone(DEFAULTS));
  for (const k of Object.keys(DEFAULTS)) if (!Object.hasOwn(s, k)) s[k] = DEFAULTS[k];
  return s;
}
// read = false: never creates the slot (a chat that was never sorted stays untouched).
export function store(create = false) {
  const md = ctx().chatMetadata;
  if (!md) return null;
  if (!md[KEY] && create) md[KEY] = { v: 2, ev: {}, pre: [], rel: {}, raw: {}, dir: {} };
  const s = md[KEY];
  if (s) { s.ev ||= {}; s.pre ||= []; s.rel ||= {}; s.raw ||= {}; s.dir ||= {}; }
  return s || null;
}
export const save = () => ctx().saveMetadataDebounced?.();
// upTo: only the chat before that index (a range read again starts from the state at that point)
export const ledger = (upTo) => { const s = store(), c = ctx().chat || []; return fold(upTo == null ? c : c.slice(0, upTo), s?.ev || {}, R.V, s?.pre); };
// The language of everything sent to AI (classifier prompt, signpost, lore draft): always English.
// Korean in what goes to the main model (lore values, the director's note) is translated, names kept (see tr.js).
export function storyLang() {
  return 'en';
  // eslint-disable-next-line no-unreachable
  const last = [...(ctx().chat || [])].reverse().find((m) => !m.is_user && !m.is_system && m.mes);
  return last ? langOf(cleanText(last.mes).slice(-4000)) : 'en';
}
const isLoverTie = (v) => !!v && (R.V?.loverTie || []).some((w) => String(v).toLowerCase().includes(String(w).toLowerCase()));
export const ledger2 = (upTo) => { const c = ctx().chat || []; return fold2(upTo == null ? c : c.slice(0, upTo), store()?.rel || {}, fingerprint); };
// Stage 1 signpost, plus the stage-2 rows when it is on. Any stage-2 error leaves stage 1 exactly as it was.
// The person's standing director's note for this chat (one line each), added to the shallow layer every reply.
export const noteLines = () => String(store()?.note || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
function withNote(sp, L) {
  // v0.9 지시창: the "this reply" piece goes last, after the standing note (nearest the generation point)
  const split = (t) => String(t || '').trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
  const beat = split(R.pieces?.beat), scene = split(R.pieces?.scene);
  // a time skip typed in plain words ("사흘 뒤") gets the same strong line as one picked from a menu
  const typed = !R.pieces?.time?.text && R.pieces ? findSkip([R.pieces.scene, R.pieces.beat].filter(Boolean).join('\n')) : null;
  const tt = R.pieces?.time?.text || typed?.text || '', time = tt ? [L.sp.timeSkip.replace('{s}', tt)] : [];
  const lines = noteLines(), style = (R.pieces?.rules || []).map((t) => `${L.sp.style}: ${t}`);
  if (!lines.length && !beat.length && !scene.length && !time.length && !style.length) return sp;
  const rows = [...lines.map((t) => ({ layer: 'now', text: `- ${L.sp.note}: ${t}`, src: 'note' })), ...style.map((t) => ({ layer: 'now', text: `- ${t}`, src: 'note' })), ...scene.map((t) => ({ layer: 'now', text: `- ${L.sp.scene}: ${t}`, src: 'note' })),
    ...time.map((t) => ({ layer: 'now', text: `- ${t}`, src: 'note' })), ...beat.map((t) => ({ layer: 'now', text: `- ${L.sp.beat}: ${t}`, src: 'note' }))];
  return { ...sp, now: [sp.now || L.sp.nowHead, ...rows.map((r) => r.text)].join('\n'), rows: [...(sp.rows || []), ...rows] };
}
export function signpost() {
  const lg = storyLang(), L = R.lang[lg], bp = bpLive(), mine = (l) => l.startsWith(`- ${L.sp.note}:`) || l.startsWith(`- ${L.sp.beat}:`) || l.startsWith(`- ${L.sp.scene}:`) || l.startsWith(`- ${L.sp.timeSkip.split(':')[0]}:`) || l.startsWith(`- ${L.sp.style}:`) || l.startsWith(`- ${L.rel.goalPushLabel}`), dropped = [];   // the person's own lines (a 밀어주기 direction too) are never walled
  // a direction set to 밀어주기 is told to the story AI on purpose: it does not wall other lines
  const bpW = { ...bp, vault: (bp.vault || []).filter((x) => !x.push) };
  const wall = (sp, extra) => { const b = extra ? { ...bpW, vault: bpW.vault.map((x) => ({ ...x, signs: [...x.signs, ...extra(x)] })) } : bpW, out = { ...sp };
    for (const k of ['deep', 'mid', 'now']) { const f = firewall(sp[k], b, mine); out[k] = f.text; dropped.push(...f.dropped); } return out; };
  // v0.9 vault firewall, twice: on the text as written (Korean signs and pieces of the secret), and on the English
  // that goes out (the signs' own translations, same cache). The person's own note lines are never dropped.
  const sp = wall(toEnglish(withNote(wall(signpost0(lg, L)), L)), (x) => x.signs.map((g) => enSign(g)).filter(Boolean));
  R.walled = dropped;
  return sp;
}
// Names a lore person goes by (name + aliases), for matching a vault entry against story text.
export function namesOf(who) { const p = (R.bp?.persons || []).find((x) => x.name === who || (x.alias || []).includes(who)); return p ? [p.name, ...(p.alias || [])] : [who]; }
// A sign word's English (from the translation cache; the first call queues it).
function enSign(g) { try { return enLine(g, new Set(), () => {}); } catch (e) { return ''; } }
// The lore sheet as it stands now: vault entries that are open (gate, the person's decision, a kept leak) drop out.
export function bpLive() {
  try {
    const S = store(), goals = (S?.goals || []).map((g) => ({ who: g.who, v: g.v, signs: g.signs || [], shows: '', cover: '', opens: '', goal: true, hint: !!g.hint && !g.push, push: !!g.push }));
    const bp = bpAll(S, goals);
    return liveBp(bp, foldVault(ctx().chat || [], S, bp, ledger2(), fingerprint));
  } catch (e) { return R.bp; }
}
// the lore's vault lines + secrets typed in 지시창 (S.secrets) + destinations, before anything is opened
function bpAll(S, goals = []) {
  const sec = (S?.secrets || []).filter((x) => x.who && x.v).map((x) => ({ who: x.who, v: x.v, signs: x.signs || [], shows: x.shows || '', cover: '', opens: '', typed: true }));
  return sec.length || goals.length ? { ...R.bp, vault: [...(R.bp.vault || []), ...sec, ...goals] } : R.bp;
}
// v0.9 step 3: falling state per lore line (needs the person's confirmation unless "open by itself" is on)
export function fallState() {
  try { const chat = ctx().chat || [], S = store() || {}, st2 = ledger2(); return foldFall(R.bp, ledger(), st2, foldArc(chat, S.ev, S.rel, fingerprint), S, chat, fingerprint, { auto: !!settings().fallAuto }); } catch (e) { return []; }
}
// Everything sent to the main model is English: Korean left in a line (lore values, the director's note) is
// translated with names kept; until the translation arrives the line goes as written, then the note is rebuilt.
function toEnglish(sp) {
  try {
    const st = ledger(), names = new Set([...Object.keys(st.names?.seen || {}), ...(st.with || []), ...(R.bp?.persons || []).flatMap((p) => [p.name, ...(p.alias || [])])]);
    const again = () => import('./inject.js').then((m) => m.refresh()).catch(() => {});
    const fix = (t) => (t ? t.split('\n').map((l) => enLine(l, names, again)).join('\n') : t);
    return { ...sp, deep: fix(sp.deep), mid: fix(sp.mid), now: fix(sp.now) };
  } catch (e) { return sp; }
}
function signpost0(lg, L) {
  const st = ledger();
  R.lastSent = { special: '', eased: [] };
  if (!settings().stage2) return { lg, ...build(st, L, lg) };
  try {
    const st2 = ledger2(), bp = bpLive(), sp = build(st, L, lg, { ...BUDGET, tieOf: (p) => tieOf(p, st2, bp, R.V) });
    if (!st.classified) return { lg, ...sp };
    const chat = ctx().chat || [], S = store(), s = settings();
    const last = chat.at(-1), cue = [last?.is_user ? cleanText(last.mes) : '', String(R.pieces?.beat || ''), String(R.pieces?.scene || '')].filter(Boolean).join('\n');
    const lover = (a, b) => isLoverTie(tieOf({ a, b, tie: '' }, st2, bp, R.V));
    const x = rows2(st, st2, bp, L, lg, 9999, 7, s.burst !== false, R.V, 3, 3, cue);
    let y = [];
    try {
      const lastAi = [...chat].reverse().find((m) => !m.is_user && !m.is_system), sent = foldSent(chat, S, fingerprint);
      // digging: the person's message, or (stories the AI writes alone) the end of the last reply naming a vault person
      const askW = [...(R.lang.en.rel.askWords || []), ...(R.lang.ko.rel.askWords || [])], tail = lastAi ? cleanText(lastAi.mes).slice(-1500) : '';
      const ask = askW.some((w) => hasSign(cue, w)) || (askW.some((w) => hasSign(tail, w)) && (bp.vault || []).some((x) => x.who.split('-').some((n) => namesOf(n.trim()).some((a) => a && tail.includes(a)))));
      const redo = R.redoLine && Date.now() - R.redoLine.t < 120e3 ? R.redoLine : null;
      const rare = Math.min(3, Math.max(0.5, +s.rarity || 1));
      const fallenNow = new Set(fallState().filter((f) => f.open).map((f) => f.a));
      y = rows3(st, st2, bp, L, { cue, tail, goalEvery: Math.round(4 * rare), lover, user: ctx().name1 || '', interrogate: ask, redo, pressure: foldPressure(chat, S, bp, fingerprint), marks: sent.marks, fallen: fallenNow, press: R.pieces?.press || null, pov: s.vaultLines !== false, spark: s.spark !== false, every: Math.round(5 * rare), showsEvery: Math.round(4 * rare),
        threads: s.refuseSteps === false ? [] : threads(chat, st, st2, bp, S, fingerprint, cleanText, R.lang, { lover }),
        ago: sent.ago, jitter: lastAi ? parseInt(fingerprint(lastAi).split('.').at(-1), 10) % 3 === 0 : true, seed: sent.ago });
      if (s.vaultLines === false) y = y.filter((r) => !['vaultCover', 'vaultPov', 'vaultAvoid'].includes(r.kind));
    } catch (e) { console.warn('[meatball3] v0.9 rows failed', e); }
    // v0.9 steps 2-3: harsh, lead switch, aside, seeds and care, falling — counted inside, "may" lines out
    let z = { now: [], deep: [] };
    try {
      const sent = foldSent(chat, S, fingerprint), lastAi = [...chat].reverse().find((m) => !m.is_user && !m.is_system), lfp = lastAi ? fingerprint(lastAi) : '';
      const ais = chat.filter((m) => !m.is_user && !m.is_system).slice(-3).map(fingerprint);
      const falls = fallState(), fallen = new Set(falls.filter((f) => f.open).map((f) => f.a));
      const lostN = {}; for (const fp of ais) for (const w of S?.lost?.[fp] || []) lostN[w] = (lostN[w] || 0) + 1;
      const busy = new Set(y.filter((r) => ['refuseAgain', 'refusePress', 'refuse'].includes(r.kind)).map((r) => (r.text.match(/^- (\S+)/) || [])[1]).concat(x.now.filter((r) => r.kind === 'burstNow').map((r) => (r.text.match(/^- (\S+)/) || [])[1])));
      z = rows4(st, st2, bp, L, { user: ctx().name1 || '', cue, tail: lastAi ? cleanText(lastAi.mes).slice(-1500) : '', lover, marks: sent.marks, count: sent.count,
        rare: Math.min(3, Math.max(0.5, +s.rarity || 1)), jitter: lastAi ? parseInt(lfp.split('.').at(-1), 10) % 4 : 0, busy,
        crossed: new Set(S?.cross?.[lfp] || []), lost: new Set(Object.keys(lostN).filter((w) => lostN[w] >= 2)), falls, lastRel: S?.rel?.[lfp] || [], lastFp: lfp,
        vaultClosed: new Set((bp.vault || []).filter((v) => !v.goal).flatMap((v) => v.who.split('-').map((n) => n.trim()))), threads: [],
        seedDays: 7, seedReplies: Math.round(40 * Math.min(3, Math.max(0.5, +s.rarity || 1))) });
      if (s.human === false) z = { now: [], deep: [] };
      // a fallen direction's base line takes the place of its leak line
      for (const f of falls.filter((f) => f.open)) x.now = x.now.filter((r) => !(r.kind === 'leak' && r.text.startsWith(`- ${f.a} → ${f.b}:`)));
    } catch (e) { console.warn('[meatball3] v0.9 step 2-3 rows failed', e); }
    const c = compose([...x.now, ...y, ...z.now], { lastSpecial: foldSent(chat, S, fingerprint).ago === 0 }, (t) => estTokens(t, lg));
    R.lastSent = { special: c.special?.kind || '', eased: c.rows.filter((r) => String(r.src).startsWith('ease:')).map((r) => r.src.slice(5)), marks: c.rows.filter((r) => r.mark).map((r) => r.mark) };
    const add = (cur, head, rows) => (rows.length ? [cur || head, ...rows.map((r) => r.text)].join('\n') : cur);
    const deepRows = [...x.deep, ...z.deep.filter((r) => r.kind !== 'seedBg' || c.rows.some((q) => q.kind === 'seed'))];   // a seed's content only with its line
    return { lg, ...sp, deep: add(sp.deep, L.sp.deepHead, deepRows), now: add(sp.now, L.sp.nowHead, c.rows), rows: [...sp.rows, ...deepRows, ...c.rows] };
  } catch (e) { console.warn('[meatball3] stage 2 failed, stage 1 only', e); return { lg, ...build(st, L, lg) }; }
}
// v0.9: the refusal threads still open now (same rules the note uses: gates, lovers, the person's own closing).
export function openThreads() {
  try { const st2 = ledger2(), bp = bpLive(); return threads(ctx().chat || [], ledger(), st2, bp, store(), fingerprint, cleanText, R.lang, { lover: (a, b) => isLoverTie(tieOf({ a, b, tie: '' }, st2, bp, R.V)) }); } catch (e) { return []; }
}
// v0.9: what special line went out with a reply (and which refusal threads got their "eased" line), kept per reply.
export function keepSent(fp, sent) {
  if (!fp || !sent || (!sent.on && !sent.special && !sent.eased?.length && !sent.marks?.length)) return;
  // on: a note went with this reply (for the 🛡 note-effect count); the rest only when there is something to keep
  const S = store(true); S.sent ||= {}; S.sent[fp] = sent.special || sent.eased?.length || sent.marks?.length ? sent : { on: 1 };
  const ks = Object.keys(S.sent); if (ks.length > 400) delete S.sent[ks[0]];
  save();
}
// The lore sheet (설정집). The first that exists wins: this chat's sheet > the character's default sheet (my settings)
// > a lorebook entry titled "미트볼 설정집" / "meatball lore" (or the older "미트볼 설계도") in the character's book.
// The lorebook entry should be switched OFF: the extension reads it anyway, and then the main model never sees it.
export const charKey = () => { const c = ctx(); return c.groupId ? `group:${c.groupId}` : c.characters?.[c.characterId]?.avatar || ''; };
export function loreText() {
  const s = store(), k = charKey(), def = settings().loreByChar?.[k];
  if (s?.lore != null && s.lore !== '') return { text: s.lore, src: 'chat' };
  if (def) return { text: def, src: 'char' };
  if (R.bookLore) return { text: R.bookLore, src: 'book' };
  return { text: '', src: '' };
}
export function applyLore() { const x = loreText(); R.bp = readBlueprint(x.text); R.loreSrc = x.src; for (const v of R.bp.vault || []) for (const g of v.signs) enSign(g); }
export async function loadBlueprint() {
  R.bookLore = ''; R.bpOn = false;
  try {
    const c = ctx(), ch = c.characters?.[c.characterId], book = ch?.data?.extensions?.world;
    if (book && c.loadWorldInfo) {
      const data = await c.loadWorldInfo(book);
      const e = Object.values(data?.entries || {}).find((x) => /미트볼\s*(설계도|설정집)|meatball\s*(blueprint|lore)/i.test(`${x.comment || ''} ${String(x.content || '').slice(0, 40)}`));
      if (e) { R.bookLore = String(e.content || ''); R.bpOn = !e.disable; }
    }
  } catch (e) { console.warn('[meatball3] lore entry not read', e); }
  applyLore();
}
// Chat shape: who counts as a person. 'one' = 1:1 roleplay (card and persona are people), 'novel' = the card is a title and
// the persona is a director, 'multi' = the card is a world and the persona is the player. 'auto' guesses from the story text.
export function shape() {
  const c = ctx(), s = store(), set = s?.shape || 'auto', n1 = c.name1 || '', n2 = c.name2 || '';
  let members = [];
  try { if (c.groupId) { const g = c.groups?.find((x) => x.id === c.groupId); members = (g?.members || []).map((av) => c.characters?.find((ch) => ch.avatar === av)?.name).filter(Boolean); } } catch (e) { members = []; }
  const lorePeople = (R.bp?.persons || []).map((p) => p.name);
  let charPerson, userPerson;
  if (c.groupId) { charPerson = true; userPerson = set !== 'novel'; }
  else if (set === 'one') { charPerson = true; userPerson = true; }
  else if (set === 'novel') { charPerson = false; userPerson = false; }
  else if (set === 'multi') { charPerson = false; userPerson = true; }
  else {
    const ai = (c.chat || []).filter((m) => !m.is_user && !m.is_system).slice(-6).map((m) => cleanText(m.mes)).join('\n');
    const count = (n) => (n && n.length >= 2 ? ai.split(n).length - 1 : 0);
    charPerson = lorePeople.includes(n2) || count(n2) >= 2;
    userPerson = lorePeople.includes(n1) || count(n1) >= 2;
  }
  const seeds = [...(c.groupId ? members : charPerson ? [n2] : []), ...(userPerson ? [n1] : []), ...lorePeople];
  const notPeople = [...(!c.groupId && !charPerson ? [n2] : []), ...(!userPerson ? [n1] : [])].filter((n) => n && !lorePeople.includes(n));
  return { set, charPerson, userPerson, seeds: [...new Set(seeds)], notPeople };
}
// The hidden instruction that produced a reply (it is not kept in the chat). Last 300 replies.
export function keepDir(fp, d) {
  const S = store(true);
  if (!S || !fp || !d || (!d.t && !d.h && !d.press)) return;
  S.dir[fp] = { t: String(d.t || '').slice(0, 600), ...(d.h ? { h: d.h } : {}), ...(d.kind ? { kind: d.kind } : {}), ...(d.press ? { press: d.press } : {}), at: Date.now() };   // kind 'beat' = typed in 지시창, not guessed
  const ks = Object.keys(S.dir);
  if (ks.length > 300) ks.sort((a, b) => S.dir[a].at - S.dir[b].at).slice(0, ks.length - 300).forEach((k) => delete S.dir[k]);
  save();
}
// When a chat opens: drop results whose reply no longer exists in any swipe.
export function tidy() {
  const s = store();
  if (!s) return;
  const a = prune(ctx().chat || [], s.ev, fpOfText), b = prune(ctx().chat || [], s.rel, fpOfText), r = prune(ctx().chat || [], s.raw, fpOfText), d = prune(ctx().chat || [], s.dir, fpOfText);
  if (a || b || r || d) save();
}

// v0.9 connection for 「미트볼 지시창」 (and Meatball's own buttons). Decisions are stored on the last AI reply, so
// undoing that reply undoes the decision (same rule as every other record).
const lastAiFp = () => { const m = [...(ctx().chat || [])].reverse().find((x) => !x.is_user && !x.is_system); return m ? fingerprint(m) : ''; };
export function decide(kind, t = {}) {
  const fp = lastAiFp(); if (!fp) return false;
  const S = store(true);
  if (kind === 'vault') { (S.vdec ||= {}); (S.vdec[fp] ||= []).push({ who: t.who, open: !!t.open }); }
  else if (kind === 'guardFalse') { const g = S.guard?.[fp]; if (!g) return false; g.false = true; g.done = true; }
  else if (kind === 'thread') (S.ev[fp] ||= []).push({ k: 'unrefuse', a: t.a, b: t.b, v: t.v, by: 'user' });
  else if (kind === 'fall') { (S.fdec ||= {}); (S.fdec[fp] ||= []).push({ a: t.a, b: t.b, open: !!t.open }); }
  else return false;
  save(); return true;
}
export function stateFor() {
  const S = store() || {}, live = bpLive(), fp = lastAiFp(), st = ledger();
  const lastCut = [...(st.hist || [])].reverse().find((x) => x.cut)?.gn ?? 0;
  return { version: R.version, present: st.with || [], gn: st.gn || 0, lastCut, goals: S.goals || [],
    falls: fallState().map((f) => ({ a: f.a, b: f.b, open: f.open, need: f.need })),
    vaults: (bpAll(S).vault || []).map((x) => ({ who: x.who, open: !(live.vault || []).some((y) => y.who === x.who), typed: !!x.typed })),
    secrets: S.secrets || [], names: [...new Set([...(R.bp?.persons || []).map((p) => p.name), ...(st.with || [])])].filter(Boolean),
    signs: (live.vault || []).flatMap((x) => x.signs), threads: openThreads().map((t) => ({ a: t.a, b: t.b, v: t.v, mode: t.mode })),
    guard: S.guard?.[fp] && !S.guard[fp].done ? S.guard[fp].hits : [], note: S.note || '', habits: S.habit?.[fp] || [], sorted: !!(fp && S.ev?.[fp]) };
}
// v0.9 destinations (도착점): where the story should end up. Never sent; they become vault entries the guard watches for "rushed".
export function setGoals(list) { const S = store(true); S.goals = (list || []).slice(0, 6).map((g) => ({ who: String(g.who || '').slice(0, 60), v: String(g.v || '').slice(0, 300), signs: (g.signs || []).map(String).slice(0, 20), hint: !!g.hint && !g.push, push: !!g.push })); save(); }
// secrets typed in 지시창: guarded exactly like a lore vault line (never sent, signs scanned, firewall, classifier guard)
export function setSecrets(list) { const S = store(true); S.secrets = (list || []).slice(0, 8).map((g) => ({ who: String(g.who || '').slice(0, 60), v: String(g.v || '').slice(0, 400), signs: (g.signs || []).map(String).filter((x) => x.trim().length >= 2).slice(0, 20), shows: String(g.shows || '').slice(0, 200) })).filter((x) => x.who && x.v); save(); }
export function setNote(text) { const S = store(true); S.note = String(text || '').slice(0, 1200); save(); }
// English preview of a person's instruction (same cache and name masking as the note); onReady when it arrives.
export function previewEn(text, onReady = () => {}) {
  try { const st = ledger(), names = new Set([...Object.keys(st.names?.seen || {}), ...(st.with || []), ...(R.bp?.persons || []).flatMap((p) => [p.name, ...(p.alias || [])])]);
    return String(text || '').split('\n').map((l) => (l.trim() ? enLine(l, names, onReady) : l)).join('\n'); } catch (e) { return text; }
}
