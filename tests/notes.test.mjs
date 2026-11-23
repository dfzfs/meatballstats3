// v0.28–0.29: repeated figures / reaching back (core/worn.js) and time skips in plain words (core/hint.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { wornOf } from '../src/core/worn.js';
import { findSkip, findJump, skipInMessage } from '../src/core/hint.js';

test('a figure written in three of the last six replies is worn', () => {
  const r = wornOf(['7년 만에 온 편지였다.', '비가 왔다.', '벌써 7년이다.', '그는 웃었다.', '7년이라는 시간.', '문이 닫혔다.']);
  assert.deepEqual(r.nums, ['7년']);
});
test('a figure in both of the last two replies is worn; once is not', () => {
  assert.deepEqual(wornOf(['조용했다.', '9층 복도는 어두웠다.', '9층 창가에 섰다.']).nums, ['9층']);
  assert.deepEqual(wornOf(['조용했다.', '조용했다.', '9층 창가에 섰다.']).nums, []);
});
test('English figures and ordinals; plural and singular count as one', () => {
  const r = wornOf(['Seven years had passed.', 'A seven-year gap.', 'After seven years, nothing.', 'The ninth floor again.', 'Up on the ninth floor.']);
  assert.ok(r.nums.some((x) => x.startsWith('seven year')));
  assert.ok(r.nums.includes('ninth floor'));
});
test('ordinary words are not figures', () => {
  assert.deepEqual(wornOf(['오해였다. 사명감도 없었다.', '오해는 풀렸다. 사명을 다했다.', '구해 줘서 고마워. 오해야.']).nums, []);
  assert.deepEqual(wornOf(['작년 일이다. 청년은 웃었다.', '작년에도 그랬다. 청년이 말했다.']).nums, []);
});
test('reaching back: two of the last three replies with three or more', () => {
  const back = '그때를 기억했다. 예전에도 그랬다. 옛날 일을 떠올렸다.';
  assert.equal(wornOf(['비가 왔다.', back, back]).recall, true);
  assert.equal(wornOf([back, '비가 왔다.', '문을 열었다.']).recall, false);
  assert.equal(wornOf([]).recall, false);
});

test('findJump: hours, vague gaps, the plain word', () => {
  assert.equal(findJump('몇 시간 뒤 병원에서').text, '몇 시간 뒤');
  assert.equal(findJump('a few hours later, at the docks').text, 'a few hours later');
  assert.equal(findJump('타임스킵 해줘').text, '');
  assert.equal(findJump('그는 문을 닫는다'), null);
  assert.equal(findSkip('사흘 뒤').days, 3);
});
test('skipInMessage: an opening counts, talk does not', () => {
  assert.equal(skipInMessage('사흘 뒤, 항구.').text, '사흘 뒤');
  assert.equal(skipInMessage('문을 닫았다.\n(몇 시간 후)').text, '몇 시간 후');
  assert.equal(skipInMessage('*The next morning.* She woke early.').text.toLowerCase(), 'the next morning');
  assert.equal(skipInMessage('타임스킵 3일 뒤로').text, '3일 뒤');
  assert.equal(skipInMessage('타임스킵').text, '');
  assert.equal(skipInMessage('사흘 뒤에 보자고 말했다.'), null);
  assert.equal(skipInMessage('"사흘 뒤, 여기서 봐."'), null);
  assert.equal(skipInMessage('그는 3일 뒤 돌아오겠다고 했다.'), null);
  assert.equal(skipInMessage(''), null);
});
