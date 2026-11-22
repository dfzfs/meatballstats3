// A temporary name swap from the director panel (e.g. 깡통 shown as 깡돌 for a while).
// Meatball keeps its record under the real names: a reply written with the swapped name is read back with the real
// one, and while the swap is on, names are shown swapped on screen. Turning the swap off brings everything back.
const D = () => (window.MeatballDirector?.v === 1 ? window.MeatballDirector : null);
const pairs = (recent) => { try { return (recent ? D()?.swapsRecent?.() : D()?.swaps?.()) || []; } catch (e) { return []; } };
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// story text -> real names (for the classifier)
export function unswapText(t) {
  let out = String(t || '');
  const ps = pairs(true).filter(([f, to]) => f && to && f !== to).sort((a, b) => b[1].length - a[1].length);
  for (const [from, to] of ps) {
    const re = /^[\x00-\x7f]+$/.test(to) ? new RegExp(`(^|[^A-Za-z0-9_])${esc(to)}(?![A-Za-z0-9_])`, 'g') : new RegExp(`()${esc(to)}`, 'g');
    out = out.replace(re, (m, pre) => pre + from);
  }
  return out;
}
// a real name -> the name shown while the swap is on
export function swappedName(n) {
  const k = String(n || '').trim(); if (!k) return n;
  for (const [from, to] of pairs(false)) if (from && to && from.toLowerCase() === k.toLowerCase()) return to;
  return n;
}
