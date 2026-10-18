// The same cases as the Android app's PracticeTest and RulesTest, so the two apps agree
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeEnough, Leitner, PracticeRound, practiceChoices, practiceWords, type StudyWord, sessionAccolades } from './rules.ts';

const word = (key: string, original: string, translated: string, src = 'en', box = 0): StudyWord => ({ key, original, translated, src, box });
const pool = [
  word('1', 'house', 'casa'),
  word('2', 'river', 'rio'),
  word('3', 'bank', 'margem'),
  word('4', 'bright', 'claro'),
  word('5', 'maison', 'casa', 'fr'),
  word('6', 'home', 'Casa'),
];

test('Leitner climbs boxes and resets', () => {
  assert.deepEqual(Leitner.next(0, true, 10), [1, 11]);
  assert.deepEqual(Leitner.next(1, true, 10), [2, 13]);
  assert.deepEqual(Leitner.next(5, true, 10), [6, 100]);
  assert.deepEqual(Leitner.next(6, true, 10), [Leitner.MASTERED, null]);
  assert.deepEqual(Leitner.next(4, false, 10), [0, 10]);
});

test('choices mix the meaning with other words of the same language', () => {
  const options = practiceChoices(pool[0], pool);
  assert.equal(options.length, 4);
  assert.ok(options.includes('casa'));
  assert.equal(new Set(options.map((o) => o.toLowerCase())).size, 4); // "Casa" of another word isn't a second right answer
  for (const o of ['rio', 'margem', 'claro']) assert.ok(options.includes(o));
  assert.deepEqual(practiceChoices(pool[0], pool.slice(0, 3)), []);
});

test('written answers forgive case, accents and one typo', () => {
  assert.ok(closeEnough('café', 'Cafe'));
  assert.ok(closeEnough('gave up', 'gave  up!'));
  assert.ok(closeEnough('thunder', 'thuner'));
  assert.ok(closeEnough('glance (quick look)', 'glance'));
  assert.ok(closeEnough('ojeada, vistazo', 'vistazo'));
  assert.ok(!closeEnough('car', 'cat'));
  assert.ok(!closeEnough('thunder', 'thin'));
});

test('a round asks each word twice and brings misses back', () => {
  const round = new PracticeRound(pool.slice(0, 4), pool);
  assert.equal(round.total, 8);
  const first = round.current;
  assert.equal(first?.stage, 'choice');
  round.answer(false);
  assert.ok(round.missed.has(first?.word.key as string));
  assert.equal(round.done, 0);
  for (let i = 0; i < 20 && round.current; i++) round.answer(true);
  assert.equal(round.current, undefined);
  assert.equal(round.done, 8);
  assert.deepEqual([...round.missed], [first?.word.key]);
  assert.equal(new PracticeRound([pool[0]], [pool[0]]).current?.stage, 'written');
});

test('due and still-learning words come first', () => {
  const mastered = word('7', 'fair', 'justo', 'en', Leitner.MASTERED);
  const picked = practiceWords([mastered, pool[1], pool[2]], [pool[2]], 2);
  assert.deepEqual(new Set(picked.map((w) => w.key)), new Set(['2', '3']));
});

test('a round earns perfect, fast and a new combo record', () => {
  assert.deepEqual(sessionAccolades(5, 0, 30, 5, 4), ['perfect', 'fast', 'comboRecord']);
  assert.deepEqual(sessionAccolades(5, 1, 31, 4, 4), []);
  assert.deepEqual(sessionAccolades(10, 8, 100, 2, 0), []);
  assert.deepEqual(sessionAccolades(0, 0, 0, 0, 0), []);
});
