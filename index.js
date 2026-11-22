// Meatball Status 3 — stage 1 (basic signpost) + stage 2 (relationships, same call). Wires SillyTavern events to the core.
import { ctx, loadResources, tidy, loadBlueprint, settings, keepDir, keepSent, decide, stateFor, setNote, setGoals, setSecrets, previewEn } from './src/st/store.js';
import { mountRelUI } from './src/st/relview.js';
import { Q, kick, reset, newReply, idle, guardNow } from './src/st/queue.js';
import { refresh, lastPut } from './src/st/inject.js';
import { mountUI } from './src/st/ui.js';
import { openLedger } from './src/st/ledgerview.js';
import { keepFixes } from './src/st/fix.js';
import { store as store3 } from './src/st/store.js';
import { renderBar, guardAuto } from './src/st/bar.js';
import { findSkip, directorTail, dirClip } from './src/core/hint.js';
import { fingerprint, HIDDEN } from './src/core/clean.js';
import { R } from './src/st/store.js';

// The hidden instruction of the generation in flight. It lives only in the outgoing prompt, so it is caught there
// and kept per reply (fingerprint) when the reply arrives: rerolls and batched sorting each find their own.
const G = { type: '', dir: null, contFp: '', sent: null };
const QUIET = new Set(['quiet', 'impersonate']);

// v0.9 connection for 「미트볼 지시창」 (a separate extension). Version 1. Without it, everything runs as before.
window.MeatballAPI = {
  v: 1,
  // for the generation about to start: { beat, scene, time: { days, text }, press: { kind, a, b } }
  pieces: (p) => { const x = p || {}, rules = (Array.isArray(x.rules) ? x.rules : []).map((t) => String(t).slice(0, 400)).filter(Boolean).slice(0, 8); R.pieces = (x.beat || '').trim() || (x.scene || '').trim() || x.time?.text || x.press?.kind || rules.length ? { rules, beat: String(x.beat || '').slice(0, 2000), scene: String(x.scene || '').slice(0, 2000), time: x.time?.text ? { days: +x.time.days || 0, text: String(x.time.text).slice(0, 80), fuzzy: x.time.fuzzy || '' } : null, press: x.press?.kind ? x.press : null } : null; },
  setGoals: (l) => { setGoals(l); refresh(); },
  setSecrets: (l) => { setSecrets(l); refresh(); },
  // 지시창 rules for the classifier to judge: [{ id, name, text }]
  setHabits: (l) => { R.habits = (Array.isArray(l) ? l : []).slice(0, 12).map((x) => ({ id: String(x.id || ''), name: String(x.name || '').slice(0, 60), text: String(x.text || '').slice(0, 300) })).filter((x) => x.id && x.text); },
  decide: (kind, t) => { const ok = decide(kind, t); refresh(); renderBar(); return ok; },
  state: () => stateFor(),
  setNote: (t) => { setNote(t); refresh(); },
  toEnglish: (t, cb) => previewEn(t, cb),
};

// Another Meatball status extension on at the same time would add its own notes: say so once (nothing is switched off).
function otherMeatball() {
  try {
    const on = [...document.querySelectorAll('script[src], link[href]')].some((e) => /third-party\/(meatballstats|meatball-stats|meatball-lite)\//i.test(e.src || e.href));
    if (on && settings().on) window.toastr?.warning(R.ui.otherMeatball, '', { timeOut: 12000 });
  } catch (e) { /* optional */ }
}

// 🐾 on each AI message (in its ⋯ menu): opens the log at that reply — see, fix, re-read or clear it in one place.
function pawButtons() {
  try {
    if (!settings().on) return;
    for (const el of document.querySelectorAll('#chat .mes[is_user="false"] .extraMesButtons')) {
      if (el.querySelector('.mb3-paw')) continue;
      el.insertAdjacentHTML('afterbegin', `<div class="mes_button mb3-paw fa-solid fa-paw" title="${String(R.ui.pawTip || '').replace(/"/g, '&quot;')}"></div>`);
    }
  } catch (e) { /* optional */ }
}
document.addEventListener?.('click', (e) => {
  const b = e.target.closest?.('.mb3-paw'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const i = Number(b.closest('.mes')?.getAttribute('mesid'));
  if (Number.isInteger(i)) openLedger(i);
}, true);

// v0.11.1: relation fixes asked before this version were dropped by the quote check; put them back once per chat.
function fixesV2() { try { const S = store3(); if (!S?.ufix || S.ufixV >= 2) return; keepFixes(Object.keys(S.ufix)); store3(true).ufixV = 2; } catch (e) { /* optional */ } }

(async function init() {
  try { await loadResources(new URL('.', import.meta.url)); } catch (e) { console.error('[meatball3] could not load text files', e); return; }
  HIDDEN.read = !!settings().readHidden;   // 👁 hidden messages counted in the record (set before anything is read)
  fetch(new URL('manifest.json', import.meta.url)).then((r) => r.json()).then((j) => { R.version = j.version; }).catch(() => {});
  const { eventSource, event_types: E } = ctx();
  const changed = () => { refresh(); renderBar(); kick(); };
  eventSource.on(E.APP_READY, () => { mountUI(); mountRelUI(); changed(); setTimeout(otherMeatball, 3000); });
  for (const ev of [E.CHARACTER_MESSAGE_RENDERED, E.MESSAGE_UPDATED, E.MESSAGE_SWIPED, E.CHAT_CHANGED, E.MORE_MESSAGES_LOADED]) if (ev) eventSource.on(ev, () => setTimeout(pawButtons, 50));
  setTimeout(pawButtons, 1500);
  eventSource.on(E.CHAT_CHANGED, () => { reset(); tidy(); fixesV2(); changed(); G.dir = null; loadBlueprint().then(refresh); });
  eventSource.on(E.GENERATION_STARTED, (type, opts, dryRun) => {
    if (dryRun) return;
    if (!Q.busy) Q.generating = true;
    G.type = opts?.quiet_prompt ? 'quiet' : type || 'normal'; G.dir = null;
    const last = [...(ctx().chat || [])].reverse().find((m) => !m.is_user && !m.is_system);
    G.contFp = G.type === 'continue' && last ? fingerprint(last) : '';
  });
  // Right before a real generation: rebuild the note with the message just sent (it can touch a sore spot).
  // Optional (off by default): a send made while a sort call runs waits for it (max waitMax s), so the signpost is fresh.
  if (E.GENERATION_AFTER_COMMANDS) eventSource.on(E.GENERATION_AFTER_COMMANDS, async (type, opts, dryRun) => {
    const s = settings();
    if (dryRun || !s.on || QUIET.has(type) || opts?.quiet_prompt) return;
    if (!s.waitSort || !Q.busy) { refresh(); G.sent = { ...R.lastSent, on: !!(lastPut.deep || lastPut.mid || lastPut.now) }; return; }
    let t = null;
    try { t = window.toastr?.info(R.ui.waitingSort, '', { timeOut: 0, extendedTimeOut: 0 }); } catch (e) { /* notice is optional */ }
    try { await idle(Math.min(Math.max(+s.waitMax || 20, 1), 60) * 1000); refresh(); G.sent = { ...R.lastSent, on: !!(lastPut.deep || lastPut.mid || lastPut.now) }; } finally { try { if (t) window.toastr.clear(t); } catch (e) { /* */ } }
  });
  for (const ev of [E.GENERATION_ENDED, E.GENERATION_STOPPED]) eventSource.on(ev, () => { Q.generating = false; G.type = ''; R.pieces = null; kick(); });
  eventSource.on(E.MESSAGE_RECEIVED, (id) => {
    try {
      const chat = ctx().chat || [], m = chat[id] && !chat[id].is_user ? chat[id] : [...chat].reverse().find((x) => !x.is_user && !x.is_system);
      if (m && settings().on) {
        const fp = fingerprint(m), S = G.contFp && ctx().chatMetadata?.meatball_status3?.dir?.[G.contFp];
        if (G.dir) keepDir(fp, G.dir);
        else if (S) keepDir(fp, S);                  // "continue": the same instruction still stands behind the longer reply
        if (G.sent && G.type !== 'continue') keepSent(fp, G.sent);   // v0.9: which special line this reply was made with
        if (guardNow(m).length) { renderBar(); guardAuto(fp); }   // v0.8 vault: sign words in the new reply -> warning at once
      }
    } catch (e) { console.warn('[meatball3] instruction not kept', e); }
    G.dir = null; G.contFp = ''; G.sent = null; R.redoLine = null;
    newReply(); kick();
  });
  // A director's hidden instruction is in the outgoing prompt only: keep its last 500 letters (this extension's own
  // notes and the person's visible message cut out) and any time skip in it.
  eventSource.on(E.CHAT_COMPLETION_PROMPT_READY, (d) => {
    if (!d || d.dryRun || !G.type || QUIET.has(G.type) || G.type === 'continue') return;   // only the main generation in flight
    if (R.pieces) {   // typed pieces (지시창): the instruction is known, no guessing. A chosen time skip is the person's, applied after the sort.
      const P = R.pieces, txt = [P.scene, P.beat].filter(Boolean).join('\n'), f = findSkip(txt);
      const h = P.time ? { days: P.time.days, text: P.time.text, user: true, ...(P.time.fuzzy ? { fuzzy: P.time.fuzzy } : {}) } : f ? { days: f.days, text: f.text, ...(f.fuzzy ? { fuzzy: f.fuzzy } : {}) } : null;
      G.dir = { t: dirClip(txt || P.time?.text || '', 500), kind: 'beat', h, ...(P.press ? { press: P.press.kind } : {}) }; return;
    }
    try {
      const heads = ['en', 'ko'].flatMap((l) => ['deepHead', 'midHead', 'nowHead'].map((k) => R.lang?.[l]?.sp?.[k]));
      const chat = ctx().chat || [], lastUser = [...chat].reverse().find((m) => m.is_user && !m.is_system);
      const tail = dirClip(directorTail(d.chat || [], heads, [lastPut.deep, lastPut.mid, lastPut.now], lastUser?.mes || ''), 500);
      const f = findSkip(tail);
      G.dir = tail || f ? { t: tail, h: f ? { days: f.days, text: f.text, ...(f.fuzzy ? { fuzzy: f.fuzzy } : {}) } : null } : null;
    } catch (e) { G.dir = null; }
  });
  for (const ev of [E.MESSAGE_SWIPED, E.MESSAGE_DELETED, E.MESSAGE_EDITED]) eventSource.on(ev, changed);
})();
