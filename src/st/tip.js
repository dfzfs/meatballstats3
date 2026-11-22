// One small bubble for every [data-mb3tip]: shows on mouse-over, and on tap for phones (no hover there).
// A single fixed element, kept inside the screen, so it is never cut off by a drawer or a popup.
let bub = null, cur = null;
function show(el) {
  if (!bub) { bub = document.createElement('div'); bub.className = 'mb3-bubble'; document.body.appendChild(bub); }
  cur = el; bub.textContent = el.getAttribute('data-mb3tip') || ''; bub.style.display = 'block';
  const r = el.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16);
  bub.style.width = `${w}px`;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  bub.style.left = `${left}px`; bub.style.top = `${r.bottom + 6}px`;
  const b = bub.getBoundingClientRect();
  if (b.bottom > window.innerHeight - 8) bub.style.top = `${Math.max(8, r.top - b.height - 6)}px`;
}
function hide() { if (bub) bub.style.display = 'none'; cur = null; }
export function enableTips() {
  if (window.__mb3tips || !document.addEventListener) return; window.__mb3tips = true;
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[data-mb3tip]'); if (el) show(el); else if (cur) hide(); });
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-mb3tip]');
    if (el && el.classList.contains('mb3-q')) { e.preventDefault(); e.stopPropagation(); if (cur === el && bub?.style.display === 'block') hide(); else show(el); return; }
    if (!el) hide();
  }, true);
  document.addEventListener('scroll', hide, true);
}
// The little ? that carries a tip (h = the html escaper of the caller).
export const tipQ = (text, h) => (text ? `<span class="mb3-q" tabindex="0" data-mb3tip="${h(text)}">?</span>` : '');
