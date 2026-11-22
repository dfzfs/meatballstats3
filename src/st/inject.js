// Three injection slots. Off = three empty strings = 0 characters.
import { swapOn } from './swap.js';
import { ctx, settings, signpost } from './store.js';

const IN_PROMPT = 0, IN_CHAT = 1, SYSTEM = 0;
const put = (key, text, pos, depth) => ctx().setExtensionPrompt(key, text || '', pos, depth, false, SYSTEM);

// Always prepared ahead of time: generation never waits for this extension.
export const lastPut = { deep: '', mid: '', now: '' };   // what is injected right now (cut out of the prompt when reading the director's turn)
export function refresh() {
  let sp = { deep: '', mid: '', now: '' };
  try { if (settings().on && ctx().chat?.length && !swapOn()) sp = signpost(); } catch (e) { console.error('[meatball3] signpost failed', e); }
  Object.assign(lastPut, { deep: sp.deep || '', mid: sp.mid || '', now: sp.now || '' });
  put('mb3_deep', sp.deep, IN_PROMPT, 0);
  put('mb3_mid', sp.mid, IN_CHAT, 3);
  put('mb3_now', sp.now, IN_CHAT, 1);
  return sp;
}
