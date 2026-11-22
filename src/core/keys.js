// Key registry: every classifier key, its group and its prompt line. The [KEYS] block of the prompt is built from
// the switched-on keys only, so turning groups on or off never changes the output format.
export const GROUPS = [
  { id: 'core', on: true, fixed: true },
  { id: 'look', on: true }, { id: 'space', on: true }, { id: 'people', on: true }, { id: 'role', on: true },
  { id: 'lie', on: true }, { id: 'owe', on: true }, { id: 'rel1', on: true }, { id: 'check', on: true }, { id: 'air', on: true },
  { id: 'money', on: false }, { id: 'stat', on: false }, { id: 'seed', on: false },
];
// Order = importance (a light model that runs out of room drops the last lines first).
export const KEYS = [
  ['cut', 'core', 'cut: 새 장면 첫 몇 낱말 | 바뀐 것(시간/장소)', 'cut: first few words where a new scene starts | what changed (time/place)'],
  ['with', 'core', 'with: =이름,이름 (전체)  또는  +이름 / -이름', 'with: =Name,Name (full list)  or  +Name / -Name'],
  ['time', 'core', 'time: +4d 아침 / +20min / 밤 / +?d (며칠, 날 모름)', 'time: +4d morning / +20min / night / +?d (a few days, day unknown)'],
  ['date', 'core', 'date: 3월 2일 / 12월 초 / 화요일   (글이 날 · 달 · 계절 바뀜을 밝힐 때)', 'date: March 2 / early December / Tuesday   (when the text names a day, month or season change)'],
  ['loc', 'core', 'loc: 큰 장소 > 작은 장소 > 방', 'loc: big place > smaller place > room'],
  ['wear', 'look', 'wear: 이름=지금 옷   또는   이름=+입음 / -벗음(어디에 둠)', 'wear: Name=clothes now   or   Name=+put on / -taken off (where it is)'],
  ['body', 'look', 'body: 이름=다침|취함|지침|나음 + 짧은 말', 'body: Name=hurt|drunk|exhausted|healed + a few words'],
  ['gone', 'people', 'gone: 이름=떠남|죽음 | "인용"', 'gone: Name=left|dead | "quote"'],
  ['pos', 'look', 'pos: 이름=짧게 (앉음|섬|누움, 누구의 왼쪽/오른쪽, 거리)', 'pos: Name=a few words (sitting|standing|lying, left/right of whom, how close)'],
  ['item', 'look', 'item: 이름=+들고 있거나 지닌 물건 / -내려놓음', 'item: Name=+thing carried or held / -thing put down'],
  ['mark', 'look', 'mark: 이름=늘 있는 특징(흉터 · 문신 · 반지 · 늘 쓰는 안경)', 'mark: Name=lasting feature (scar, tattoo, ring, glasses always worn)'],
  ['near', 'space', 'near: 장소 — 옆|위|아래|안쪽|맞은편|끝: 장소 | "인용"', 'near: Place — beside|above|below|inside|across|end of: Place | "quote"'],
  ['role', 'role', 'role: 이름=직위 · 신분 (바뀌거나 처음 밝혀질 때)', 'role: Name=position or status (when it changes or is first revealed)'],
  ['know', 'people', 'know: 이름=방금 알게 된 비밀 · 소식 · 정체 (누구의 · 누구에 대한 것인지 이름까지)', 'know: Name=secret · news · identity just learned, with names (whose, about whom)'],
  ['lie', 'lie', 'lie: A>B=A가 B에게 숨기거나 속인 것 | "인용"   (들키면 A>B=-무엇)', 'lie: A>B=what A hides from or lies to B | "quote"   (found out: A>B=-what)'],
  ['owe', 'owe', 'owe: A>B=A가 B에게 진 빚 · 은혜 · 약점 (갚거나 풀리면 -무엇)', 'owe: A>B=what A owes B (debt, life, a weakness held) (settled: -what)'],
  ['promise', 'people', 'promise: A>B=무엇, 언제', 'promise: A>B=what, when'],
  ['money', 'money', 'money: 이름=지금 가진 돈 (=300 골드)  또는  +50 골드 / -20 골드', 'money: Name=money held now (=300 gold)  or  +50 gold / -20 gold'],
  ['stat', 'stat', 'stat: 이름=항목=값 (체력=30/100 · 허기=높음)', 'stat: Name=item=value (HP=30/100 · hunger=high)'],
  ['weather', 'air', 'weather: 날씨', 'weather: weather'],
  ['mood', 'air', 'mood: 짧은 말', 'mood: a few words'],
  ['call', 'people', 'call: A>B=A가 B를 부르는 말, 존댓말|반말', 'call: A>B=what A calls B, formal|casual'],
  ['touch', 'rel1', 'touch: A>B=없음|스침|손|포옹|입맞춤|그 이상', 'touch: A>B=none|brush|hand|hug|kiss|more'],
  ['tie', 'rel1', 'tie: A-B=글이 밝힌 관계', 'tie: A-B=relationship the text states'],
  ['refuse', 'rel1', 'refuse: A>B=A가 B의 무엇을 거절 · 피함 | "인용"', 'refuse: A>B=what A refused or turned away from B | "quote"'],
  ['yield', 'rel1', 'yield: A>B=A가 B에게 넘어가 준 것 | "인용"   (A가 거절했거나 A답지 않은데 들어줌)', 'yield: A>B=what A gave in on | "quote"   (A had refused it, or would not by A\'s own stance, and went along anyway)'],
  ['press', 'rel1', 'press: A>B=A가 다시 요구한 것 | "인용"   (B가 이미 거절한 것을 또 요구)', 'press: A>B=what A asked for again | "quote"   (A repeats or pushes an ask that B already turned away)'],
  ['lead', 'rel1', 'lead: 이름=한 일 | "인용"   (누구에게 답한 게 아니라 스스로 정하거나 시작하거나 장면을 튼 사람, 한 줄까지)', 'lead: Name=the move | "quote"   (who decided, proposed, started or turned the scene on their own, not in answer to someone; one line at most)'],
  ['aside', 'rel1', 'aside: A>B=그 말 | "인용"   (A가 관계보다 따뜻한 말을 하고 넘어감)', 'aside: A>B=the remark | "quote"   (A said something warmer than their relationship allows, then dropped it)'],
  ['seed', 'seed', 'seed: 이름=작고 오래가는 것 | "인용"   (좋아함 · 싫어함 · 버릇 · 무서워함 · 바람, 처음 나올 때만, 한 줄까지)', 'seed: Name=small lasting thing about them | "quote"   (a like, dislike, habit, fear or wish, the first time the text states it; one line at most)'],
  ['alias', 'people', 'alias: 이름=다른 이름', 'alias: Name=other name'],
  ['slip', 'check', 'slip: 이름=무엇 | "인용"', 'slip: Name=what | "quote"'],
].map(([id, group, ko, en]) => ({ id, group, ko, en }));
export const ALL = KEYS.map((k) => k.id);

// groups: { id: true|false } from the settings (missing = the group's default).
export const isOn = (groups, g) => { const d = GROUPS.find((x) => x.id === g); return !d || d.fixed ? true : groups?.[g] ?? d.on; };
export const activeKeys = (groups) => KEYS.filter((k) => isOn(groups, k.group)).map((k) => k.id);
export function keysBlock(groups, lg) {
  return KEYS.filter((k) => isOn(groups, k.group)).map((k) => (lg === 'ko' ? k.ko : k.en)).join('\n');
}
