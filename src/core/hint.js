// Finds a time skip in a director's hidden instruction ("four days later", "나흘 뒤", "the next morning").
// Only a hint: the story text stays the first source; a person confirms before it is used.
const EN_N = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3, several: 3 };
const KO_N = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 여드레: 8, 아흐레: 9, 열흘: 10, 보름: 15, 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 몇: 3 };
const UNIT = { day: 1, week: 7, fortnight: 14, month: 30, year: 365, 일: 1, 주: 7, 주일: 7, 달: 30, 개월: 30, 년: 365 };
const FZ = { 1: 'd', 7: 'w', 14: 'w', 30: 'mo', 365: 'y' };   // "a few days / 몇 주": the length is unknown
const num = (w) => (/^\d+$/.test(w) ? +w : EN_N[w.toLowerCase()] ?? KO_N[w] ?? null);

export function findSkip(text) {
  const s = String(text || '');
  let m = s.match(/\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|several|couple(?: of)?)\s+(day|week|fortnight|month|year)s?\s+(?:later|after|on|pass(?:es|ed)?|have passed|go(?:es)? by|skip)/i);
  if (m) { const n = num(m[1].split(' ')[0]), u = UNIT[m[2].toLowerCase()]; if (n && u) return { days: Math.min(n * u, 400), text: m[0], ...(/few|several/i.test(m[1]) ? { fuzzy: FZ[u] } : {}) }; }
  m = s.match(/(\d{1,3}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇)\s*(일|주일|주|달|개월|년)\s*(?:뒤|후|이 지나|가 지나|지나)/);
  if (m) { const n = num(m[1]), u = UNIT[m[2]]; if (n && u) return { days: Math.min(n * u, 400), text: m[0], ...(m[1] === '몇' ? { fuzzy: FZ[u] } : {}) }; }
  m = s.match(/며칠\s*(?:뒤|후|이 지나|가 지나|지나|이 흘|가 흘)/);
  if (m) return { days: 3, text: m[0], fuzzy: 'd' };
  m = s.match(/(하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘|보름)\s*(?:뒤|후|이 지나|가 지나|지나)/);
  if (m) return { days: KO_N[m[1]], text: m[0] };
  m = s.match(/\b(the )?(next|following) (day|morning|evening|night)\b|다음 ?날|이튿날|다음 날 아침/i);
  if (m) return { days: 1, text: m[0] };
  return null;
}

// A jump in time asked for in plain words that findSkip has no day count for ("몇 시간 뒤", "a while later", "타임스킵").
// Only for the wording of the note (the story must open after the gap); the calendar is not touched.
// text '' = a jump was asked for, without saying how far.
export function findJump(text) {
  const s = String(text || '');
  let m = s.match(/(?:\d{1,2}|한|두|세|네|몇|반)\s*시간\s*(?:뒤|후|이 지나|이 흐|지나)|잠시 ?후|얼마 ?(?:뒤|후)|한참 ?(?:뒤|후)|시간이 ?(?:흘러|지나|흐른)/);
  if (m) return { text: m[0] };
  m = s.match(/\b(?:(?:an?|one|two|three|four|five|six|a few|several|a couple of|\d{1,2}) hours? later|half an hour later|hours later|later that (?:day|night|evening|afternoon)|some time later|a while later)\b/i);
  if (m) return { text: m[0] };
  if (/타임 ?스킵|시간 ?(?:넘김|넘기|넘겨|건너뛰|스킵)|time[- ]?skip|skip (?:ahead|forward)|fast[- ]forward|jump (?:ahead|forward)/i.test(s)) return { text: '' };
  return null;
}

// Prompt messages the director sees as "this turn": everything after the last assistant message,
// minus this extension's own blocks (they may share a message with other injections, so only the block is cut).
// skip = text already kept elsewhere (the person's own message, which is in the chat).
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function stripOwn(t, ownHeads, ownTexts = []) {
  let s = String(t || '');
  for (const x of ownTexts) if (x) s = s.split(x).join('');
  for (const h of ownHeads) if (h && s.includes(h)) s = s.replace(new RegExp(`${esc(h)}[^\\n]*(\\n(?!\\s*\\n)[^\\n]*)*`, 'g'), '');
  return s;
}
export function directorTail(messages, ownHeads, ownTexts = [], skip = '') {
  const last = messages.map((m) => m.role).lastIndexOf('assistant');
  const sk = String(skip || '').trim();
  return messages.slice(last + 1).map((m) => stripOwn(typeof m.content === 'string' ? m.content : (m.content || []).map((x) => x?.text || '').join('\n'), ownHeads, ownTexts))
    .map((t) => (sk && t.includes(sk) ? t.split(sk).join('') : t)).map((t) => t.trim()).filter(Boolean).join('\n');
}
// The instruction kept for the classifier: the last `max` letters, on a line boundary when one is close.
export function dirClip(t, max = 500) {
  const s = String(t || '').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= max) return s;
  const cut = s.slice(-max), nl = cut.indexOf('\n');
  return nl >= 0 && nl < 120 ? cut.slice(nl + 1) : cut;
}
