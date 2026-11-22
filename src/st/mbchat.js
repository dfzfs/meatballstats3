// 💬 Talk to Meatball: the person says what is wrong ("that refusal was on the 2nd, not the 3rd") and Meatball
// looks for it in its record and the story, then fixes every place it touches. It never argues: if the story says
// otherwise it says so once, in the same card, and one tap applies it anyway. One AI call per message, small context.
import { ctx, store, save, ledger, R, settings } from './store.js';
import { cleanText, fingerprint } from '../core/clean.js';
import { keysBlock } from '../core/keys.js';
import { request } from './queue.js';
import { applyFixes, undoFixes } from './fix.js';
import { placeReplies } from '../core/calendar.js';

const YES = /^\s*(응+|ㅇㅇ+|ㅇ|네|예|그래|바꿔|고쳐|해\s*줘|ok|okay|yes|y)(?=$|[\s!.~ㅋㅎ요줘])/i;
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const chatLog = () => { const S = store(); return S?.mbchat || []; };
const push = (m) => { const S = store(true); (S.mbchat ||= []).push(m); if (S.mbchat.length > 30) S.mbchat.splice(0, S.mbchat.length - 30); save(); return m; };

// What Meatball wrote, one line per reply: "#26 (March 7 · noon · flower shop): refused to help pick a gift"
function recordLines(es, fmt, n = 60) {
  return es.slice(-n).map((e) => `#${e.x.i} (${fmt(e)}): ${e.its.map((it) => `${it.icon} ${it.title}`).join('; ').slice(0, 220)}`).join('\n');
}
// The few replies the request is about: explicit #numbers, then the ones whose record or text share its words.
function findReplies(msg, es) {
  const chat = ctx().chat || [], want = new Set([...msg.matchAll(/#\s?(\d+)/g)].map((m) => +m[1]));
  const toks = [...new Set(String(msg).replace(/[#\d"'.,!?~·()[\]]/g, ' ').split(/\s+/).filter((w) => w.length >= 2).map((w) => w.replace(/(을|를|이|가|은|는|에서|에게|에|의|랑|이랑|하고|도|만|로|으로)$/, '')).filter((w) => w.length >= 2))];
  const score = es.map((e) => { const rec = e.its.map((it) => it.title).join(' '), txt = cleanText(chat[e.x.i]?.mes || '');
    return { i: e.x.i, s: (want.has(e.x.i) ? 100 : 0) + toks.reduce((a, w) => a + (rec.includes(w) ? 3 : 0) + (txt.includes(w) ? 1 : 0), 0) }; });
  return score.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.i).sort((a, b) => a - b);
}
function excerpt(i, msg) {
  const t = cleanText(ctx().chat?.[i]?.mes || ''); if (t.length <= 900) return t;
  const w = String(msg).split(/\s+/).find((x) => x.length >= 2 && t.includes(x)); const at = w ? Math.max(0, t.indexOf(w) - 350) : 0;
  return `${at ? '…' : ''}${t.slice(at, at + 900)}…`;
}
function buildPrompt(msg, es, fmt, nowLine) {
  const ids = findReplies(msg, es), lg = 'en';
  const texts = ids.flatMap((i) => [i - 1, i].filter((x, k, a) => x >= 0 && a.indexOf(x) === k)).filter((v, k, a) => a.indexOf(v) === k)
    .map((i) => `#${i}${ctx().chat?.[i]?.is_user ? ' (user)' : ''}: ${excerpt(i, msg)}`).join('\n\n');
  const earlier = chatLog().slice(-4).map((m) => `${m.who === 'me' ? 'USER' : 'MEATBALL'}: ${m.text}`).join('\n');
  return `[ROLE]
You keep the story record for a roleplay ("Meatball"). The user asks you to fix it. Find what they mean in [RECORD] and [STORY], then write the fix.
The user is always right about their own story: always write the fix they ask for, for anything in the record (dates, time, place, people, clothes, items, relationships, feelings, refusals, secrets known, anything). If the story text or the record says otherwise, say so ONCE in one short sentence with the reply number, and still write the fix. Never refuse, never argue, never ask twice.
If you cannot find what they mean at all, write no fix and ask which reply (#number) in one short sentence.

[NOW]
${nowLine}

[RECORD] what is written now, one line per reply (#number = reply)
${recordLines(es, fmt) || '-'}

[STORY] the replies that seem to be about it
${texts || '-'}
${earlier ? `\n[EARLIER IN THIS TALK]\n${earlier}\n` : ''}
[USER]
${msg}

[LINE FORMAT] fix lines use exactly these forms
${keysBlock(settings().groups, lg)}
feel: A>B=the user's own feeling words, comma separated, exactly as they said them (e.g. feel: A>B=사랑, 죄책감). Any word is fine.
To remove a wrong line from a reply: -key: the old value

[RULES]
1. Put each line on the reply where it belongs (the reply where the event happened). A date fix is "date: March 6" on that reply; also fix the following replies of the same scene if they carry the wrong date.
2. Change only what the user asked and what must follow from it. Keep names exactly as in the record. For feelings always use "feel:" with the user's own words; never say a word is not allowed, never mention lists, kinds or English terms.
3. <say> is in Korean, warm and short (1-2 sentences): what you found, then end with a question asking if you should change it (e.g. "#26의 날짜를 3월 6일로 바꿀까요?"). Nothing is changed until the user agrees.

[OUTPUT]
<say>…</say>
<conflict>yes|no</conflict>
<quote>#number "a short quote from the story that shows the conflict"</quote>   (only when conflict is yes)
<fix #number>
line
line
</fix>
(one <fix> per reply; nothing when there is nothing to change)`;
}
// 「기록 대조」: one call over the whole record, only when the person presses it. Finds what does not add up and asks first.
function buildCheck(es, fmt, nowLine) {
  return `[ROLE]
You keep the story record for a roleplay ("Meatball"). The user pressed "check the record". Read the whole [RECORD] and find what does not add up.

[NOW]
${nowLine}

[RECORD] what is written now, one line per reply (#number = reply), oldest first
${recordLines(es, fmt, 150) || '-'}

[LOOK FOR]
- dates or days that go backwards, or jump, with nothing in the record explaining it
- one person written under two names or spellings
- a place, item or piece of clothing that changes with no reason
- relationships or feelings that flip with nothing in between
- a person who is said to be gone or away but still acts
Only real contradictions. Small gaps or things the story simply did not mention are fine. At most 5 problems, the clearest first.

[LINE FORMAT] fix lines use exactly these forms
${keysBlock(settings().groups, 'en')}
feel: A>B=feeling words, comma separated
To remove a wrong line from a reply: -key: the old value

[RULES]
1. Each fix goes on the reply where it belongs. Keep names exactly as in the record.
2. <say> is in Korean, plain and short: list what you found in 1-3 short sentences with #numbers, then ask once if you should fix them (e.g. "#12의 날짜가 #11보다 앞서요. 고칠까요?"). If nothing is wrong, say so in one sentence and write no fix. Never mention lists, kinds or English terms.

[OUTPUT]
<say>…</say>
<conflict>no</conflict>
<fix #number>
line
</fix>
(one <fix> per reply; nothing when there is nothing to change)`;
}
// 「미정 날짜 정하기」: every AI reply gets a date. Replies with a date keep it; the ones with none (or only "a few days
// later") get one picked from the story's clues. Only the reply where a new day starts needs a line.
function buildDates(info) {
  const y0 = store()?.year0 ?? null, P = placeReplies(info.st, new Date().getFullYear(), y0), chat = ctx().chat || [], at = new Map(P.list.map((r) => [r.i, r]));
  const ex = (i) => cleanText(chat[i]?.mes || '').replace(/\s+/g, ' ').slice(0, 260);
  const rows = chat.map((m, i) => [m, i]).filter(([m]) => !m.is_user && !m.is_system).map(([, i]) => {
    const r = at.get(i), d = r ? `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}` : '';
    const state = !r ? 'UNKNOWN' : r.approx ? `ABOUT ${d} (vague skip, exact day unknown)` : r.user ? `${d} (set by the user: keep)` : d;
    return `#${i} [${state}] ${ex(i)}`;
  }).join('\n');
  return `[ROLE]
You keep the story calendar for a roleplay ("Meatball"). Every reply must sit on a real date (year, month, day).
Give a date to every reply marked UNKNOWN or ABOUT. Keep the dates that are already there.

[REPLIES] oldest first: #number [date now] start of the reply
${rows}

[HOW]
- Use the story's clues: weekdays, seasons, weather, holidays, "the next morning", "three days later", school or work days.
- Stay consistent with the known dates around it; time never goes backwards unless the reply is a flashback.
- No clue at all: the same day as the reply before, or the next day when the text clearly starts a new day.
- If the story has no date anywhere, pick a believable start date (season and weekday from the clues).
- ${y0 != null ? `The year of the first reply is ${y0} (the user set it). Count on from it.` : 'Write no year unless the story itself names one (the user sets the year).'}
- ABOUT: pick the most likely exact day in that week.

[RULES]
1. Write a date line only on the reply where a new day starts (the replies after it on the same day follow it). Also write one on every ABOUT reply.
2. <say> is in Korean, plain, 1-2 sentences: how many replies got a date and from when to when. Never mention lists or English terms.

[OUTPUT]
<say>…</say>
<conflict>no</conflict>
<fix #number>
date: Month D${y0 != null ? ', YYYY' : ''}
</fix>
(one <fix> per reply that needs a line)`;
}
function parse(ans) {
  const say = (ans.match(/<say>([\s\S]*?)<\/say>/) || [])[1]?.trim() || '';
  const conflict = /<conflict>\s*yes/i.test(ans);
  const quote = (ans.match(/<quote>([\s\S]*?)<\/quote>/) || [])[1]?.trim() || '';
  const fixes = [...ans.matchAll(/<fix\s*#?\s*(\d+)\s*>([\s\S]*?)<\/fix>/g)].map((m) => ({ i: +m[1], lines: m[2].split('\n').map((x) => x.trim()).filter((x) => x && /[:|]/.test(x)).slice(0, 12) })).filter((f) => f.lines.length);
  return { say, conflict, quote, fixes };
}

// Send one message. ctxInfo: { es, fmt(e), nowLine }. redraw() after each step.
export async function send(text, info, redraw, opts = {}) {
  const msg = String(text || '').trim(); if (!msg) return;
  const log = chatLog(), last = [...log].reverse().find((m) => m.who === 'mb' && m.prop);
  push({ who: 'me', text: msg.slice(0, 600), at: Date.now() });
  // "응 / 바꿔" right after a question: apply it, no call
  if (!opts.check && !opts.dates && /날짜|date/i.test(msg) && /미정|정해|채워|알아서|fill|decide/i.test(msg)) opts = { ...opts, dates: true };   // asked in words: same job, still asks first
  if (!opts.check && !opts.dates && last && last.prop.state === 'ask' && YES.test(msg)) { decide(last, true); push({ who: 'mb', text: R.ui2.chatDone || '바꿨어요!', at: Date.now() }); redraw(); return; }
  const wait = push({ who: 'mb', text: '…', wait: true, at: Date.now() }); redraw();
  let res;
  try { res = parse(String(await request(opts.dates ? buildDates(info) : opts.check ? buildCheck(info.es, info.fmt, info.nowLine) : buildPrompt(msg, info.es, info.fmt, info.nowLine), '</never>', settings().chatProfile || '') || '')); } catch (e) { res = null; console.warn('[meatball3] chat failed', e); }
  const S = store(true), m = S.mbchat.find((x) => x.at === wait.at && x.wait) || wait; delete m.wait;
  if (!res || (!res.say && !res.fixes.length)) { m.text = R.ui2.chatFail || '지금은 대답을 못 했어요. 잠깐 뒤에 다시 말해 줄래요?'; save(); redraw(); return; }
  m.text = res.say || (res.fixes.length ? (R.ui2.chatFound || '이렇게 고칠게요.') : (R.ui2.chatNone || '못 찾았어요. 몇 번째 답인지 알려 줄래요?'));
  if (res.fixes.length) {
    m.prop = { fixes: res.fixes, conflict: res.conflict, quote: res.quote, state: 'ask', req: msg };
    if (opts.dates && opts.auto) decide(m, true);   // the 🗓 button itself was the yes: put the dates in (undo stays offered)
  }
  save(); redraw();
}
// Clear the talk (what was already changed stays changed; undo is no longer offered for it).
export function clearChat() { const S = store(true); if (S) { S.mbchat = []; save(); } }
export function decide(m, yes) {
  if (!m?.prop || m.prop.state !== 'ask') return;
  if (!yes) { m.prop.state = 'kept'; save(); return; }
  const undo = applyFixes(m.prop.fixes, m.prop.req);
  m.prop.state = undo ? 'done' : 'failed'; m.prop.undo = undo || null; save();
}
export function undo(m) { if (m?.prop?.state !== 'done') return; undoFixes(m.prop.undo); m.prop.state = 'undone'; save(); }

// A fix line in plain words: "texture: A>B=lingering" -> "A → B: 미련"
function human(l) {
  const L = R.lang[(navigator.language || '').startsWith('ko') ? 'ko' : 'en'], U2 = R.ui2;
  let m = l.match(/^feel\s*:\s*([^>]+)>([^=]+)=\s*(.+)$/i);
  if (m) return `${m[1].trim()} → ${m[2].trim()}: ${m[3].trim()}`;
  m = l.match(/^texture\s*:\s*([^>]+)>([^=]+)=\s*(.+)$/i);
  if (m) { const i = R.lang.en.rel.tex.findIndex((x) => x === m[3].trim().toLowerCase()); return `${m[1].trim()} → ${m[2].trim()}: ${i >= 0 ? L.rel.tex[i] : m[3].trim()}`; }
  m = l.match(/^tie\s*:\s*([^-]+)-([^=]+)=\s*(.+)$/i); if (m) return `${m[1].trim()} – ${m[2].trim()}: ${m[3].trim()}`;
  m = l.match(/^(date|time|loc|with)\s*:\s*(.+)$/i); if (m) return `${(U2.fixWord || {})[m[1].toLowerCase()] || m[1]}: ${m[2].trim()}`;
  return l;
}
const ICON = { feel: '💞', date: '📅', time: '⏩', loc: '📍', with: '👥', wear: '👕', tie: '🤝', texture: '💞', refuse: '🚫', role: '🏷️', gone: '🚪', know: '💡', body: '🩹', item: '🎒', call: '🗣️', touch: '🤲' };
export function chatHtml(mascot) {
  const U2 = R.ui2, log = chatLog();
  const bubble = (m, k) => {
    if (m.who === 'me') return `<div class="mb3-cme">${h(m.text)}</div>`;
    let p = '';
    if (m.prop) {
      const P = m.prop, lines = P.fixes.map((f) => f.lines.map((l) => { const neg = l.startsWith('-'), key = l.replace(/^-/, '').split(/[:|]/)[0].trim().toLowerCase();
        return `<div class="mb3-fx${neg ? ' mb3-fxdel' : ''}"><span class="mb3-fxi">${neg ? '🗑' : ICON[key] || '✏️'}</span><span class="mb3-fxn">#${f.i}</span> ${h(human(l.replace(/^-/, '')))}</div>`; }).join('')).join('');
      const btns = P.state === 'ask' ? `<div class="mb3-cbtns"><b class="mb3-cyes" data-cm="${k}">${h(U2.chatApply || '바꾸기')} <i>✋ ${h(U2.chatMine || '내 요청')}</i></b><b class="mb3-cno" data-cm="${k}">${h(U2.chatKeep || '그대로 두기')}</b></div>`
        : P.state === 'done' ? `<div class="mb3-cstate">✋ ${h(U2.chatApplied || '바뀜 · 내 요청으로')} <b class="mb3-cundo" data-cm="${k}">${h(U2.chatUndo || '되돌리기')}</b></div>`
        : `<div class="mb3-cstate">${h(P.state === 'undone' ? (U2.chatUndone || '되돌렸어요') : P.state === 'kept' ? (U2.chatKept || '그대로 뒀어요') : (U2.chatFailed || '이 답에는 고칠 수 없었어요'))}</div>`;
      p = `<div class="mb3-fix">${P.conflict && P.quote ? `<div class="mb3-fxq">📜 ${h(P.quote)}</div>` : ''}${P.conflict ? `<div class="mb3-fxw">⚠ ${h(U2.chatConflict || '본문과 달라요. 그래도 바꿀까요?')}</div>` : ''}${lines}</div>${btns}`;
    }
    return `<div class="mb3-cmb">${mascot}<div class="mb3-cb">${m.wait ? '<span class="mb3-dots3"><i></i><i></i><i></i></span>' : h(m.text)}${p}</div></div>`;
  };
  return `<div class="mb3-chat"><div class="mb3-msgs">${log.length ? log.map(bubble).join('') : `<div class="mb3-cmb">${mascot}<div class="mb3-cb">${h(U2.chatHello || '기록이 틀렸으면 그냥 말해 줘요. 예: 「그 거절, 3일이 아니라 2일이야」 · 「깡통이랑 깡캐 이제 사귀는 사이야」')}</div></div>`}</div>
    <div class="mb3-cin"><textarea class="mb3-cta mb3-notr" rows="1" placeholder="${h(U2.chatPh || '고칠 걸 말해 줘요')}"></textarea><b class="mb3-csend">${h(U2.chatSend || '보내기')}</b></div><div class="mb3-cchk"><b class="mb3-ccheck" title="${h(U2.checkTip || '')}">🔍 ${h(U2.checkBtn || '기록 대조')}</b> <span class="mb3-dim">${h(U2.checkTip || '')}</span></div></div>`;
}
