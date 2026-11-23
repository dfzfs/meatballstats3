import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDict, learn, resolve } from '../src/core/names.js';
import { sameName } from '../src/core/roman.js';
const V = { particles: ['이', '가', '은', '는', '을', '를', '의', '에게', '한테', '랑', '이랑', '와', '과', '도', '아', '야'] };

test('a Korean name written in Latin letters is the same person', () => {
  const d = newDict(); learn(d, '서연', V); learn(d, '지호', V); learn(d, '김민재', V);
  assert.equal(resolve(d, 'Seoyeon', V), '서연');
  assert.equal(resolve(d, 'Seo-yeon', V), '서연');
  assert.equal(resolve(d, 'Jiho', V), '지호');
  assert.equal(resolve(d, 'Minjae', V), '김민재');
  assert.equal(resolve(d, 'Kim Minjae', V), '김민재');
  assert.equal(resolve(d, 'Grace', V), null);
});
test('the other way round, and no merging of different names', () => {
  const d = newDict(); learn(d, 'Hyunwoo', V);
  assert.equal(resolve(d, '현우', V), 'Hyunwoo');
  assert.equal(sameName('Jiwoo', '지호'), false);
  assert.equal(sameName('Seoyeon', '서준'), false);
  assert.equal(sameName('Will', '윌'), false);
});
import { soundPair } from '../src/core/roman.js';
test('English names written in Korean pair by sound, only when one fits', () => {
  const H = ['루피', '로우', '조로', '나미', '쵸파'];
  assert.equal(soundPair('Luffy', H), '루피');
  assert.equal(soundPair('Law', H), '로우');
  assert.equal(soundPair('Trafalgar Law', H), '로우');
  assert.equal(soundPair('Monkey D. Luffy', H), '루피');
  assert.equal(soundPair('Chopper', H), '쵸파');
  assert.equal(soundPair('Grace', H), null);
});
