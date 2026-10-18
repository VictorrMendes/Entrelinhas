// The same cases as the Android app's PracticeTest and RulesTest, so the two apps agree
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTest,
  checkDictation,
  closeEnough,
  isRight,
  Leitner,
  matchTiles,
  PracticeRound,
  practiceChoices,
  practiceWords,
  type StudyWord,
  sessionAccolades,
  vocabularyCsv,
} from './rules.ts';

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

// StudyModesTest
const seven = [
  word('1', 'house', 'casa'),
  word('2', 'river', 'rio'),
  word('3', 'bank', 'margem'),
  word('4', 'bright', 'claro'),
  word('5', 'clock', 'relógio'),
  word('6', 'home', 'casa'),
  word('7', 'window', 'janela'),
];

test('a test mixes the chosen kinds and counts right answers', () => {
  const t = buildTest(seven, seven, 6, new Set(['choice', 'written', 'trueFalse'] as const));
  assert.equal(t.length, 6);
  assert.deepEqual(new Set(t.map((q) => q.kind)), new Set(['choice', 'written', 'trueFalse']));
  for (const q of t) {
    const right = q.kind === 'choice' ? q.word.translated : q.kind === 'written' ? q.word.original.toUpperCase() : String(q.shown === q.word.translated);
    assert.ok(isRight(q, right));
    assert.ok(!isRight(q, ''));
  }
});

test('true/false shows a wrong meaning sometimes, and too few meanings fall back to written', () => {
  const shown = Array.from({ length: 20 }, () => buildTest(seven, seven, 7, new Set(['trueFalse'] as const))).flat();
  const asked = new Set(shown.map((q) => q.shown === q.word.translated));
  assert.ok(asked.has(true) && asked.has(false));
  assert.ok(buildTest(seven.slice(0, 2), seven.slice(0, 2), 2, new Set(['choice'] as const)).every((q) => q.kind === 'written'));
});

test('match uses pairs without twin meanings', () => {
  const tiles = matchTiles(seven, 6);
  assert.equal(tiles.length, 12);
  const pairs = Map.groupBy(tiles, (t) => t.pair);
  assert.ok([...pairs.values()].every((p) => p.length === 2));
  // "house" and "home" both mean "casa": only one of them may be on the board
  assert.equal(tiles.filter((t) => t.text === 'casa').length, 1);
});

// RulesTest
test('dictation ignores case, accents and punctuation, and marks wrong and missing words', () => {
  const perfect = checkDictation('Olá, mundo! Tudo bem?', 'ola mundo tudo bem');
  assert.equal(perfect.score, 100);
  assert.deepEqual(
    perfect.words.map((w) => w.mark),
    ['ok', 'ok', 'ok', 'ok'],
  );
  const r = checkDictation('The cold wind blew hard', 'the cold went blew');
  assert.deepEqual(r.words, [
    { text: 'The', mark: 'ok' },
    { text: 'cold', mark: 'ok' },
    { text: 'went', mark: 'wrong' },
    { text: 'wind', mark: 'missing' },
    { text: 'blew', mark: 'ok' },
    { text: 'hard', mark: 'missing' },
  ]);
  assert.equal(r.score, 60);
  assert.equal(checkDictation('Some words here', '').score, 0);
});

test('the vocabulary CSV quotes when needed', () => {
  const csv = vocabularyCsv([{ original: 'bright', translated: 'claro', example: 'A bright, cold day.', bookTitle: 'The "Quiet" Library' }]);
  assert.equal(csv.split('\n')[3], 'bright,claro,"A bright, cold day.","The ""Quiet"" Library"');
});

test('a round earns perfect, fast and a new combo record', () => {
  assert.deepEqual(sessionAccolades(5, 0, 30, 5, 4), ['perfect', 'fast', 'comboRecord']);
  assert.deepEqual(sessionAccolades(5, 1, 31, 4, 4), []);
  assert.deepEqual(sessionAccolades(10, 8, 100, 2, 0), []);
  assert.deepEqual(sessionAccolades(0, 0, 0, 0, 0), []);
});
