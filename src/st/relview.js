// Stage 2 on screen: a switch and a relationship table. Locked layers are never drawn — not even their number.
import { ctx, settings, ledger, ledger2, R, store, save, openThreads, stateFor, decide } from './store.js';
import { fingerprint } from '../core/clean.js';
import { refresh } from './inject.js';
import { kick } from './queue.js';
import { trend, tieOf } from '../core/ledger2.js';
import { trWatch } from './tr.js';
import { tipQ } from './tip.js';
import { stamp } from '../core/time.js';

const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lg = () => ((navigator.language || '').startsWith('ko') ? 'ko' : 'en');

function table() {
  const U = R.ui2, L = R.lang[lg()], st = ledger(), st2 = ledger2(), bp = R.bp, keys = new Set();
  const k2 = (a, b) => [a, b].sort().join('|');
  Object.values(st.pair || {}).forEach((p) => keys.add(k2(p.a, p.b)));
  Object.values(st2.dir).forEach((d) => keys.add(k2(d.a, d.b)));
  [...bp.tie, ...bp.barrier, ...bp.hide].forEach((x) => keys.add(k2(x.a, x.b)));
  const side = (a, b) => { const d = st2.dir[`${a}>${b}`]; if (!d) return '—'; const t = trend(d);
    return [d.tex != null && L.rel.tex[d.tex], t && L.rel.trend[t], d.inner && `「${d.inner}」`].filter(Boolean).map(h).join(' · ') + (d.q ? `<br><small>📜 ${h(d.q)}</small>` : ''); };
  const rows = [...keys].map((k) => {
    const [a, b] = k.split('|'), p = st.pair?.[k] || { a, b, tie: '' }, ev = st2.tie[k], raw = p.tie || '', shown = tieOf({ ...p, a, b }, st2, bp, R.V);
    const tie = h(shown || '—') + (ev ? `<br><small>${ev.user ? '🎬' : '📜'} ${h(ev.q)}</small>` : '') + (raw && !shown ? `<br><small>${h(U.early)}: ${h(raw)}</small>` : '');
    const done = p.touch && p.touch.lvl >= 1 ? `${h(L.touch[p.touch.lvl])} — ${h(stamp(st.cal, p.touch.day, L))}` : '—';
    const wall = [...bp.barrier.filter((x) => k2(x.a, x.b) === k).map((x) => x.v), ...bp.hide.filter((x) => k2(x.a, x.b) === k).map((x) => `→ ${x.c}`)].map(h).join('<br>') || '—';
    return `<tr><td><b>${h(a)} – ${h(b)}</b></td><td>${tie}</td><td>${side(a, b)}</td><td>${side(b, a)}</td><td>${done}</td><td>${wall}</td></tr>`;
  });
  const opened = bp.deep.filter((d) => st2.open[d.id]).map((d) => `<div>${h(U.opened)} ${h(d.who)}${d.to ? ` → ${h(d.to)}` : ''}: ${h(d.content)}<br><small>📜 ${h(st2.open[d.id].q)}</small></div>`).join('');
  const bpLine = bp.lines ? `<small>${h(U.bp)}: ${bp.lines} ${h(U.bpLines)}${bp.dropped.length ? ` · ${bp.dropped.length} ${h(U.bpDrop)}` : ''}</small>` : '';
  return `<div class="mb3-view">${R.bpOn ? `<p><b>⚠ ${h(U.bpOn)}</b></p>` : ''}${rows.length ? `<table class="mb3-rel"><tr><th>${h(U.pair)}</th><th>${h(U.tie)}</th><th>${h(U.fwd)}</th><th>${h(U.back)}</th><th>${h(U.done)}</th><th>${h(U.wall)}</th></tr>${rows.join('')}</table>` : `<small>${h(U.none)}</small>`}${opened}${bpLine}</div>`;
}

export function mountRelUI() {
  const box = document.querySelector('#mb3_settings .inline-drawer-content'), U = R.ui2, s = settings(), c = ctx();
  if (!box || document.getElementById('mb3_stage2')) return;
  const D = R.ui.d || {}, desc = (k) => tipQ(D[k], h);
  const html = `<div class="mb3-row"><label class="checkbox_label"><input id="mb3_stage2" type="checkbox" /><span>${h(U.stage2)}</span></label>${desc('stage2')}</div><div class="mb3-row"><label class="checkbox_label"><input id="mb3_burst" type="checkbox" /><span>${h(U.burst)}</span></label>${desc('burst')}</div><div class="mb3-btns"><div id="mb3_rel" class="menu_button" data-mb3tip="${h(D.rel || '')}">${h(U.relBtn)}</div><div id="mb3_threads" class="menu_button" data-mb3tip="${h(D.threads || '')}">${h(R.ui.threadsBtn)}</div><div id="mb3_vaults" class="menu_button" data-mb3tip="${h(D.vaults || '')}">${h(R.ui.vaultsBtn)}</div></div>`;
  const slot = document.getElementById('mb3_rel_slot');
  if (slot) slot.innerHTML = html; else box.insertAdjacentHTML('beforeend', html);
  const cb = document.getElementById('mb3_stage2');
  cb.checked = s.stage2;
  cb.addEventListener('change', () => { s.stage2 = cb.checked; c.saveSettingsDebounced(); refresh(); if (s.stage2) kick(); });
  const bb = document.getElementById('mb3_burst');
  bb.checked = s.burst !== false;
  bb.addEventListener('change', () => { s.burst = bb.checked; c.saveSettingsDebounced(); refresh(); });
  document.getElementById('mb3_rel').addEventListener('click', () => { const box = document.createElement('div'); box.innerHTML = table(); trWatch(box); c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true }); });
  document.getElementById('mb3_threads')?.addEventListener('click', threadsPopup);
  document.getElementById('mb3_vaults')?.addEventListener('click', vaultsPopup);
}
// v0.9: open refusal threads (who turned down what), with a button to close one. Closing is stored as a decision on
// the last reply, so undoing that reply reopens the thread.
function threadsPopup() {
  const c = ctx(), U = R.ui, list = openThreads();
  const box = document.createElement('div');
  box.innerHTML = `<b>${h(U.threadsTitle)}</b><div class="mb3-dim">${h(U.threadsHelp)}</div>` + (list.length ? `<ul>${list.map((r, i) => `<li><b>${h(r.a)}</b> → ${h(r.b)}: ${h(r.v)}${r.stage ? ` · ${h(U.threadsPressed)}` : ''} <i class="mb3-dim">"${h(r.q)}"</i> <span class="menu_button mb3-inline" data-i="${i}">${h(U.threadsClose)}</span></li>`).join('')}</ul>` : `<p>${h(U.threadsNone)}</p>`);
  box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const r = list[+b.dataset.i], last = [...(c.chat || [])].reverse().find((m) => !m.is_user && !m.is_system);
    if (!r || !last) return;
    const S = store(true), fp = fingerprint(last);
    (S.ev[fp] ||= []).push({ k: 'unrefuse', a: r.a, b: r.b, v: r.v, by: 'user' });
    save(); refresh(); b.closest('li').style.opacity = '.4'; b.remove();
  }));
  trWatch(box);
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
}

// v0.9: the vault entries of the lore sheet, open or closed, with a button each. The content is never shown here.
function vaultsPopup() {
  const c = ctx(), U = R.ui, list = stateFor().vaults;
  const box = document.createElement('div');
  box.innerHTML = `<b>${h(U.vaultsTitle)}</b><div class="mb3-dim">${h(U.vaultsHelp)}</div>` + (list.length ? `<ul>${list.map((v, i) => `<li><b>${h(v.who)}</b> · ${h(v.open ? U.vaultOpen : U.vaultClosed)} <span class="menu_button mb3-inline" data-i="${i}">${h(v.open ? U.vaultCloseBtn : U.vaultOpenBtn)}</span></li>`).join('')}</ul>` : `<p>${h(U.vaultsNone)}</p>`);
  box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const v = list[+b.dataset.i]; if (!v) return;
    if (decide('vault', { who: v.who, sid: v.sid, open: !v.open })) { refresh(); b.closest('li').style.opacity = '.4'; b.remove(); }
  }));
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
}
