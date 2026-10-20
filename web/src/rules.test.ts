// The same cases as the Android app's PracticeTest and RulesTest, so the two apps agree
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACHIEVEMENTS,
  buildTest,
  checkDictation,
  closeEnough,
  isRight,
  Leitner,
  Levels,
  matchTiles,
  monthCells,
  PracticeRound,
  practiceChoices,
  practiceWords,
  type StudyWord,
  Streak,
  sessionAccolades,
  unlocked,
  vocabularyCsv,
  WeekStreak,
  xp,
} from './rules.ts';

const state = (current: number, longest: number, shields: number, metToday: boolean, recovery: { lost: number; done: number } | null = null) => ({
  current,
  longest,
  shields,
  metToday,
  recovery,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('the streak counts days in a row, spends shields on blank days and then breaks', () => {
  assert.deepEqual(Streak.compute([8, 9, 10], 10), state(3, 3, 2, true));
  // today not read yet: the streak is still alive
  assert.deepEqual(Streak.compute([8, 9, 10], 11), state(3, 3, 2, false));
  // day 11 blank -> one shield spent, the streak continues on day 12
  assert.deepEqual(Streak.compute([8, 9, 10, 12], 12), state(4, 4, 1, true));
  // three blank days > two shields -> restart, and the 3 lost days can be earned back
  assert.deepEqual(Streak.compute([8, 9, 10, 14], 14), state(1, 3, 2, true, { lost: 3, done: 1 }));
  // nothing since day 10 and two whole days missed (11, 12): shields cover it
  assert.deepEqual(Streak.compute([8, 9, 10], 13), state(3, 3, 0, false));
  assert.deepEqual(Streak.compute([8, 9, 10], 14), state(0, 3, 0, false, { lost: 3, done: 0 }));
  // day 3 blank spends one shield; reaching 7 streak days returns it
  assert.deepEqual(Streak.compute([1, 2, 4, 5, 6, 7, 8, 9], 9), state(8, 8, 2, true));
});

test('a broken streak comes back after five met days in a row', () => {
  const before = range(1, 10); // a 10-day streak, then 4 blank days: more than the 2 shields
  assert.deepEqual(Streak.compute(before, 14).recovery, { lost: 10, done: 0 });
  const midway = Streak.compute([...before, ...range(15, 17)], 17);
  assert.equal(midway.current, 3);
  assert.deepEqual(midway.recovery, { lost: 10, done: 3 });
  const back = Streak.compute([...before, ...range(15, 19)], 19);
  assert.equal(back.current, 15);
  assert.equal(back.recovery, null);
  // a blank day while earning back (even one a shield covers) loses it
  const gap = Streak.compute([...before, 15, 16, 18, 19, 20], 20);
  assert.equal(gap.current, 5);
  assert.equal(gap.recovery, null);
  // and so does coming back too late
  assert.equal(Streak.compute([...before, ...range(25, 29)], 29).current, 5);
});

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

test('XP climbs levels that grow longer', () => {
  assert.equal(Levels.of(0), 1);
  assert.equal(Levels.of(99), 1);
  assert.equal(Levels.of(100), 2);
  assert.equal(Levels.of(300), 3);
  const none = { readingMinutes: 0, savedWords: 0, learnedWords: 0, booksCompleted: 0, dictations: 0, goalDays: 0, longestStreak: 0, longestWeeks: 0 };
  // 30 min + 3 words × 5 + 5 dictations × 3 + 1 goal day × 20 + 1 book × 100
  assert.equal(xp({ ...none, readingMinutes: 30, savedWords: 3, dictations: 5, goalDays: 1, booksCompleted: 1 }), 180);
  const t = { ...none, savedWords: 50, readingMinutes: 599 };
  const byId = (id: string) => ACHIEVEMENTS.find((a) => a.id === id) as (typeof ACHIEVEMENTS)[number];
  assert.ok(unlocked(byId('words_50'), t));
  assert.ok(!unlocked(byId('ten_hours'), t));
});

// the Android HabitTest's days: today is 2026-10-15, a Thursday
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
const today = day(2026, 10, 15);

test('weeks in a row count this week once it has a reading day; an open week does not break them yet', () => {
  assert.deepEqual(WeekStreak.compute([day(2026, 9, 30), day(2026, 10, 6), day(2026, 10, 13)], today, 0), { current: 3, longest: 3, thisWeek: true });
  assert.deepEqual(WeekStreak.compute([day(2026, 9, 30), day(2026, 10, 6)], today, 0), { current: 2, longest: 2, thisWeek: false });
});

test('a whole week without reading starts the weeks over, and the first weekday follows the device', () => {
  const s = WeekStreak.compute([day(2026, 9, 1), day(2026, 9, 8), day(2026, 9, 15), day(2026, 10, 13)], today, 0);
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
  assert.equal(WeekStreak.compute([day(2026, 9, 30)], today, 0).current, 0);
  const sundayAndMonday = [day(2026, 10, 11), day(2026, 10, 12)];
  assert.equal(WeekStreak.compute(sundayAndMonday, today, 0).current, 1);
  assert.equal(WeekStreak.compute(sundayAndMonday, today, 1).current, 2);
});

test('a month grid starts on the right weekday', () => {
  const first = day(2026, 10, 1); // a Thursday
  const cells = monthCells(first, 31, 0);
  assert.equal(cells.indexOf(first), 4);
  assert.equal(cells.at(-1), first + 30);
  assert.equal(monthCells(first, 31, 1).indexOf(first), 3);
});
