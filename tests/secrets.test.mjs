// v0.33: secrets open and lock one by one (they were keyed by the person, so one coming out opened them all).
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldVault, liveBp, sid } from '../src/core/vault.js';

const bp = { vault: [
  { who: 'Mira', v: 'Mira sold the lighthouse key', typed: true },
  { who: 'Mira', v: 'Mira can no longer swim', typed: true },
  { who: 'Orin', v: 'Orin reads the letters before delivering them', typed: true },
] };
const chat = ['r1', 'r2', 'r3', 'r4', 'r5'].map((t) => ({ is_user: false, mes: t }));
const fp = (m) => m.mes;
const st2 = { open: {} };
const live = (S) => liveBp(bp, foldVault(chat, S, bp, st2, fp)).vault.map((x) => x.v);

test('nothing is open by default', () => assert.equal(live({}).length, 3));
test('one secret coming out opens that one only', () => {
  const S = { guard: { r1: { hits: [{ who: 'Mira', sid: sid(bp.vault[0]), kind: 'revealed' }] } } };
  assert.deepEqual(live(S), ['Mira can no longer swim', 'Orin reads the letters before delivering them']);
});
test('an old leak with no id does not open a person\'s several secrets', () => {
  const S = { guard: { r1: { hits: [{ who: 'Mira', kind: 'revealed' }] } } };
  assert.equal(live(S).length, 3);
  const T = { guard: { r1: { hits: [{ who: 'Orin', kind: 'revealed' }] } } };   // Orin keeps one: that one opens
  assert.equal(live(T).length, 2);
});
test('locking again works and later replies do not undo it', () => {
  const id = sid(bp.vault[0]);
  const S = { guard: { r1: { hits: [{ who: 'Mira', sid: id, kind: 'revealed' }] } }, vdec: { r2: [{ who: 'Mira', sid: id, open: false }] } };
  assert.equal(live(S).length, 3);
});
test('opening by hand opens only the card that was pressed', () => {
  const S = { vdec: { r5: [{ who: 'Mira', sid: sid(bp.vault[1]), open: true }] } };
  assert.deepEqual(live(S), ['Mira sold the lighthouse key', 'Orin reads the letters before delivering them']);
});
test('a leak in a reply that was deleted no longer counts', () => {
  const S = { guard: { gone: { hits: [{ who: 'Orin', sid: sid(bp.vault[2]), kind: 'revealed' }] } } };
  assert.equal(live(S).length, 3);
});
test('a leak in the last two replies does not open yet', () => {
  const S = { guard: { r5: { hits: [{ who: 'Orin', sid: sid(bp.vault[2]), kind: 'revealed' }] } } };
  assert.equal(live(S).length, 3);
});
