// 📋 One button: everything needed to judge Meatball in a chat, as plain text on the clipboard (for pasting into a
// conversation). Locked deep layers never appear, here or anywhere else: their content is masked even in raw answers.
import { ctx, settings, store, ledger, ledger2, signpost, noteLines, R, bpLive, openThreads } from './store.js';
import { Q } from './queue.js';
import { fingerprint, cleanText } from '../core/clean.js';
import { fmtDate, dateAt, nowDate } from '../core/time.js';

const MAX_REPLIES = 15;
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; };

import { touchesVault } from '../core/vault.js';
// Any 16-letter piece of a locked layer in a text -> "(hidden content)" for that line.
function masker(bp, open) {
  const locked = (bp.deep || []).filter((d) => !open[d.id]).map((d) => String(d.content || '').toLowerCase().replace(/\s+/g, ' '));
  return (text) => String(text || '').split('\n').map((line) => {
    const l = line.toLowerCase().replace(/\s+/g, ' ');
    for (const c of locked) for (let i = 0; i + 16 <= c.length; i += 4) if (l.includes(c.slice(i, i + 16))) return '(hidden content)';
    if (touchesVault(line, bp)) return '(vault)';   // v0.8: vault secrets and their sign words never leave by copy either
    return line;
  }).join('\n');
}

export function buildReport() {
  const c = ctx(), s = settings(), S = store() || {}, st = ledger(), st2 = ledger2(), bp = R.bp || {}, L = R.lang.en;
  const hide = masker(bp, st2.open || {}), out = [];
  const add = (...xs) => out.push(...xs);
  const ver = (() => { try { return R.version || ''; } catch (e) { return ''; } })();
  add(`# Meatball report ${ver} · ${new Date().toISOString()}`,
    `chat: ${c.getCurrentChatId?.() || '?'} · messages: ${(c.chat || []).length} · character: ${c.name2} · user: ${c.name1}`,
    `settings: on=${s.on} stage2=${s.stage2} burst=${s.burst !== false} translate=${s.translate !== false} wait=${!!s.waitSort} profile=${s.profile ? 'set' : 'main'} groups=${JSON.stringify(s.groups || {})}`,
    `queue: status=${Q.log.status || '-'} busy=${Q.busy} fails=${Q.fails} cooling=${Date.now() < Q.coolUntil}`, '');

  let sp = null;
  try { sp = s.on ? signpost() : null; } catch (e) { add(`signpost error: ${e.message}`); }
  add('## Signpost as sent to the main model', sp ? `(~${sp.tokens} tokens)` : '(off)');
  if (sp) for (const k of ['deep', 'mid', 'now', 'dir']) add(`### ${k}`, sp[k] || '—');
  add('');

  add('## Ledger now',
    `date: ${nowDate(st.cal, L) || '?'} · tod: ${st.cal.tod || '-'} · loc: ${st.loc || '-'} · weather: ${st.weather || '-'} · mood: ${st.mood || '-'} · reply#: ${st.gn || 0}`,
    `with: ${st.with.join(', ') || '-'}`);
  for (const n of st.with) add(`- ${n}: wear=${st.wear[n]?.v || '-'} (g${st.wear[n]?.g ?? '-'}) · body=${st.body[n]?.v || '-'} · pos=${st.pos?.[n] || '-'} · items=${(st.items?.[n] || []).join(', ') || '-'}`);
  for (const [n, g] of Object.entries(st.gone)) add(`- gone: ${n} = ${g.v} (${fmtDate(dateAt(st.cal, g.day), L, false) || '?'})`);
  for (const k of st.know.slice(-6)) add(`- know: ${k.what} — ${k.who.join(', ')}`);
  for (const p of st.promise.slice(-4)) add(`- promise: ${p.a} → ${p.b}: ${p.v}`);
  for (const p of Object.values(st.pair)) add(`- pair ${p.a}–${p.b}: tie=${p.tie || '-'} calls=${JSON.stringify(p.call)} touch=${p.touch?.lvl ?? '-'}`);
  add('');

  add('## Relationships (stage 2)');
  for (const d of Object.values(st2.dir || {})) add(`- ${d.a}>${d.b}: texture=${d.tex != null ? L.rel.tex[d.tex] : '-'} (cand ${d.cand ?? '-'}) · inner=${d.inner || '-'} (since day ${d.innerDay ?? '-'}) · clash day=${d.clashDay ?? '-'} · moves=${(d.moves || []).slice(-6).map((m) => L.rel.moves[m]).join(',')}`);
  for (const [k, t] of Object.entries(st2.tie || {})) add(`- tie ${k} = ${t.v}${t.user ? ' (director)' : ''} — "${cut(t.q, 80)}"`);
  add(`opened layers: ${Object.keys(st2.open || {}).length} · locked: ${(bp.deep || []).filter((d) => !st2.open?.[d.id]).length}`, '');

  add('## Lore sheet (locked layers not shown)', `source: ${R.loreSrc || '-'} · lines read: ${bp.lines || 0} · not read: ${(bp.dropped || []).length}`);
  for (const p of bp.persons || []) add(`- person ${p.name}${p.alias?.length ? ` (${p.alias.join(', ')})` : ''}: ${[p.role, ...(p.traits || [])].filter(Boolean).join(' · ')}`);
  for (const k of ['tie', 'barrier', 'texture', 'inner', 'sore']) for (const x of bp[k] || []) add(`- ${k} ${x.a}${k === 'tie' || k === 'barrier' ? '-' : '>'}${x.b} = ${x.v}`);
  for (const x of bp.hide || []) add(`- hide ${x.a}-${x.b} → ${x.c}`);
  add(`- vault entries: ${(bp.vault || []).length} (content not shown) · self: ${(bp.self || []).length} · line: ${(bp.line || []).length} · channel: ${(bp.channel || []).length} · unknown: ${(bp.unknown || []).length}`);
  add(`- vault guard: ${Object.values(S.guard || {}).filter((g) => g.hits?.length).length} replies warned · note lines dropped by the firewall last time: ${(R.walled || []).length}`);
  add(`- guarded now (lore vault + typed secrets + destinations): ${(bpLive().vault || []).length} · damping: figures=${(R.wornNow?.nums || []).join(', ') || '-'} recall=${!!R.wornNow?.recall} dense=${!!R.wornNow?.dense} · refusal threads open: ${openThreads().map((t) => `${t.a}>${t.b}${t.mode ? ` (${t.mode})` : ''}`).join(', ') || '-'} · last special line: ${R.lastSent?.special || '-'}`);
  for (const n of bp.noromance || []) add(`- noromance ${n}`);
  add(`director's note: ${noteLines().join(' / ') || '-'}`, '');

  add(`## Last ${MAX_REPLIES} replies (newest last)`);
  const chat = c.chat || [];
  const idx = chat.map((m, i) => i).filter((i) => !chat[i].is_user && !chat[i].is_system).slice(-MAX_REPLIES);
  for (const i of idx) {
    const m = chat[i], fp = fingerprint(m), ev = S.ev?.[fp], rel = S.rel?.[fp], raw = S.raw?.[fp], dir = S.dir?.[fp];
    add(`### #${i} ${ev ? '' : '(not read yet)'}${S.edited?.[fp] ? ' (edited)' : ''} · ${cleanText(m.mes).length} chars`);
    add(`text start: ${cut(cleanText(m.mes).replace(/\s+/g, ' '), 160)}`);
    if (dir?.t) add(`hidden instruction (last part): ${cut(dir.t.replace(/\s+/g, ' '), 300)}`);
    if (ev) add(`events: ${ev.filter((e) => e.k !== 'drop').map((e) => `${e.k}${e.who ? `:${e.who}` : ''}=${cut(e.v ?? e.days ?? e.add?.join('+') ?? (e.date ? JSON.stringify(e.date) : ''), 60)}`).join(' | ') || '(nothing)'}`);
    if (ev) { const dr = ev.filter((e) => e.k === 'drop'); if (dr.length) add(`dropped: ${dr.map((e) => `${e.why}: ${cut(e.raw, 60)}`).join(' | ')}`); }
    if (rel?.length) add(`rel: ${rel.map((e) => (e.k === 'mv' ? `${e.a}>${e.b} ${L.rel.moves[e.mv]}${e.inner ? ` «${e.inner}»` : ''}` : e.k === 'tex' ? `${e.a}>${e.b} texture ${L.rel.tex[e.t]}` : e.k === 'tie' ? `tie ${e.a}-${e.b}=${e.v}` : e.k)).join(' | ')}`);
    if (raw?.a) add('classifier answer:', hide(cut(raw.a, 900)));
  }
  add('', '## Last classifier request (hidden layers removed)', hide(cut(Q.log.lastReq, 2500)), '…', hide(String(Q.log.lastReq || '').slice(-1200)));
  return out.join('\n');
}

export async function copyReport() {
  const U = R.ui, text = buildReport();
  try {
    await navigator.clipboard.writeText(text);
    window.toastr?.success(U.copied.replace('{n}', text.length.toLocaleString()));
  } catch (e) {   // clipboard blocked: show it to copy by hand
    const c = ctx();
    c.callGenericPopup(`<textarea class="text_pole" rows="20" style="width:100%;font-family:monospace">${text.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[x]))}</textarea>`, c.POPUP_TYPE.TEXT, '', { wide: true, large: true });
  }
}
