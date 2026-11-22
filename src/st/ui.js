// Settings drawer + "view signpost". Nothing is ever drawn in the chat itself.
import { ctx, settings, store, save, signpost, ledger, R } from './store.js';
import { Q, kick } from './queue.js';
import { refresh } from './inject.js';
import { parseDate, fmtDate, dateAt } from '../core/time.js';
import { fingerprint } from '../core/clean.js';
import { lookalikes } from '../core/names.js';
import { renderBar, setOpener } from './bar.js';
import { openLedger, clearAll } from './ledgerview.js';
import { trLines } from './tr.js';
import { copyReport } from './report.js';
import { openLore } from './loreview.js';
import { enableTips, tipQ } from './tip.js';
import { GROUPS, isOn } from '../core/keys.js';

const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function view() {
  const U = R.ui, c = ctx(), sp = settings().on ? signpost() : null, st = ledger();
  const L = R.lang[sp?.lg || 'en'];
  const cool = Date.now() < Q.coolUntil ? ` · ${U.cooling} ${Math.ceil((Q.coolUntil - Date.now()) / 60e3)}m` : '';
  const notes = st.notes.map((n) => `${fmtDate(n.text, L) || '?'} → ${fmtDate(n.engine, L)}`).join('\n');
  const pairs = lookalikes(st.names).map((p) => p.join(' ≈ ')).join(', ');
  const html = `<div class="mb3-view"><div class="mb3-btns"><div class="menu_button mb3-copyrep">${h(U.copyBtn)}</div></div>
    <h4>${h(U.status)}</h4><small>${h(Q.log.status || '-')}${cool} · ${Object.keys(st.names.seen).length} ${h(U.learned)}${pairs ? ` · ${h(pairs)}?` : ''}${sp ? ` · ${sp.tokens} ${h(U.tokens)}` : ''}</small>
    ${sp ? ['deep', 'mid', 'now'].map((k) => `<h4>${k}</h4><pre class="mb3-notr">${h(sp[k] || '—')}</pre>${sp[k] ? `<pre class="mb3-trpre" data-k="${k}"></pre>` : ''}`).join('') : `<pre>${h(U.off)}</pre>`}
    ${sp && !sp.mid ? `<small>${h(U.empty)}</small>` : ''}
    ${notes ? `<h4>${h(U.notes)}</h4><pre>${h(notes)}</pre>` : ''}
    <h4>${h(U.dropped)}</h4><pre>${h(Q.log.dropped.map((d) => `${d.why}: ${d.raw || ''}`).join('\n') || '—')}</pre>
    <details><summary>${h(U.lastReq)}</summary><pre>${h(Q.log.lastReq.slice(0, 1500))}\n…\n${h(Q.log.lastReq.slice(-1500))}</pre><pre>${h(Q.log.lastAnswer)}</pre></details>
  </div>`;
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelector('.mb3-copyrep')?.addEventListener('click', copyReport);
  box.querySelectorAll('.mb3-trpre').forEach((el) => { el.style.display = 'none'; });
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
  if (sp) {   // the note as sent stays as is; the translation goes underneath (one request for all three layers)
    const keys = ['deep', 'mid', 'now'].filter((k) => sp[k]), lines = keys.flatMap((k) => sp[k].split('\n'));
    const out = await trLines(lines);
    let n = 0;
    for (const k of keys) {
      const len = sp[k].split('\n').length, el = box.querySelector(`.mb3-trpre[data-k="${k}"]`), t = out.slice(n, n + len).join('\n');
      n += len;
      if (el && t !== sp[k]) { el.textContent = `🌐 ${t}`; el.style.display = ''; }
    }
  }
}

// The person sets today's story date. A person's line always wins (force).
async function setDate() {
  const c = ctx(), U = R.ui, st = ledger(), L = R.lang[(navigator.language || '').startsWith('ko') ? 'ko' : 'en'];
  const text = await c.Popup.show.input(U.date, U.dateHint, fmtDate(dateAt(st.cal), L));
  const d = text && parseDate(text, R.V);
  if (!d) return;
  const S = store(true), e = { k: 'date', date: { m: d.m, d: d.d, wd: d.wd, y: d.y, part: d.part }, force: true, by: 'user' };
  const last = [...(c.chat || [])].reverse().map(fingerprint).find((fp) => S.ev[fp]);
  if (last) S.ev[last].push(e); else S.pre.push(e);
  save(); refresh(); renderBar();
}

// The person's standing note for this chat ("keep this secret", "no crying in front of him"), one line each.
async function editNote() {
  const c = ctx(), U = R.ui, S = store(true);
  if (!S) return;
  const v = await c.callGenericPopup(`<b>${h(U.noteLabel)}</b>`, c.POPUP_TYPE.INPUT, S.note || '', { rows: 6, placeholder: U.notePh });
  if (v === null || v === undefined || v === false) return;
  S.note = String(v).slice(0, 1200); save(); refresh();
  try { window.toastr?.success(U.noteSaved); } catch (e) { /* notice only */ }
}
export function mountUI() {
  const U = R.ui, D = U.d || {}, s = settings(), c = ctx();
  const desc = (k) => tipQ(D[k], h);
  enableTips();
  const btn = (id, label, k) => `<div id="${id}" class="menu_button" data-mb3tip="${h(D[k] || '')}">${h(label)}</div>`;
  document.getElementById('extensions_settings2').insertAdjacentHTML('beforeend', `
  <div id="mb3_settings" class="extension_settings"><div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header"><b>${h(U.title)}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
    <div class="inline-drawer-content">
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_on" type="checkbox" /><span>${h(U.on)}</span></label>${desc('on')}</div>
      <div class="mb3-row"><label>${h(U.director)}</label> <span id="mb3_dir_box"></span>${desc('director')}</div>
      <div class="mb3-row"><label for="mb3_profile">${h(U.profile)}</label>${desc('profile')}<select id="mb3_profile" class="text_pole"><option value=""></option></select></div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_tr" type="checkbox"${s.translate !== false ? ' checked' : ''} /><span>${h(D.translateLabel)}</span></label>${desc('translate')}</div>
      <div class="mb3-row mb3-col"><label for="mb3_names">${h(U.nameMap)}</label>${desc('nameMap')}<textarea id="mb3_names" class="text_pole" rows="2" placeholder="${h(U.nameMapPh)}">${h(s.nameMap || '')}</textarea></div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_bar_on" type="checkbox" /><span>${h(U.bar)}</span></label>${desc('bar')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_wait" type="checkbox"${s.waitSort ? ' checked' : ''} /><span>${h(U.waitSort)}</span></label>${desc('wait')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_spark" type="checkbox"${s.spark !== false ? ' checked' : ''} /><span>${h(U.spark)}</span></label>${desc('spark')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_gauto" type="checkbox"${s.guardAuto ? ' checked' : ''} /><span>${h(U.guardAuto)}</span></label>${desc('guardAuto')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_vlines" type="checkbox"${s.vaultLines !== false ? ' checked' : ''} /><span>${h(U.vaultLines)}</span></label>${desc('vaultLines')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_rsteps" type="checkbox"${s.refuseSteps !== false ? ' checked' : ''} /><span>${h(U.refuseSteps)}</span></label>${desc('refuseSteps')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_rush" type="checkbox"${s.rushCall !== false ? ' checked' : ''} /><span>${h(U.rushCall)}</span></label>${desc('rushCall')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_human" type="checkbox"${s.human !== false ? ' checked' : ''} /><span>${h(U.human)}</span></label>${desc('human')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_mascot" type="checkbox"${s.mascot !== false ? ' checked' : ''} /><span>${h(U.mascot)}</span></label>${desc('mascot')}</div>
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_fauto" type="checkbox"${s.fallAuto ? ' checked' : ''} /><span>${h(U.fallAuto)}</span></label>${desc('fallAuto')}</div>
      <div class="mb3-row"><label for="mb3_rarity">${h(U.rarity)}</label>${desc('rarity')}<select id="mb3_rarity" class="text_pole">${[[2, U.rarityLow], [1, U.rarityMid], [0.6, U.rarityHigh]].map(([v, t]) => `<option value="${v}"${(+s.rarity || 1) === v ? ' selected' : ''}>${h(t)}</option>`).join('')}</select></div>
      <div class="mb3-btns">${btn('mb3_ledger', U.ledger, 'ledger')}${btn('mb3_view', U.view, 'view')}${btn('mb3_note', U.noteBtn, 'note')}${btn('mb3_lore_btn', R.ui2.loreBtn, 'lore')}${btn('mb3_date', U.date, 'date')}${btn('mb3_copy', U.copyBtn, 'copy')}</div>
      <details class="mb3-help"><summary>${h(U.btnHelp)}</summary>
        <dl><dt>${h(U.ledger)}</dt><dd>${h(D.ledger)}</dd><dt>${h(U.view)}</dt><dd>${h(D.view)}</dd><dt>${h(U.noteBtn)}</dt><dd>${h(D.note)}</dd><dt>${h(R.ui2.loreBtn)}</dt><dd>${h(D.lore)}</dd><dt>${h(U.date)}</dt><dd>${h(D.date)}</dd><dt>${h(U.copyBtn)}</dt><dd>${h(D.copy)}</dd></dl></details>
      <details><summary>${h(R.ui2.groupsTitle)} ${desc('groups')}</summary>${GROUPS.filter((g) => !g.fixed).map((g) => `<label class="checkbox_label"><input type="checkbox" data-mb3g="${g.id}"${isOn(s.groups, g.id) ? ' checked' : ''} /><span>${h(R.ui2.groups[g.id])}</span></label>`).join('')}
      <div class="mb3-row"><label class="checkbox_label"><input id="mb3_maker" type="checkbox"${s.maker ? ' checked' : ''} /><span>${h(R.ui2.maker)}</span></label>${desc('maker')}</div></details>
      <div id="mb3_rel_slot"></div>
      <details class="mb3-danger"><summary>${h(D.delAllSet)} ${desc('delAllSetDesc')}</summary><div id="mb3_delall" class="menu_button">⚠ ${h(D.delAllSet)}</div></details>
    </div></div></div>`);
  const on = document.getElementById('mb3_on');
  on.checked = s.on;
  on.addEventListener('change', () => { s.on = on.checked; c.saveSettingsDebounced(); refresh(); renderBar(); if (s.on) kick(); });
  const bar = document.getElementById('mb3_bar_on');
  bar.checked = s.bar;
  bar.addEventListener('change', () => { s.bar = bar.checked; c.saveSettingsDebounced(); renderBar(); });
  document.getElementById('mb3_wait')?.addEventListener('change', (e) => { s.waitSort = e.target.checked; c.saveSettingsDebounced(); });
  document.getElementById('mb3_spark')?.addEventListener('change', (e) => { s.spark = e.target.checked; c.saveSettingsDebounced(); refresh(); });
  document.getElementById('mb3_gauto')?.addEventListener('change', (e) => { s.guardAuto = e.target.checked; c.saveSettingsDebounced(); });
  document.getElementById('mb3_rarity')?.addEventListener('change', (e) => { s.rarity = +e.target.value || 1; c.saveSettingsDebounced(); refresh(); });
  drawDirector();
  for (const [id, k] of [['mb3_vlines', 'vaultLines'], ['mb3_rsteps', 'refuseSteps'], ['mb3_rush', 'rushCall'], ['mb3_human', 'human'], ['mb3_fauto', 'fallAuto'], ['mb3_mascot', 'mascot']]) document.getElementById(id)?.addEventListener('change', (e) => { s[k] = e.target.checked; c.saveSettingsDebounced(); refresh(); });
  document.getElementById('mb3_tr')?.addEventListener('change', (e) => { s.translate = e.target.checked; c.saveSettingsDebounced(); renderBar(); });
  document.getElementById('mb3_names')?.addEventListener('input', (e) => { s.nameMap = e.target.value.slice(0, 2000); c.saveSettingsDebounced(); renderBar(); });
  document.getElementById('mb3_delall')?.addEventListener('click', () => { if (confirm(R.ui.delAllAsk)) clearAll(); });
  document.getElementById('mb3_copy')?.addEventListener('click', copyReport);
  setOpener(openLedger);
  document.getElementById('mb3_ledger').addEventListener('click', openLedger);
  const setProfile = (p) => { s.profile = p?.id || ''; c.saveSettingsDebounced(); };
  try { c.ConnectionManagerRequestService.handleDropdown('#mb3_profile', s.profile, setProfile); } catch (e) { document.getElementById('mb3_profile').disabled = true; }
  document.getElementById('mb3_view').addEventListener('click', view);
  document.getElementById('mb3_date').addEventListener('click', setDate);
  document.getElementById('mb3_lore_btn')?.addEventListener('click', openLore);
  document.getElementById('mb3_note')?.addEventListener('click', editNote);
  document.querySelectorAll('[data-mb3g]').forEach((cb) => cb.addEventListener('change', () => { s.groups = { ...(s.groups || {}), [cb.dataset.mb3g]: cb.checked }; c.saveSettingsDebounced(); }));
  document.getElementById('mb3_maker')?.addEventListener('change', (e) => { s.maker = e.target.checked; c.saveSettingsDebounced(); });
}

// 🎬 지시창 is its own extension: this button installs it from GitHub (the same as Install extension with the address).
const DIRECTOR_REPO = 'https://github.com/dfzfs/meatballinput';
const hasDirector = () => !!window.__mbDirector || !!document.getElementById('mbd_btn')
  || [...document.querySelectorAll('script[src]')].some((e) => /third-party\/(meatballinput|meatball-director)\//i.test(e.src));
let dirFresh = false;
function drawDirector() {
  const box = document.getElementById('mb3_dir_box'); if (!box) return;
  const U = R.ui;
  if (hasDirector()) { box.innerHTML = `<small class="mb3-desc">${h(U.directorHave)}</small>`; return; }
  if (dirFresh) { box.innerHTML = `<small class="mb3-desc">${h(U.directorReload)}</small> <div id="mb3_dir_reload" class="menu_button">${h(U.directorReloadBtn)}</div>`; document.getElementById('mb3_dir_reload')?.addEventListener('click', () => location.reload()); return; }
  box.innerHTML = `<div id="mb3_dir_get" class="menu_button" title="${h(DIRECTOR_REPO)}">${h(U.directorGet)}</div>`;
  document.getElementById('mb3_dir_get')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; if (b.dataset.busy) return; b.dataset.busy = '1'; b.textContent = U.directorBusy;
    try {
      const res = await fetch('/api/extensions/install', { method: 'POST', headers: ctx().getRequestHeaders?.() ?? { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: DIRECTOR_REPO, global: false }) });
      if (!res.ok) { console.warn('[meatball3] director install failed', res.status, await res.text().catch(() => '')); throw new Error((U.directorErr || {})[res.status] || U.directorErrAny.replace('{n}', res.status)); }
      dirFresh = true; window.toastr?.success(U.directorDone);
    } catch (err) { window.toastr?.warning(err.message || U.directorErrAny.replace('{n}', '?'), '', { timeOut: 10000 }); }
    drawDirector();
  });
}
