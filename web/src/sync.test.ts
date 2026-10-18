// The Android app's SyncTest, case for case, plus what the web app reads from a snapshot
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySnapshot, fromJson, merge, type Snapshot, type SyncBook, type SyncDay, type SyncHighlight, type SyncWord } from './sync.ts';

const A = 'a'.repeat(64);
const book = (hash: string, lastBlock: number, at: number): SyncBook => ({
  hash,
  title: 'T',
  fileType: 'epub',
  language: 'en',
  targetLanguage: 'pt',
  lastBlock,
  lastOpenedAt: at,
  completedAt: null,
  updatedAt: at,
  shelves: '',
});
const word = (text: string, box: number, at: number): SyncWord => ({
  normalized: text,
  original: text,
  translated: 'x',
  src: 'en',
  tgt: 'pt',
  bookTitle: null,
  example: null,
  box,
  dueDay: 1,
  savedAt: 0,
  updatedAt: at,
});
const day = (d: number, seconds: number, met: number): SyncDay => ({
  day: d,
  active: 1,
  sessions: 1,
  translations: 0,
  words: 0,
  paragraphs: 0,
  autoParagraphs: 0,
  seconds,
  goalMet: met,
  dictations: 0,
});
const snap = (s: Partial<Snapshot>): Snapshot => ({ ...emptySnapshot(), ...s });
const byDay = (days: SyncDay[]) => [...days].sort((x, y) => x.day - y.day);

test('the newest edit wins, whichever side syncs first', () => {
  const phone = snap({ books: [book(A, 10, 100)], words: [word('dog', 3, 50)] });
  const tablet = snap({ books: [book(A, 40, 200)], words: [word('dog', 1, 20), word('cat', 0, 30)] });
  const m = merge(phone, tablet);
  assert.equal(m.books.length, 1);
  assert.equal(m.books[0].lastBlock, 40);
  assert.deepEqual(Object.fromEntries(m.words.map((w) => [w.normalized, w.box])), { dog: 3, cat: 0 });
  const other = merge(tablet, phone).words;
  assert.deepEqual(new Set(m.words.map((w) => JSON.stringify(w))), new Set(other.map((w) => JSON.stringify(w))));
});

test('a deletion beats older edits only', () => {
  const local = snap({ deletions: { 'word|dog|en|pt': 100, [`book|${A}`]: 100 } });
  const remote = snap({ books: [book(A, 5, 90)], words: [word('dog', 2, 90), word('cat', 0, 90)] });
  const m = merge(local, remote);
  assert.deepEqual(m.books, []);
  assert.deepEqual(
    m.words.map((w) => w.normalized),
    ['cat'],
  );
  // saved again after the deletion: it comes back
  assert.deepEqual(
    merge(local, snap({ words: [word('dog', 0, 150)] })).words.map((w) => w.normalized),
    ['dog'],
  );
});

test('highlights leave with their book', () => {
  const h: SyncHighlight = { book: A, block: 1, start: 0, end: 5, color: 0, note: 'note', createdAt: 10, updatedAt: 10 };
  assert.deepEqual(merge(snap({ highlights: [h] }), snap({ deletions: { [`book|${A}`]: 50 } })).highlights, []);
});

test('daily stats keep the larger counters instead of summing', () => {
  const m = merge(snap({ days: [day(7, 180, 1)] }), snap({ days: [day(7, 120, 0), day(8, 60, 0)] }));
  assert.deepEqual(byDay(m.days), [day(7, 180, 1), day(8, 60, 0)]);
  assert.deepEqual(byDay(merge(m, m).days), byDay(m.days)); // syncing again changes nothing
});

test('a snapshot from the server keeps what the Android app wrote and drops what is broken', () => {
  // org.json leaves out null fields, so they may be missing; a hash that isn't sha256 hex never reaches a URL
  const s = fromJson({
    books: [{ hash: A, title: 'T', fileType: 'pdf', lastBlock: 3, updatedAt: 5 }, { hash: '../x', title: 'Bad', fileType: 'epub', lastBlock: 0, updatedAt: 5 }],
    words: [{ normalized: 'dog', original: 'Dog', translated: 'cão', src: 'en', tgt: 'pt', box: 2, savedAt: 1, updatedAt: 2 }, { original: 'no key' }],
    days: [{ day: 9, active: 1, sessions: 2, translations: 3, words: 1, paragraphs: 0, autoParagraphs: 0, seconds: 60, goalMet: 1 }],
    deletions: { 'word|cat|en|pt': 7, junk: 'x' },
  });
  assert.deepEqual(s.books, [{ ...book(A, 3, 5), fileType: 'pdf', language: null, targetLanguage: null, lastOpenedAt: null }]);
  assert.deepEqual(s.words, [{ ...word('dog', 2, 2), original: 'Dog', translated: 'cão', dueDay: null, savedAt: 1 }]);
  assert.deepEqual(s.days, [{ ...day(9, 60, 1), sessions: 2, translations: 3, words: 1 }]);
  assert.deepEqual(s.deletions, { 'word|cat|en|pt': 7 });
  assert.deepEqual(fromJson(null), emptySnapshot());
});
