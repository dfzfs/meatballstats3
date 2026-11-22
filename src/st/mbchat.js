// 💬 Talk to Meatball: the person says what is wrong ("that refusal was on the 2nd, not the 3rd") and Meatball
// looks for it in its record and the story, then fixes every place it touches. It never argues: if the story says
// otherwise it says so once, in the same card, and one tap applies it anyway. One AI call per message, small context.
import { ctx, store, save, ledger, R, settings } from './store.js';
import { cleanText, fingerprint } from '../core/clean.js';
import { keysBlock } from '../core/keys.js';
import { request } from './queue.js';
import { applyFixes, undoFixes } from './fix.js';

const YES = /^\s*(응+|ㅇㅇ+|ㅇ|네|예|그래|바꿔|고쳐|해\s*줘|ok|okay|yes|y)(?=$|[\s!.~ㅋㅎ요줘])/i;
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const chatLog = () => { const S = store(); return S?.mbchat || []; };
const push = (m) => { const S = store(true); (S.mbchat ||= []).push(m); if (S.mbchat.length > 30) S.mbchat.splice(0, S.mbchat.length - 30); save(); return m; };

// What Meatball wrote, one line per reply: "#26 (March 7 · noon · flower shop): refused to help pick a gift"
function recordLines(es, fmt) {
  return es.slice(-60).map((e) => `#${e.x.i} (${fmt(e)}): ${e.its.map((it) => `${it.icon} ${it.title}`).join('; ').slice(0, 220)}`).join('\n');
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
texture: A>B=attraction|desire|lingering|love-hate|forbidden pull|resentment|bond|none   (pick one word from this list; if the user dislikes a word, pick the closest OTHER word, never "none" unless they ask to remove it)
To remove a wrong line from a reply: -key: the old value

[RULES]
1. Put each line on the reply where it belongs (the reply where the event happened). A date fix is "date: March 6" on that reply; also fix the following replies of the same scene if they carry the wrong date.
2. Change only what the user asked and what must follow from it. Keep names exactly as in the record.
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
function parse(ans) {
  const say = (ans.match(/<say>([\s\S]*?)<\/say>/) || [])[1]?.trim() || '';
  const conflict = /<conflict>\s*yes/i.test(ans);
  const quote = (ans.match(/<quote>([\s\S]*?)<\/quote>/) || [])[1]?.trim() || '';
  const fixes = [...ans.matchAll(/<fix\s*#?\s*(\d+)\s*>([\s\S]*?)<\/fix>/g)].map((m) => ({ i: +m[1], lines: m[2].split('\n').map((x) => x.trim()).filter((x) => x && /[:|]/.test(x)).slice(0, 12) })).filter((f) => f.lines.length);
  return { say, conflict, quote, fixes };
}

// Send one message. ctxInfo: { es, fmt(e), nowLine }. redraw() after each step.
export async function send(text, info, redraw) {
  const msg = String(text || '').trim(); if (!msg) return;
  const log = chatLog(), last = [...log].reverse().find((m) => m.who === 'mb' && m.prop);
  push({ who: 'me', text: msg.slice(0, 600), at: Date.now() });
  // "응 / 바꿔" right after a question: apply it, no call
  if (last && last.prop.state === 'ask' && YES.test(msg)) { decide(last, true); push({ who: 'mb', text: R.ui2.chatDone || '바꿨어요!', at: Date.now() }); redraw(); return; }
  const wait = push({ who: 'mb', text: '…', wait: true, at: Date.now() }); redraw();
  let res;
  try { res = parse(String(await request(buildPrompt(msg, info.es, info.fmt, info.nowLine), '</never>') || '')); } catch (e) { res = null; console.warn('[meatball3] chat failed', e); }
  const S = store(true), m = S.mbchat.find((x) => x.at === wait.at && x.wait) || wait; delete m.wait;
  if (!res || (!res.say && !res.fixes.length)) { m.text = R.ui2.chatFail || '지금은 대답을 못 했어요. 잠깐 뒤에 다시 말해 줄래요?'; save(); redraw(); return; }
  m.text = res.say || (res.fixes.length ? (R.ui2.chatFound || '이렇게 고칠게요.') : (R.ui2.chatNone || '못 찾았어요. 몇 번째 답인지 알려 줄래요?'));
  if (res.fixes.length) {
    m.prop = { fixes: res.fixes, conflict: res.conflict, quote: res.quote, state: 'ask', req: msg };
  }
  save(); redraw();
}
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
  let m = l.match(/^texture\s*:\s*([^>]+)>([^=]+)=\s*(.+)$/i);
  if (m) { const i = R.lang.en.rel.tex.findIndex((x) => x === m[3].trim().toLowerCase()); return `${m[1].trim()} → ${m[2].trim()}: ${i >= 0 ? L.rel.tex[i] : m[3].trim()}`; }
  m = l.match(/^tie\s*:\s*([^-]+)-([^=]+)=\s*(.+)$/i); if (m) return `${m[1].trim()} – ${m[2].trim()}: ${m[3].trim()}`;
  m = l.match(/^(date|time|loc|with)\s*:\s*(.+)$/i); if (m) return `${(U2.fixWord || {})[m[1].toLowerCase()] || m[1]}: ${m[2].trim()}`;
  return l;
}
const ICON = { date: '📅', time: '⏩', loc: '📍', with: '👥', wear: '👕', tie: '🤝', texture: '💞', refuse: '🚫', role: '🏷️', gone: '🚪', know: '💡', body: '🩹', item: '🎒', call: '🗣️', touch: '🤲' };
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
    <div class="mb3-cin"><textarea class="mb3-cta mb3-notr" rows="1" placeholder="${h(U2.chatPh || '고칠 걸 말해 줘요')}"></textarea><b class="mb3-csend">${h(U2.chatSend || '보내기')}</b></div></div>`;
}
