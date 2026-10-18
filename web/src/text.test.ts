// node --test runs this straight from TypeScript (npm test); it needs no browser
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sentenceAt, txtBlocks, wordAt } from './text.ts';

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

test('a TXT book splits on blank lines and joins wrapped lines', () => {
  assert.deepEqual(txtBlocks('Line one\nstill one.\n\n\nTwo\r\n\r\n  Three  \n'), ['Line one still one.', 'Two', 'Three']);
});
