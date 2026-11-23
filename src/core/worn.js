// A model's habit: a figure ("N years", "the Nth floor") or an old event written once keeps coming back, because
// every earlier mention in the chat makes the next one likelier. A standing "do not repeat" line wears off, so this
// counts the last replies mechanically and the note answers only while it is happening (and stops when it stops).
// No lookbehind in these patterns: an old browser would fail to load the whole file.
const KO_DIGIT = /(\d+)\s?(주년|년|개월|달|주일|층|살|번째|시간|명|호실)/g;
const KO_NATIVE = /(^|[^가-힣])((?:두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무)\s?(?:달|살|번째|명|시간))/g;
const KO_SINO = /(^|[^가-힣])((?:이십|삼십|수십|수백|삼|사|오|육|칠|팔|구|십|백|천)\s?(?:주년|년|개월|층))/g;
const EN_NUM = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|a hundred|a thousand)[ -](years?|months?|weeks?|floors?|hours?|people)\b/gi;
const EN_ORD = /\b(\d+(?:st|nd|rd|th)|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[ -](floor|year|storey)\b/gi;
const RECALL = [
  /(?:년|달|개월|주|해) ?전|그때|그 ?시절|예전|옛날|지난번|처음 만[났난]|기억(?:하|해|났|난|나|이 |을 )|떠올[리랐렸]|회상/g,
  /\b(?:years?|months?|weeks?) (?:ago|earlier|before)\b|\bback then\b|\bremember(?:ed|s|ing)?\b|\brecall(?:ed|s|ing)?\b|\bused to\b|\bthat (?:day|night)\b|\ball those (?:years|months)\b|\bmemor(?:y|ies)\b|\bthe first time\b|\bjust like (?:before|always)\b/gi,
];
const key = (t) => String(t).toLowerCase().replace(/[\s-]+/g, ' ').trim().replace(/s$/, '');

function figures(text) {
  const out = new Map(), add = (raw) => { const k = key(raw); if (k && !out.has(k)) out.set(k, String(raw).toLowerCase().replace(/\s+/g, ' ').trim()); };
  const s = String(text || '');
  for (const m of s.matchAll(KO_DIGIT)) add(m[0]);
  for (const m of s.matchAll(KO_NATIVE)) add(m[2]);
  for (const m of s.matchAll(KO_SINO)) add(m[2]);
  for (const m of s.matchAll(EN_NUM)) add(m[0]);
  for (const m of s.matchAll(EN_ORD)) add(m[0]);
  return out;
}
const recalls = (text) => RECALL.reduce((n, re) => n + (String(text || '').match(re) || []).length, 0);

// texts: the last AI replies, oldest first (six are enough).
// nums: figures written in 3 of the last 6 replies, or in both of the last two (4 at most, as they were written).
// recall: 2 of the last 3 replies reached back to the past three times or more.
export function wornOf(texts) {
  const list = (texts || []).slice(-6), n = list.length, count = new Map(), raw = new Map(), late = new Map();
  list.forEach((t, i) => { for (const [k, r] of figures(t)) { count.set(k, (count.get(k) || 0) + 1); if (!raw.has(k)) raw.set(k, r); if (i >= n - 2) late.set(k, (late.get(k) || 0) + 1); } });
  const nums = [...count.keys()].filter((k) => count.get(k) >= 3 || (n >= 2 && late.get(k) >= 2)).sort((a, b) => count.get(b) - count.get(a)).slice(0, 4).map((k) => raw.get(k));
  const recall = list.slice(-3).filter((t) => recalls(t) >= 3).length >= 2;
  return { nums, recall };
}
