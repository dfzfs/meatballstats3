// Screen translation (Google, through SillyTavern's own translate endpoint). Everything sent to AI stays English;
// only what the person reads is turned into Korean. Many lines go in one request; results are cached in this browser.
import { ctx, settings, R } from './store.js';
import { swappedName } from './swap.js';

const KEY = 'mb3_tr_v1', MAX_CHARS = 3500, MAX_KEEP = 3000;
let cache = null;
const load = () => {
  if (cache) return cache;
  try { cache = new Map(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { cache = new Map(); }
  return cache;
};
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify([...load()].slice(-MAX_KEEP))); } catch (e) { /* storage full or off: memory only */ } };

// ── Name glossary: how a name is shown on screen. Google turns names into words ("Grace" → "은혜"), so names are
// masked before translating and put back as written here. Sources: the lore sheet (an English alias of a person
// written in Korean → that Korean name) and the person's own list in settings ("Grace = 그레이스", one per line).
const LATIN = /[A-Za-z]/;
let gKey = '', gMap = new Map();
export function glossary() {
  const bp = R.bp, own = String(settings().nameMap || ''), key = own + '|' + JSON.stringify((bp?.persons || []).map((p) => [p.name, p.alias]));
  if (key === gKey) return gMap;
  const m = new Map();
  for (const p of bp?.persons || []) for (const a of p.alias || []) if (a && a !== p.name && LATIN.test(a) && !LATIN.test(p.name)) m.set(a.toLowerCase(), p.name);
  for (const line of own.split(/\r?\n/)) {
    const [l, r] = line.split(/=|→/).map((x) => (x || '').trim());
    if (l && r) for (const from of l.split(/[,，]/).map((x) => x.trim()).filter(Boolean)) m.set(from.toLowerCase(), r);
  }
  gKey = key; gMap = m; return m;
}
// The name as it should be shown (glossary), or the name itself.
export const showName = (n) => { const sw = swappedName(n); if (sw !== n) return sw; return glossary().get(String(n || '').trim().toLowerCase()) || n; };
// For lists of people: one shown name per person. Glossary first; else an English name whose screen translation is
// another name already in the list ("Will" shown as "윌" next to "윌") is the same person.
const HAN = /^[가-힣\s]+$/;
export function nameMerger(names) {
  const list = [...new Set((names || []).filter(Boolean))], han = new Set(list.filter((n) => HAN.test(n))), C = load();
  const map = new Map();
  for (const n of list) {
    const g = showName(n);
    if (g !== n) { map.set(n, g); continue; }
    if (/[A-Za-z]/.test(n)) { const t = String(C.get(n.trim()) || '').trim(); if (t && han.has(t)) { map.set(n, t); continue; } }
    map.set(n, n);
  }
  return (n) => map.get(n) || showName(n);
}
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unmaskN = (s, map) => map.reduce((t, [tok, n]) => t.split(tok).join(n), s);
function maskNames(text) {
  const g = glossary(), map = [];
  if (!g.size) return { s: text, map };
  let s = text;
  for (const k of [...g.keys()].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])(${escRe(k)})(?![A-Za-z0-9_])`, 'gi');
    if (!re.test(s)) continue;
    const tok = `ZQN${map.length}Q`; map.push([tok, g.get(k)]);
    s = s.replace(re, (m0, pre) => pre + tok);
  }
  return { s, map };
}

// On when the screen is Korean and the switch is on (default on).
export const trOn = () => settings().translate !== false && (navigator.language || '').startsWith('ko');
// Worth translating: has an English word. Korean names inside stay as they are (Google keeps them).
const need = (s) => /[A-Za-z]{3,}/.test(String(s).replace(/ZQN\d+Q/g, ''));

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
  const C = load(), masked = items.map((x) => maskNames(x.trim()));
  const todo = [...new Set(masked.map((x) => x.s).filter((s) => s && need(s) && !C.has(s)))];
  let i = 0, fails = 0;
  while (i < todo.length && fails < 2) {
    const chunk = [];
    let len = 0;
    while (i < todo.length && (len + todo[i].length < MAX_CHARS || !chunk.length)) { chunk.push(todo[i]); len += todo[i].length + 1; i++; }
    try {
      const out = await google(chunk.map((s) => s.replace(/\s*\n\s*/g, ' ')));
      if (out.length === chunk.length) chunk.forEach((s, k) => { const v = (out[k].trim() || s).replace(/ZQN\s*(\d+)\s*Q/gi, 'ZQN$1Q'); if ((s.match(/ZQN\d+Q/g) || []).length === (v.match(/ZQN\d+Q/g) || []).length) C.set(s, v); });
    } catch (e) { fails++; console.warn('[meatball3] translate failed', e); }
  }
  persist();
  return items.map((s, k) => {
    const t = s.trim(), { s: m, map } = masked[k];
    if (!t) return s;
    const v = need(m) ? C.get(m) : m;                              // only names in it: no request needed
    return v ? s.replace(t, unmaskN(v, map)) : map.length ? s.replace(t, unmaskN(m, map)) : s;
  });
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
