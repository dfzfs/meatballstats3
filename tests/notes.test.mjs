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

test('dense: replies that measure and count nearly everything', () => {
  const tic = 'He paused three seconds, crossed eleven paces, stood two yards off. Thirty minutes later she moved seven inches. Seventeen boxes, nine jars, four bundles.';
  const calm = 'She crossed the room and sat by the window. Rain kept falling. He said nothing for a while, then set the cup down and looked at her. '.repeat(4);
  assert.equal(wornOf([calm, tic, tic]).dense, true);
  assert.equal(wornOf([tic, calm, calm]).dense, false);
  assert.equal(wornOf([tic, tic, calm, calm]).dense, true);   // sticky while two heavy replies are still in view
  assert.equal(wornOf([calm, calm, calm]).dense, false);
});
test('compound numbers stay whole', () => {
  const r = wornOf(['Thirty-six hours on the road.', 'After thirty-six hours they stopped.']);
  assert.deepEqual(r.nums, ['thirty-six hours']);
});
test('reaching back: shared-history details count too', () => {
  const back = 'Five summers of long voyages. She hummed the tune by memory, back when they lived by the coast.';
  assert.equal(wornOf(['Rain fell.', back, back]).recall, true);
});

test('spar: talk that cites, builds a case and bargains', () => {
  const debate = 'She frowned. "A minute ago you said the gate was shut. Now you want it open." He shrugged. "If you had asked, I would have told you." "You always do this."';
  const plain = 'She frowned. "The gate." He shrugged and looked at the hills. "Cold out," he said. "Mm."';
  assert.equal(wornOf([plain, debate]).spar, true);
  // it stays on for a few replies after the habit stops, then drops
  assert.equal(wornOf([debate, plain, plain]).spar, true);
  assert.equal(wornOf([debate, plain, plain, plain, plain, plain]).spar, false);
  assert.equal(wornOf(['“아까는 싫다고 했잖아. 이제 와서 왜 그래.” “만약 또 그러면 나 갈 거야.” “네가 먼저 그랬잖아.”']).spar, true);
  // the same words in narration, outside quotation marks, are not talk
  assert.equal(wornOf(['A minute ago you said nothing, he thought. If you leave, I stay. You always do this.']).spar, false);
});
