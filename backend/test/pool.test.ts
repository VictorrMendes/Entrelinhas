import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/errors.ts';
import { type Model, modelPool } from '../src/translate/gemini.ts';

const usage = { tokens: { input: 1, output: 1, total: 2 } };
const answers =
  (text: string, ms = 0): Model =>
  () =>
    new Promise((r) => setTimeout(() => r({ text, usage }), ms));
const fails =
  (ms = 0): Model =>
  () =>
    new Promise((_, reject) => setTimeout(() => reject(new ApiError(429, 'RATE_LIMIT', 'busy')), ms));

test('the first model answers when it is quick', async () => {
  let asked = 0;
  const second: Model = async () => {
    asked++;
    return { text: 'second', usage };
  };
  const r = await modelPool([answers('first'), second], 50)('system', 'text');
  assert.equal(r.text, 'first');
  assert.equal(asked, 0);
});

test('a rate-limited model hands the question to the next one', async () => {
  const r = await modelPool([fails(), answers('second')], 1000)('system', 'text');
  assert.equal(r.text, 'second');
});

test('a slow model gets a second model asked in parallel; the first answer wins', async () => {
  const started = Date.now();
  const r = await modelPool([answers('slow', 500), answers('quick', 10)], 30)('system', 'text');
  assert.equal(r.text, 'quick');
  assert.ok(Date.now() - started < 300);
});

test('it fails only when every model failed', async () => {
  await assert.rejects(modelPool([fails(), fails(5)], 1000)('system', 'text'), { code: 'RATE_LIMIT' });
});
