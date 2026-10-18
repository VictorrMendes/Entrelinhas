// node --test runs this straight from TypeScript (npm test); it needs no browser
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fold, levelSample, nextWord, previousWord, sentenceAt, sentenceRanges, txtBlocks, wordAt } from './text.ts';

const page = "It was a bright cold day in April. The clocks were striking thirteen. I don't know why.";
const tapped = (offset: number) => {
  const w = wordAt(page, offset, 'en');
  return w && page.slice(w.start, w.end);
};

test('a tap picks the whole word, also right after its last letter, and nothing on a space between sentences', () => {
  assert.equal(tapped(page.indexOf('bright') + 2), 'bright');
  assert.equal(tapped(page.indexOf('bright') + 'bright'.length), 'bright');
  assert.equal(tapped(page.indexOf("don't") + 1), "don't");
  assert.equal(tapped(page.indexOf('. The') + 1), null);
});

test('the sentence around the word is its context', () => {
  assert.equal(sentenceAt(page, page.indexOf('clocks'), 'en'), 'The clocks were striking thirteen.');
});

test('sentences split for the interlinear lines, and a lookup grows by whole words', () => {
  const ranges = sentenceRanges(page, 'en').map(([s, e]) => page.slice(s, e));
  assert.deepEqual(ranges, ['It was a bright cold day in April.', 'The clocks were striking thirteen.', "I don't know why."]);
  const gave = 'He gave up, then left.';
  const up = gave.indexOf('up');
  assert.deepEqual(previousWord(gave, up, 'en'), { start: 3, end: 7 });
  assert.deepEqual(nextWord(gave, up + 2, 'en'), { start: gave.indexOf('then'), end: gave.indexOf('then') + 4 }); // skips the comma
  assert.equal(previousWord(gave, 0, 'en'), null);
});

test('search folding ignores case and accents and keeps the length', () => {
  assert.equal(fold('Ação Café'), 'acao cafe');
  assert.equal(fold('Ação Café').length, 'Ação Café'.length);
});

test('a TXT book splits on blank lines and joins wrapped lines', () => {
  assert.deepEqual(txtBlocks('Line one\nstill one.\n\n\nTwo\r\n\r\n  Three  \n'), ['Line one still one.', 'Two', 'Three']);
});

test('the level sample takes three excerpts of paragraphs, 1500 characters at most each', () => {
  const blocks = Array.from({ length: 10 }, (_, i) => ({ type: i === 0 ? 'h' : 'p', text: `P${i} ${'x'.repeat(i === 5 ? 2000 : 10)}` }));
  const parts = levelSample(blocks).split('\n\n[…]\n\n');
  assert.equal(parts.length, 3);
  assert.ok(parts[0].startsWith('P2 ')); // 20% of the 9 paragraphs, the heading left out
  assert.equal(parts[1].length, 1500);
  assert.ok(parts[2].startsWith('P8 ') && parts[2].includes('P9 '));
});
