// 비밀 자동 채우기 (v0.26): the person writes only the secret; Meatball fills in who keeps it, the give-away words, what
// may show, the cover and when it may come out. Up to 6 secrets in one call (more go in further calls). Uses the
// Meatball chat connection (or the sorting one) — never the story model, so the secret is never in the story's context.
import { ctx, ledger, R, settings } from './store.js';
import { cleanText } from '../core/clean.js';
import { request } from './queue.js';
import { nameMerger } from './tr.js';
import { hasSign } from '../core/vault.js';

const PER_CALL = 6;
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function promptFor(list, names, sample) {
  const items = list.map((x, k) => `#${k + 1}\nwho: ${x.who || '?'}\nsecret: ${clip(x.v, 400)}`).join('\n\n');
  return `You help set up secrets for a role-play story. A secret is kept from the story's writer: the writer only gets the cover and, now and then, a small outward sign. Later every reply is checked for the give-away words.

People in the story: ${names.length ? names.join(', ') : '(unknown)'}
How the story is written (a recent bit, for its language and tone):
"""
${sample || '(no story yet)'}
"""

For each secret below, fill in:
- who: the person who keeps it (one of the people above when it fits; two keepers as "A-B"). Keep a given name as written.
- signs: 4 to 8 give-away words or short phrases that would only show up in the story text when the secret is out or nearly out. Write them in the language the story is written in; if the secret is written in another language, add the same words in that language too. Plain words that appear in ordinary scenes are not signs.
- shows: one small outward sign the keeper may show without giving it away (a habit, a mood). Must not contain any sign word.
- cover: how the keeper looks to the people around (a few words). Must not contain any sign word.
- opens: when the secret may come out (one short phrase).
Write shows, cover and opens in the language the secret is written in. Do not invent facts beyond the secret.

${items}

Answer only in this form, one block per secret, then </secrets>:
<secrets>
#1
who: ...
signs: word, word, word
shows: ...
cover: ...
opens: ...
</secrets>`;
}

function parseOut(text, n) {
  const body = (String(text).match(/<secrets>([\s\S]*?)(<\/secrets>|$)/i) || [, String(text)])[1];
  const out = Array.from({ length: n }, () => null);
  for (const blk of body.split(/^\s*#(?=\d+\s*$)/m)) {
    const m = blk.match(/^(\d+)\s*\n([\s\S]*)$/); if (!m) continue;
    const k = +m[1] - 1; if (k < 0 || k >= n) continue;
    const o = {};
    for (const line of m[2].split('\n')) { const mm = line.match(/^\s*(who|signs|shows|cover|opens)\s*:\s*(.*)$/i); if (mm) o[mm[1].toLowerCase()] = mm[2].trim(); }
    out[k] = o;
  }
  return out;
}

// list: [{ who?, v, ... }] → the same list with who · signs · shows · cover · opens filled where they were empty.
// A field the person already wrote is kept. Returns { list, filled, failed }.
export async function fillSecrets(list, onStep = () => {}) {
  const src = (Array.isArray(list) ? list : []).map((x) => ({ ...x, v: String(x?.v || '') })).filter((x) => x.v.trim());
  if (!src.length) return { list: [], filled: 0, failed: 0 };
  const st = ledger(), raw = [...new Set([...(R.bp?.persons || []).map((p) => p.name), ...Object.keys(st.names?.seen || {})])].filter(Boolean);
  const M = nameMerger(raw), names = [...new Set(raw.map(M))].slice(0, 30);
  const ai = (ctx().chat || []).filter((m) => !m.is_user && !m.is_system).slice(-2).map((m) => cleanText(m.mes)).join('\n');
  const sample = clip(ai, 900);
  let filled = 0, failed = 0;
  for (let i = 0; i < src.length; i += PER_CALL) {
    const part = src.slice(i, i + PER_CALL);
    onStep(i, src.length);
    let got = [];
    try { got = parseOut(await request(promptFor(part, names, sample), '</secrets>', settings().chatProfile || settings().profile || '', 4000), part.length); }
    catch (e) { console.warn('[meatball3] secret fill failed', e); got = part.map(() => null); }
    part.forEach((x, k) => {
      const o = got[k];
      if (!o) { failed++; return; }
      const signs = (o.signs || '').split(/[,，、]/).map((w) => w.trim().replace(/^["'“”]|["'“”]$/g, '')).filter((w) => w.length >= 2).slice(0, 10);
      const clean = (s) => (signs.some((g) => hasSign(s, g)) ? '' : clip(s, 200));   // a sign word in what may show would undo the secret
      x.who ||= clip(o.who, 60);
      if (!(x.signs || []).length) x.signs = signs;
      x.shows ||= clean(o.shows);
      x.cover ||= clean(o.cover);
      x.opens ||= clip(o.opens, 120);
      x.auto = true;
      filled++;
    });
  }
  return { list: src, filled, failed };
}
