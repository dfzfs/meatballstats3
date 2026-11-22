// Screen translation (Google, through SillyTavern's own translate endpoint). Everything sent to AI stays English;
// only what the person reads is turned into Korean. Many lines go in one request; results are cached in this browser.
import { ctx, settings } from './store.js';

const KEY = 'mb3_tr_v1', MAX_CHARS = 3500, MAX_KEEP = 3000;
let cache = null;
const load = () => {
  if (cache) return cache;
  try { cache = new Map(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { cache = new Map(); }
  return cache;
};
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify([...load()].slice(-MAX_KEEP))); } catch (e) { /* storage full or off: memory only */ } };

// On when the screen is Korean and the switch is on (default on).
export const trOn = () => settings().translate !== false && (navigator.language || '').startsWith('ko');
// Worth translating: has an English word. Korean names inside stay as they are (Google keeps them).
const need = (s) => /[A-Za-z]{3,}/.test(s);

async function google(lines) {
  const r = await fetch('/api/translate/google', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ text: lines.join('\n'), lang: 'ko' }) });
  if (!r.ok) throw new Error(`translate ${r.status}`);
  return (await r.text()).split('\n');
}

// list of strings -> same list, translated where needed. One request per ~3,500 characters (usually one for a whole view).
// If Google returns a different number of lines, that chunk stays in English (never a wrong pairing).
export async function trLines(list) {
  const items = list.map((s) => String(s ?? ''));
  if (!trOn()) return items;
  const C = load(), todo = [...new Set(items.map((x) => x.trim()).filter((s) => s && need(s) && !C.has(s)))];
  let i = 0, fails = 0;
  while (i < todo.length && fails < 2) {
    const chunk = [];
    let len = 0;
    while (i < todo.length && (len + todo[i].length < MAX_CHARS || !chunk.length)) { chunk.push(todo[i]); len += todo[i].length + 1; i++; }
    try {
      const out = await google(chunk.map((s) => s.replace(/\s*\n\s*/g, ' ')));
      if (out.length === chunk.length) chunk.forEach((s, k) => C.set(s, out[k].trim() || s));
    } catch (e) { fails++; console.warn('[meatball3] translate failed', e); }
  }
  persist();
  return items.map((s) => { const t = s.trim(), v = t && C.get(t); return v ? s.replace(t, v) : s; });
}

// Translate the text inside a shown element in place. Skips inputs, code and anything marked .mb3-notr.
export async function trDom(root) {
  if (!root || !trOn()) return;
  const nodes = [], walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() && need(n.nodeValue) && !n.parentElement?.closest('textarea, input, select, script, style, code, .mb3-notr') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walk.nextNode()) nodes.push(walk.currentNode);
  if (!nodes.length) return;
  const outs = await trLines(nodes.map((n) => n.nodeValue));
  nodes.forEach((n, k) => { if (n.isConnected && outs[k] !== n.nodeValue) { n.parentElement?.setAttribute('title', n.parentElement.getAttribute('title') || n.nodeValue.trim()); n.nodeValue = outs[k]; } });
}

// Watch a popup: translate now and whenever its content is redrawn (tabs, filters). Stops when it is removed.
export function trWatch(root) {
  if (!root || !trOn()) return;
  let t = 0, busy = false;
  const run = async () => { if (busy) return; busy = true; try { await trDom(root); } finally { busy = false; } };
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, 120); });
  mo.observe(root, { childList: true, subtree: true });
  run();
  const stop = setInterval(() => { if (!root.isConnected) { mo.disconnect(); clearInterval(stop); } }, 3000);
}

// ── Korean → English for what goes to the main model (always English) ────────────────
// Lore values and the director's note may be written in Korean. Before they reach the main model they are turned
// into English; people's names are masked first so they come back exactly as written. Synchronous lookups read the
// cache only; anything missing is translated in the background and the note is rebuilt when it arrives.
const EKEY = 'mb3_tr_en_v1';
let ecache = null, pending = new Set(), timer = 0;
const eload = () => {
  if (ecache) return ecache;
  try { ecache = new Map(JSON.parse(localStorage.getItem(EKEY) || '[]')); } catch (e) { ecache = new Map(); }
  return ecache;
};
const epersist = () => { try { localStorage.setItem(EKEY, JSON.stringify([...eload()].slice(-MAX_KEEP))); } catch (e) { /* memory only */ } };
const HANGUL = /[가-힣]/;
const mask = (line, names) => {
  let s = line;
  const map = [];
  [...names].filter((n) => n && HANGUL.test(n)).sort((a, b) => b.length - a.length).forEach((n) => {
    if (!s.includes(n)) return;
    const tok = `ZQN${map.length}Q`;
    map.push([tok, n]); s = s.split(n).join(tok);
  });
  return { s, map };
};
const unmask = (s, map) => map.reduce((t, [tok, n]) => t.split(tok).join(n), s);

// One line -> English if known (cache), else the line itself (and it is queued). Lines without Korean outside names pass.
export function enLine(line, names, onReady) {
  const { s, map } = mask(String(line), names);
  if (!HANGUL.test(s)) return line;
  const hit = eload().get(s);
  if (hit) return unmask(hit, map);
  pending.add(s);
  clearTimeout(timer);
  timer = setTimeout(() => flushEn(onReady), 400);
  return line;
}
async function flushEn(onReady) {
  const todo = [...pending]; pending = new Set();
  if (!todo.length) return;
  const C = eload();
  let got = 0;
  for (let i = 0; i < todo.length;) {
    const chunk = [];
    let len = 0;
    while (i < todo.length && (len + todo[i].length < MAX_CHARS || !chunk.length)) { chunk.push(todo[i]); len += todo[i].length + 1; i++; }
    try {
      const r = await fetch('/api/translate/google', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ text: chunk.join('\n'), lang: 'en' }) });
      if (!r.ok) throw new Error(`translate ${r.status}`);
      const out = (await r.text()).split('\n');
      if (out.length === chunk.length) chunk.forEach((x, k) => { const v = out[k].trim(); if (v && /ZQN\d+Q/.test(x) === /ZQN\d+Q/.test(v)) { C.set(x, v); got++; } });
    } catch (e) { console.warn('[meatball3] to-English failed; the line stays as written', e); break; }
  }
  epersist();
  if (got && onReady) onReady();
}
