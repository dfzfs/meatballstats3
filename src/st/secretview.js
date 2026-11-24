// 🔒 비밀 tab (v0.24): a card per secret — lock, stage steps, clue gauge, who knows, a timeline, and the person's
// controls (털어놔도 돼 for this scene · mark open / lock again). Below, the other locks (선 · 숨김) with their own switch.
// Motion is once and only for what changed since the card was last seen: a new clue wobbles the lock, an opening
// swings it open, the gauge fills from empty. Nothing moves for someone who asked for less motion (CSS).
import { R } from './store.js';
import { STAGES } from './secrets.js';

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (t, o) => String(t).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
const STAGE_I = { locked: '🔒', hint: '👀', suspect: '🤨', close: '⚠️', open: '🔓' };
const EV_I = { clue: '🔎', near: '🤨', slip: '⚠️', lie: '🤥', open: '🔓', relock: '🔒' };

// a padlock: cracks for clue pressure (0 · 1 · 2), shackle up when open
function lock(v) {
  const cracks = [
    '', '<path d="M13 25l4 5-3 4 4 6" />',
    '<path d="M13 25l4 5-3 4 4 6" /><path d="M28 24l-3 6 4 3-3 7" />',
  ][v.open ? 0 : Math.min(2, v.stage === 'close' ? 2 : v.pressure)];
  return `<svg class="mb3-lock" viewBox="0 0 40 48" aria-hidden="true"><path class="mb3-shackle" d="M11 22V14a9 9 0 0 1 18 0v8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><rect x="5" y="21" width="30" height="24" rx="6" fill="currentColor"/><circle cx="20" cy="31" r="3" fill="var(--mbt-card)"/><path d="M20 33v5" stroke="var(--mbt-card)" stroke-width="2.5" stroke-linecap="round"/><g class="mb3-cracks" fill="none" stroke="var(--mbt-card)" stroke-width="1.4" stroke-linejoin="round">${cracks}</g></svg>`;
}

function card(v, U2) {
  const at = STAGES.indexOf(v.stage), names = U2.stageNames || {};
  const steps = STAGES.map((s, i) => `<span class="mb3-sstep${i < at ? ' mb3-done' : i === at ? ' mb3-now' : ''}" title="${h(names[s] || s)}"><i></i><b>${STAGE_I[s]}</b></span>`).join('');
  const nClue = v.clues.length, pct = v.open ? 100 : Math.min(100, Math.round((nClue / 4) * 100));
  const chips = [...v.keepers.map((n) => `<span class="mb3-kchip mb3-keeper">🗝 ${h(n)}</span>`),
    ...v.chips.map((c) => `<span class="mb3-kchip mb3-k-${c.state}${c.state === 'knows' && v.fresh.open ? ' mb3-flip' : ''}">${c.state === 'knows' ? '✓' : '·'} ${h(c.name)}</span>`)].join('');
  const evs = v.events.slice(-8).reverse().map((e) => {
    const what = e.kind === 'slip' ? (names[`slip_${e.sub}`] || U2.evSlip || '들킬 뻔') : e.kind === 'open' ? (e.by === 'let' ? U2.evOpenLet || '털어놓음 (허락한 장면)' : e.by === 'user' ? U2.evOpenUser || '열림으로 표시함' : U2.evOpen || '이야기에서 밝혀짐') : (U2[`ev_${e.kind}`] || e.kind);
    return `<div class="mb3-sev mb3-sev-${e.kind}"><span class="mb3-sevi">${EV_I[e.kind] || '·'}</span><span class="mb3-sevt"><b>${h(what)}</b>${e.q ? ` <span class="mb3-q2">${h(String(e.q).slice(0, 60))}</span>` : ''}</span><a href="#" class="mb3-go" data-i="${e.i}">#${e.i}</a></div>`;
  }).join('');
  const cls = ['mb3-scard', `mb3-st-${v.stage}`, v.open ? 'mb3-open' : '', v.fresh.clue ? 'mb3-wobble' : '', v.fresh.open ? 'mb3-unlock' : '', v.fresh.clue || v.fresh.first ? 'mb3-gfill' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-skey="${h(v.who)}">
    <div class="mb3-stop">${lock(v)}<div class="mb3-shd"><div class="mb3-sname"><b>${h(v.who)}</b>${v.typed ? `<span class="mb3-dim"> · ${h(U2.typedSecret || '지시창')}</span>` : ''}</div>
      <div class="mb3-sstage">${STAGE_I[v.stage]} ${h(names[v.stage] || v.stage)}${v.letOn && !v.open ? ` <span class="mb3-letbadge">${h(U2.letBadge || '털어놔도 돼')}</span>` : ''}</div></div></div>
    <div class="mb3-sv" tabindex="0" title="${h(U2.peekTip || '누르고 있으면 보여요')}"><span>${h(v.v)}</span><i>${h(U2.peek || '누르고 있으면 보여요')}</i></div>
    <div class="mb3-ssteps">${steps}</div>
    <div class="mb3-sgauge"><div class="mb3-sgbar"><i style="--w:${pct}%"></i></div><span>${v.open ? h(U2.gaugeOpen || '밝혀짐') : h(fill(U2.gaugeN || '단서 {n} / 4', { n: nClue }))}${v.lies.length ? ` · 🤥 ${h(fill(U2.lieN || '거짓말 {n}번', { n: v.lies.length }))}` : ''}${v.slips.length ? ` · ⚠️ ${v.slips.length}` : ''}</span></div>
    ${chips ? `<div class="mb3-kchips">${chips}</div>` : ''}
    ${evs ? `<div class="mb3-stl">${evs}</div>` : `<p class="mb3-dim mb3-snone">${h(U2.noEvents || '아직 아무 일도 없었어요. 단서나 들킬 뻔한 순간이 생기면 여기 쌓여요.')}</p>`}
    <div class="mb3-sctl">${v.open ? '' : `<span class="mb3-sw${v.letOn ? ' on' : ''}" data-let="${h(v.who)}" data-on="${v.letOn ? 1 : 0}" role="switch" aria-checked="${v.letOn ? 'true' : 'false'}" tabindex="0"><i></i>${h(U2.letSwitch || '이번 장면에 털어놔도 돼')}</span>`}
      <span class="mb3-sbtn" data-vopen="${h(v.who)}" data-sid="${h(v.sid || '')}" data-on="${v.open ? 0 : 1}">${v.open ? `🔒 ${h(U2.relock || '다시 잠그기')}` : `🔓 ${h(U2.markOpen || '열림으로 표시')}`}</span></div>
  </div>`;
}

function lockRow(x, U2) {
  const label = x.kind === 'line' ? `${h(x.who)}: ${h(x.v)}` : `${h(x.who)} → ${h(x.v)}`;
  return `<div class="mb3-grow mb3-lrow${x.open ? ' mb3-lopen' : ''}"><span><b>${x.kind === 'line' ? `🚫 ${h(U2.lockLine || '선')}` : `🙈 ${h(U2.lockHide || '숨김')}`}</b> ${label}${x.opens ? `<br><small class="mb3-dim">${h(U2.opensWhen || '풀림')}: ${h(x.opens)}</small>` : ''}</span>
    <span class="mb3-sbtn" data-gate="${h(x.id)}" data-on="${x.open ? 0 : 1}">${x.open ? `🔓 ${h(U2.lockOpen || '열림')}` : `🔒 ${h(U2.lockClosed || '잠김')}`}</span></div>`;
}

export function secretsHtml(list, locks) {
  const U2 = R.ui2 || {};
  const head = `<p class="mb3-dim mb3-shelp">${h(U2.secretHelp || '비밀마다 지금 얼마나 들킬 것 같은지, 누가 아는지, 무슨 일이 있었는지예요. 내용은 누르고 있을 때만 보여요.')}</p>`;
  // the other locks are one more card in the same flow, so a single secret does not leave half the width empty
  const others = locks.length ? `<div class="mb3-scard mb3-sother"><div class="mb3-ch mb3-subh">${h(U2.otherLocks || '그 밖의 잠금')}</div><p class="mb3-dim mb3-shelp">${h(U2.otherLocksHelp || '이야기에서 이미 풀렸는데 계속 「거절해도 됨 · 겉 관계로」가 가면 여기서 직접 열어요.')}</p><div class="mb3-glist">${locks.map((x) => lockRow(x, U2)).join('')}</div></div>` : '';
  const none = list.length ? '' : `<p class="mb3-dim">${h(U2.noSecrets || '아직 비밀이 없어요. 설정집에 「금고:」를 적거나 지시창 비밀 탭에 적으면 카드가 생겨요.')}</p>`;
  return head + none + (list.length || locks.length ? `<div class="mb3-scards">${list.map((v) => card(v, U2)).join('')}${others}</div>` : '');
}
