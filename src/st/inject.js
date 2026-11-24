// Four injection slots (v0.28: the direction for this reply has its own, at the very bottom). Off = three empty strings = 0 characters.
import { ctx, settings, signpost, store } from './store.js';
import { fillState } from './fill.js';

const IN_PROMPT = 0, IN_CHAT = 1, SYSTEM = 0;
const put = (key, text, pos, depth) => ctx().setExtensionPrompt(key, text || '', pos, depth, false, SYSTEM);

// Always prepared ahead of time: generation never waits for this extension.
export const lastPut = { deep: '', mid: '', now: '', dir: '' };   // what is injected right now (cut out of the prompt when reading the director's turn)
export function refresh() {
  // 처음부터 정리 중: the record is behind the story, so no note goes out
  let sp = { deep: '', mid: '', now: '', dir: '' };
  // OOC (지시창): the story is paused — no note at all (the 지시창 puts its own OOC line at the very bottom)
  try { if (settings().on && ctx().chat?.length && !fillState() && !store()?.ooc) sp = signpost(); } catch (e) { console.error('[meatball3] signpost failed', e); }
  Object.assign(lastPut, { deep: sp.deep || '', mid: sp.mid || '', now: sp.now || '', dir: sp.dir || '' });
  put('mb3_deep', sp.deep, IN_PROMPT, 0);
  put('mb3_mid', sp.mid, IN_CHAT, 2);
  // v0.32: this reply's lines and the person's direction go out as ONE block at the very end of the chat. At depth 1
  // they sat above the last message, and in a story the AI writes alone (no user turns) that is above ten thousand
  // characters of the previous reply: tested on a real chat, the same lines were ignored there and followed at the end.
  put('mb3_now', [sp.now, sp.dir].filter(Boolean).join('\n\n'), IN_CHAT, 0);
  put('mb3_dir', '', IN_CHAT, 0);
  return sp;
}
