// Run: node --test tests/*.test.mjs   (no packages needed; only the pure core is tested)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { placeReplies, rollDates, weekKey, wdOf, dimOf, addDays, dayDiff } from '../src/core/calendar.js';
import { pending, absorb, splitByReply, buildPrompt, DEFAULTS } from '../src/core/bundle.js';
import { parse } from '../src/core/parse.js';
import { fold } from '../src/core/fold.js';
import { mergeVocab, fingerprint } from '../src/core/clean.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url)));
const en = read('lang/en.json'), ko = read('lang/ko.json'), V = mergeVocab(en, ko);
const prompts = { ko: fs.readFileSync(new URL('../prompts/surface.ko.txt', import.meta.url), 'utf8'), en: fs.readFileSync(new URL('../prompts/surface.en.txt', import.meta.url), 'utf8') };

// a small story: [text, classifier lines]
function story(plan) {
  const chat = [], ev = {};
  for (const [t, a] of plan) {
    chat.push({ is_user: true, mes: '다음', name: 'U' }); chat.push({ is_user: false, mes: t, name: 'N' });
    const i = chat.length - 1;
    absorb(ev, { text: t, fps: [fingerprint(chat[i])] }, `<mb>\n${a}\n</mb>`, fold(chat.slice(0, i), ev, V), V);
  }
  return { chat, ev, st: fold(chat, ev, V) };
}
const days = (P) => P.list.map((r) => `${r.m}/${r.d}${r.approx ? '~' : ''}`);

test('years 0-99 keep their own weekdays and leap days', () => {
  assert.equal(dimOf(4, 2), 29); assert.equal(dimOf(100, 2), 28); assert.equal(dimOf(2024, 2), 29);
  assert.equal(wdOf(2026, 11, 23), 1);                     // a Monday
  assert.equal(weekKey(2026, 1, 1), '2025-12-28');          // week starts on Sunday, across the year
  assert.deepEqual(addDays({ y: 2026, m: 12, d: 30 }, 3), { y: 2027, m: 1, d: 2 });
  assert.equal(dayDiff({ y: 2026, m: 2, d: 27 }, { y: 2026, m: 3, d: 2 }), 3);
});

test('a full date named after "a few days" is taken, not kept back', () => {
  const { st } = story([['3월 2일 월요일 아침', 'date: 3월 2일 월요일'], ['며칠 뒤 도서관', 'time: +?d'], ['3월 20일 금요일 밤 축제', 'date: 3월 20일 금요일'],
    ['몇 주 뒤', 'time: +?w'], ['4월 10일 역', 'date: 4월 10일']]);
  assert.deepEqual(days(placeReplies(st, 2026)), ['3/2', '3/4~', '3/20', '3/27~', '4/10']);
});

test('🎲 lands inside the striped week, after the day before, not past the next named date', () => {
  const list = [{ i: 1, y: 2026, m: 3, d: 1 }, { i: 3, y: 2026, m: 3, d: 8, approx: true, wk: weekKey(2026, 3, 8) }, { i: 5, y: 2026, m: 4, d: 1 }];
  for (let k = 0; k < 200; k++) { const [r] = rollDates({ list, undated: [] }, [], 2026); assert.equal(r.i, 3); assert.ok(r.date.m === 3 && r.date.d >= 8 && r.date.d <= 14, JSON.stringify(r.date)); }
  const tight = [{ i: 1, y: 2026, m: 3, d: 10 }, { i: 3, y: 2026, m: 3, d: 12, approx: true, wk: weekKey(2026, 3, 12) }, { i: 5, y: 2026, m: 3, d: 13 }];
  for (let k = 0; k < 200; k++) { const [r] = rollDates({ list: tight, undated: [] }, [], 2026); assert.ok(r.date.d >= 11 && r.date.d <= 13); }
});

test('🎲 with no date at all picks a start day on the first read reply', () => {
  const [r] = rollDates({ list: [], undated: [0, 1, 3] }, [{ i: 0, read: false }, { i: 1, read: true }], 2026);
  assert.equal(r.i, 1); assert.equal(r.date.y, 2026); assert.ok(r.date.d >= 1 && r.date.d <= dimOf(2026, r.date.m));
});

test('처음부터 정리: replies are numbered and each line goes back to its reply', () => {
  const chat = []; for (let k = 0; k < 5; k++) { chat.push({ is_user: true, mes: `u${k}`, name: 'U' }); chat.push({ is_user: false, mes: `답 ${k} 학교`, name: 'N' }); }
  const ev = {}, b = pending(chat, ev, { ...DEFAULTS, fill: 6 });
  assert.deepEqual(b.ids, [1, 3, 5, 7, 9]); assert.ok(b.text.includes('[#3]'));
  const ans = '<mb>\n#1 date: 3월 2일\n#1 loc: 학교\nwith: 지호\n#5 time: +1d\n#99 weather: 비\n</mb>';
  const sp = splitByReply(ans, b.ids);
  assert.deepEqual(sp.get(1), ['date: 3월 2일', 'loc: 학교', 'with: 지호']);   // an unnumbered line follows the one before
  assert.deepEqual(sp.get(5), ['time: +1d']); assert.deepEqual(sp.get(9), ['weather: 비']);   // out of range → nearest before
  const r = absorb(ev, b, ans, fold(chat, {}, V), V);
  assert.equal(r.pushed, false); assert.ok(r.parts);
  assert.deepEqual(ev[b.fps[0]].map((e) => e.k).sort(), ['date', 'loc', 'with']);
  assert.deepEqual(ev[b.fps[2]].map((e) => e.k), ['time']);
  assert.equal(splitByReply('<mb>\nloc: 학교\n</mb>', b.ids), null);           // an old-style answer: all on the last, as before
});

test('a «#12» in front of a line is not a broken line', () => {
  assert.deepEqual(parse('<mb>\n#12 loc: 학교\n[#3] time: +1d\n</mb>').lines.map((l) => l.k), ['loc', 'time']);
});

test('the date rules go only into 처음부터 정리 prompts', () => {
  const st = fold([], {}, V);
  for (const lang of ['ko', 'en']) {
    const fillP = buildPrompt(prompts, { text: 'x', fill: true }, st, { en, ko }, [], { lang }).prompt;
    assert.match(fillP, lang === 'ko' ? /\[처음부터 정리: 날짜는 꼭\][\s\S]*\n\[키\]/ : /\[Rebuild from the start: dates matter\][\s\S]*\n\[KEYS\]/);
    assert.doesNotMatch(buildPrompt(prompts, { text: 'x' }, st, { en, ko }, [], { lang }).prompt, /처음부터 정리: 날짜|Rebuild from the start/);
  }
});
