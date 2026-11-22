// Finds the sentence in a reply that supports a value ("linen shirt", "June", "four days"). No model call.
const STOP = new Set('the a an and or of to in on at with his her their its is was were be been by for from as that this into over under then than'.split(' '));
const words = (s) => String(s || '').toLowerCase().match(/[a-z]{3,}|[가-힣]{2,}|\d+/g)?.filter((w) => !STOP.has(w)) || [];
export const sentences = (text) => String(text || '').replace(/([.!?。…"”])\s+/g, '$1\n').split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 3);

// `who` = names that should appear in the sentence (weighted most), `extra` = more hint words.
export function findEvidence(text, value, extra = [], who = []) {
  const want = [...new Set([...words(value), ...extra.map((x) => x.toLowerCase())])];
  const names = who.filter(Boolean).map((n) => n.toLowerCase());
  if (!want.length) return '';
  let best = '', score = 0;
  for (const s of sentences(text)) {
    const low = s.toLowerCase();
    const hit = want.reduce((a, w) => a + (low.includes(w) ? (w.length > 4 ? 2 : 1) : 0), 0);
    const sc = hit ? hit + names.reduce((a, n) => a + (low.includes(n) ? 3 : 0), 0) : 0;
    if (sc > score) { score = sc; best = s; }
  }
  return best.length > 180 ? `${best.slice(0, 177)}…` : best;
}
// Words that mark time moving, in both story languages.
export const TIME_MARKS = ['later', 'after', 'passed', 'next', 'following', 'morning', 'night', 'week', 'weeks', 'days', 'month', '뒤', '후', '지나', '다음', '이튿날', '아침', '밤'];
