// Colour theme and font for everything Meatball draws (log, lore window, tips, the director panel).
// Only a body attribute and one CSS variable change; a web font is fetched only when the person picks one.
import { settings } from './store.js';

export const THEMES = ['gray', 'pink', 'matcha', 'dark'];
export const FONTS = {
  '': { family: '' },
  pretendard: { family: '"Pretendard Variable", Pretendard', css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css' },
  suit: { family: '"SUIT Variable", SUIT', css: 'https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/variable/woff2/SUIT-Variable.css' },
  gowun: { family: '"Gowun Dodum"', css: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap' },
  // handwriting; used when installed on this device (no public web copy to load)
  pdh: { family: '"Ownglyph PDH", "온글잎 박다현체", "Ownglyph_PDH-Rg"' },
};
export function applyLook() {
  try {
    const s = settings(), th = THEMES.includes(s.theme) ? s.theme : 'gray', f = FONTS[s.font] ? s.font : '';
    document.body.dataset.mb3th = th;
    const F = FONTS[f];
    if (F.css && !document.getElementById(`mb3_font_${f}`)) document.head.insertAdjacentHTML('beforeend', `<link id="mb3_font_${f}" rel="stylesheet" href="${F.css}">`);
    if (F.family) document.body.style.setProperty('--mbt-font', `${F.family}, sans-serif`); else document.body.style.removeProperty('--mbt-font');
  } catch (e) { /* looks only */ }
}
