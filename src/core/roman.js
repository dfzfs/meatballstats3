// Korean names written in Latin letters ("Seoyeon", "Ji-ho", "Kim Jiho") are the same person as "서연", "지호".
// The sorting model sometimes writes a name one way and sometimes the other; then one character showed up twice
// (and twice again once the screen translation turned the Latin one into Korean). Matching is loose on purpose:
// revised romanization of the Korean name, then both sides folded (eo→o, g/k, d/t, b/p, j/ch, r/l, double letters).
const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const HAN = /^[가-힣]+$/;
export function romanize(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.codePointAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += ch; continue; }
    out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + JONG[c % 28];
  }
  return out;
}
// surnames that are romanized their own way
const SUR = { 이: ['lee', 'yi', 'rhee', 'i'], 박: ['park', 'pak', 'bak'], 김: ['kim', 'gim'], 최: ['choi', 'choe'], 정: ['jung', 'jeong', 'chung'], 강: ['kang'], 조: ['cho', 'jo'], 윤: ['yoon', 'yun'], 장: ['jang', 'chang'], 임: ['lim', 'im', 'yim'], 한: ['han'], 오: ['oh', 'o'], 서: ['seo', 'suh'], 신: ['shin', 'sin'], 권: ['kwon', 'gwon'], 황: ['hwang'], 송: ['song'], 류: ['ryu', 'yoo', 'yu'], 유: ['yoo', 'yu'], 노: ['noh', 'roh', 'no'], 문: ['moon', 'mun'], 배: ['bae'], 백: ['baek', 'paik'], 허: ['heo', 'huh'], 남: ['nam'], 우: ['woo', 'u'] };
const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
  .replace(/oo/g, 'u').replace(/wu/g, 'u').replace(/eo/g, 'o').replace(/eu/g, 'u').replace(/ae/g, 'e').replace(/ee/g, 'i').replace(/sh/g, 's')
  .replace(/ch/g, 'j').replace(/[gk]/g, 'k').replace(/[dt]/g, 't').replace(/[bp]/g, 'p').replace(/l/g, 'r').replace(/(.)\1+/g, '$1');
const words = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
// one Korean name -> the folded Latin forms it may be written as (whole name, given name, surname + given name)
function forms(h) {
  const r = romanize(h), out = new Set([fold(r), fold(r.replace(/eo/g, 'u'))]);   // 현 = hyeon / hyun, 서 = seo / suh
  if (h.length === 3) {
    const g = romanize(h.slice(1));
    out.add(fold(g)); out.add(fold(g.replace(/eo/g, 'u')));
    for (const s of SUR[h[0]] || [romanize(h[0])]) { out.add(fold(s + romanize(h.slice(1)))); out.add(fold(romanize(h.slice(1)) + s)); }
  }
  return out;
}
// Is this Latin name the same as this Korean name?
export function sameName(latin, han) {
  if (!HAN.test(String(han || '')) || han.length < 2 || !/[A-Za-z]/.test(latin || '') || /[가-힣]/.test(latin)) return false;
  const f = forms(han), w = words(latin);
  if (!w.length) return false;
  if (f.has(fold(w.join('')))) return true;
  // "Kim Jiho" or "Jiho Kim" against 지호: the given name alone must match, and it must be at least two letters long
  const g = romanize(han.length === 3 ? han.slice(1) : han);
  return w.length > 1 && w.some((x) => x.length >= 3 && (fold(x) === fold(g) || fold(x) === fold(g.replace(/eo/g, 'u'))));
}

// English names written in Korean ("Luffy" = 루피, "Law" = 로우, "Zoro" = 조로): compare the consonants only
// (vowels, w · y · h dropped, sounds Korean does not tell apart folded together). Used only to pair a Latin name with
// a Korean name of the same list, and only when exactly one Korean name fits.
const latSk = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
  .replace(/ph/g, 'p').replace(/th/g, 't').replace(/ck/g, 'k').replace(/sh/g, 's').replace(/ch/g, 'j').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
  .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 'j').replace(/f/g, 'p').replace(/v/g, 'b').replace(/ng/g, 'n');
const skel = (s) => s.replace(/[gk]/g, 'k').replace(/[dt]/g, 't').replace(/[bp]/g, 'p').replace(/l/g, 'r').replace(/[aeiouwyh]/g, '').replace(/(.)\1+/g, '$1');
export const skelLatin = (s) => skel(latSk(s));
export const skelHan = (s) => skel(romanize(s).replace(/ng/g, 'n').replace(/ch/g, 'j'));
export function soundPair(latin, hans) {
  const one = (w) => { const k = skelLatin(w); if (!k) return []; const ks = new Set([k, k.replace(/r$/, '')]);   // "-er" is often dropped (Chopper = 쵸파)
    return hans.filter((x) => ks.has(skelHan(x))); };
  let hit = one(latin);
  // "Trafalgar Law", "Monkey D. Luffy": one of the words, when exactly one Korean name fits
  if (!hit.length) { const ws = String(latin).split(/[^A-Za-z]+/).filter((w) => w.length >= 3); if (ws.length > 1) hit = [...new Set(ws.flatMap(one))]; }
  return hit.length === 1 ? hit[0] : null;
}
