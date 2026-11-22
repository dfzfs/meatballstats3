// The lore sheet editor (설정집) and the chat-shape switch. Opened only on demand.
import { tipQ, enableTips } from './tip.js';
import { ctx, settings, store, save, R, loreText, applyLore, charKey, shape } from './store.js';
import { request } from './queue.js';
import { refresh } from './inject.js';
import { readBlueprint } from '../core/blueprint.js';
import { trLines } from './tr.js';

const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ko = () => (navigator.language || '').startsWith('ko');

// One call, only when the person presses it: card + lorebook -> a draft in the sheet format. The person reviews it before saving.
// Every lorebook in SillyTavern (not only the character's): the person picks which ones the draft reads.
async function bookNames() {
  try { const m = await import('/scripts/world-info.js'); if (Array.isArray(m.world_names) && m.world_names.length) return [...m.world_names]; } catch (e) { /* older or moved: read the editor's list */ }
  const opts = [...document.querySelectorAll('#world_editor_select option, #world_info option')].filter((o) => o.value !== '' && o.textContent.trim() && !/^-+/.test(o.textContent.trim()));
  return [...new Set(opts.map((o) => o.textContent.trim()))];
}
// The books ticked by default: the character's own, the chat's, else what was picked last time for this character.
function defaultBooks() {
  const c = ctx(), ch = c.characters?.[c.characterId] || {}, k = charKey(), s = settings();
  const saved = k && s.loreBooks?.[k];
  if (Array.isArray(saved)) return saved;
  return [ch?.data?.extensions?.world, c.chatMetadata?.world_info].filter(Boolean);
}
async function draft(books) {
  const c = ctx(), ch = c.characters?.[c.characterId] || {}, U = R.ui2;
  let book = '';
  for (const name of books || []) {
    try {
      if (!c.loadWorldInfo) break;
      const d = await c.loadWorldInfo(name);
      const t = Object.values(d?.entries || {}).filter((e) => !e.disable && !/미트볼|meatball/i.test(e.comment || '')).map((e) => `# ${e.comment || ''}\n${e.content || ''}`).join('\n\n');
      if (t) book += `${book ? '\n\n' : ''}## ${name}\n${t}`;
    } catch (e) { /* that book could not be read: skip it */ }
  }
  const src = [ch.description, ch.personality, ch.scenario, ch.data?.system_prompt ? '' : '', book].filter(Boolean).join('\n\n').slice(0, 200000);
  if (!src.trim()) { window.toastr?.info(U.loreNoSource); return null; }
  const p = R.lang.en.ui2.draftPrompt.replace('{{SRC}}', () => src);   // AI-facing text: always English
  const out = await request(p, '</lore>', '', 32000);   // a whole sheet after the model's thinking: needs room
  return String(out || '').replace(/^[\s\S]*?<lore>/i, '').replace(/<\/lore>[\s\S]*$/i, '').trim();
}

export function openLore() {
  const c = ctx(), U = R.ui2, s = settings(), box = document.createElement('div');
  const cur = loreText(), sh = shape(); enableTips();
  const srcName = { chat: U.loreSrcChat, char: U.loreSrcChar, book: U.loreSrcBook, '': U.loreSrcNone }[cur.src];
  box.innerHTML = `<div class="mb3-view mb3-lore">
    <p class="mb3-loreintro">${h(U.loreIntro || '')}</p>
    <div class="mb3-shape"><b>${h(U.shapeTitle)}</b> ${tipQ(U.shapeTip, h)}<select id="mb3_shape" class="text_pole">${['auto', 'one', 'novel', 'multi'].map((k) => `<option value="${k}"${sh.set === k ? ' selected' : ''}>${h(U.shape[k])}</option>`).join('')}</select>
      <small class="mb3-dim">${h(U.shapeNow)}: ${h(c.name2)} = ${h(sh.charPerson || c.groupId ? U.isPerson : U.isTitle)} · ${h(c.name1)} = ${h(sh.userPerson ? U.isPerson : U.isDirector)}</small></div>
    <h4>${h(U.loreTitle)} <small class="mb3-dim">(${h(srcName)})</small></h4>
    <div class="mb3-keys">${(U.loreKeys || []).map(([g, items]) => `<div class="mb3-kg"><span class="mb3-kgt">${h(g)}</span>${items.map(([k, t, ex]) => `<span class="mb3-key" data-mb3tip="${h(`${t}\n예: ${ex}`)}" data-ex="${h(ex)}">${h(k)}</span>`).join('')}</div>`).join('')}</div>
    <textarea id="mb3_lore" class="text_pole" rows="14" style="width:100%;font-family:monospace">${h(cur.text)}</textarea>
    <small id="mb3_lore_check"></small>
    <details class="mb3-tr-box"><summary>${h(R.ui.trShow)}</summary><pre id="mb3_lore_tr" class="mb3-notr"></pre></details>
    <div class="flex-container">
      <div id="mb3_lore_draft" class="menu_button" data-mb3tip="${h(U.loreDraftTip || '')}">${h(U.loreDraft)}</div>
      <div id="mb3_lore_chat" class="menu_button" data-mb3tip="${h(U.loreSaveChatTip || '')}">${h(U.loreSaveChat)}</div>
      <div id="mb3_lore_char" class="menu_button" data-mb3tip="${h(U.loreSaveCharTip || '')}">${h(U.loreSaveChar)}</div>
      <div id="mb3_lore_tpl" class="menu_button" data-mb3tip="${h(U.loreTemplateTip || '')}">${h(U.loreTemplate)}</div>
    </div>
    <details class="mb3-books"><summary>📚 ${h(U.loreBooks || '초안에 읽을 로어북')} <b class="mb3-books-n"></b> ${tipQ(U.loreBooksTip || '', h)}</summary><div class="mb3-books-list">…</div></details>
    ${R.bpOn ? `<p><b>⚠ ${h(R.ui2.bpOn)}</b></p>` : ''}
    <details class="mb3-guide"><summary>${h(U.loreMore || U.loreGuideTitle)}</summary><ul>${(U.loreGuide || []).map((x) => `<li>${x}</li>`).join('')}</ul></details>
  </div>`;
  const ta = box.querySelector('#mb3_lore'), chk = box.querySelector('#mb3_lore_check');
  const check = () => { const bp = readBlueprint(ta.value); chk.textContent = `${U.loreRead}: ${bp.persons.length} ${U.lorePeople} · ${bp.lines} ${U.bpLines}${bp.dropped.length ? ` · ${bp.dropped.length} ${U.bpDrop}: ${bp.dropped.slice(0, 3).map((d) => d.raw.trim().slice(0, 30)).join(' / ')}` : ''}${bp.warn?.length ? ` · ⚠ ${R.ui.vaultWarn}: ${bp.warn.slice(0, 3).map((w) => `${w.who}(${w.field}: ${w.sign})`).join(', ')}` : ''}`; };
  ta.addEventListener('input', check); check();
  box.querySelectorAll('.mb3-key').forEach((k) => k.addEventListener('click', () => {
    const ex = k.dataset.ex || '', v = ta.value, at = ta.selectionStart ?? v.length;
    const lineEnd = v.indexOf('\n', at) === -1 ? v.length : v.indexOf('\n', at);
    const add = (lineEnd > 0 && v[lineEnd - 1] !== '\n' ? '\n' : '') + ex;
    ta.value = v.slice(0, lineEnd) + add + v.slice(lineEnd); ta.focus();
    const pos = lineEnd + add.length; ta.setSelectionRange(pos, pos); check();
  }));
  box.querySelector('.mb3-tr-box')?.addEventListener('toggle', async (e) => { if (!e.target.open) return; const out = box.querySelector('#mb3_lore_tr'); out.textContent = '…'; out.textContent = (await trLines(ta.value.split('\n'))).join('\n'); });
  box.querySelector('#mb3_shape').addEventListener('change', (e) => { const S = store(true); S.shape = e.target.value; save(); refresh(); });
  box.querySelector('#mb3_lore_chat').addEventListener('click', () => { const S = store(true); S.lore = ta.value; save(); applyLore(); refresh(); window.toastr?.info(U.loreSaved); });
  box.querySelector('#mb3_lore_char').addEventListener('click', () => { const k = charKey(); if (!k) return; s.loreByChar[k] = ta.value; c.saveSettingsDebounced(); applyLore(); refresh(); window.toastr?.info(U.loreSaved); });
  box.querySelector('#mb3_lore_tpl').addEventListener('click', () => { if (!ta.value.trim() || confirm(U.loreReplace)) { ta.value = U.loreTpl; check(); } });
  box.querySelector('#mb3_lore_draft').addEventListener('click', async (e) => {
    const b = e.currentTarget; if (b.dataset.busy) return; b.dataset.busy = '1'; b.textContent = U.loreDrafting;
    try { const t = await draft(picked()); if (t) { ta.value = (ta.value.trim() ? `${ta.value.trim()}\n\n` : '') + t; check(); } } catch (err) { window.toastr?.info(`${U.loreFail}: ${err.message}`); }
    delete b.dataset.busy; b.textContent = U.loreDraft;
  });
  // the lorebook list: every book SillyTavern has; ticks are remembered per character
  let chosen = new Set(defaultBooks());
  const nEl = box.querySelector('.mb3-books-n'), listEl = box.querySelector('.mb3-books-list');
  const showN = () => { nEl.textContent = `(${chosen.size})`; };
  function picked() { return [...chosen]; }
  showN();
  bookNames().then((names) => {
    const all = [...new Set([...names, ...chosen])].sort((a, b) => (chosen.has(b) - chosen.has(a)) || a.localeCompare(b));
    listEl.innerHTML = all.length ? `<input class="text_pole mb3-books-q" placeholder="${h(U.loreBooksFind || '찾기')}" />` + all.map((n) => `<label class="checkbox_label" data-b="${h(n.toLowerCase())}"><input type="checkbox" value="${h(n)}"${chosen.has(n) ? ' checked' : ''} /><span>${h(n)}</span></label>`).join('')
      : `<small class="mb3-dim">${h(U.loreBooksNone || '로어북이 없어요')}</small>`;
    listEl.querySelectorAll('input[type=checkbox]').forEach((x) => x.addEventListener('change', () => {
      x.checked ? chosen.add(x.value) : chosen.delete(x.value); showN();
      const k = charKey(); if (k) { (s.loreBooks ||= {})[k] = [...chosen]; c.saveSettingsDebounced(); }
    }));
    listEl.querySelector('.mb3-books-q')?.addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); listEl.querySelectorAll('[data-b]').forEach((l) => { l.style.display = !q || l.dataset.b.includes(q) ? '' : 'none'; }); });
  });
  c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true });
}
