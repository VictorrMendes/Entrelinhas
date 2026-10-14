import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Gemini } from '../src/translate/gemini.ts';
import { bearer, deviceToken, makeApp } from './helpers.ts';

const usage = { tokens: { input: 1, output: 1, total: 2 } };

test('translation requires a token and rejects bad input', async () => {
  const app = await makeApp();
  const body = { text: 'a', sourceLang: 'en', targetLang: 'pt' };
  assert.equal((await app.inject({ method: 'POST', url: '/translate', payload: body })).statusCode, 401);
  const h = bearer(await deviceToken(app, 'device-1'));
  const blank = await app.inject({ method: 'POST', url: '/translate', headers: h, payload: { ...body, text: '  ' } });
  assert.equal(blank.statusCode, 400);
  assert.equal(blank.json().error.code, 'INVALID_REQUEST');
  const emptyBatch = await app.inject({
    method: 'POST',
    url: '/translate/batch',
    headers: h,
    payload: { targetLanguage: 'pt', items: [] },
  });
  assert.equal(emptyBatch.json().error.code, 'INVALID_BATCH_REQUEST');
});

test('translates single text and batches, dropping unknown ids', async () => {
  const gemini: Gemini = async (_system, _text, schema) => ({
    text: schema
      ? JSON.stringify([
          { blockId: '1', translatedText: 'olá' },
          { blockId: 'x', translatedText: '?' },
        ])
      : ' casa ',
    usage,
  });
  const app = await makeApp({ gemini });
  const h = bearer(await deviceToken(app, 'device-2'));
  const single = await app.inject({
    method: 'POST',
    url: '/translate',
    headers: h,
    payload: { text: 'house', sourceLang: 'en', targetLang: 'pt' },
  });
  assert.equal(single.statusCode, 200);
  assert.equal(single.json().data.translatedText, 'casa');
  const batch = await app.inject({
    method: 'POST',
    url: '/translate/batch',
    headers: h,
    payload: {
      targetLanguage: 'pt',
      items: [
        { blockId: '1', text: 'hello' },
        { blockId: '2', text: 'world' },
      ],
    },
  });
  assert.equal(batch.statusCode, 200);
  assert.deepEqual(batch.json().data.items, [{ blockId: '1', translatedText: 'olá' }]);
});

test('word translation sends the sentence as context', async () => {
  let seen = { system: '', text: '' };
  const app = await makeApp({
    gemini: async (system, text) => {
      seen = { system, text };
      return { text: 'claro', usage };
    },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/translate',
    headers: bearer(await deviceToken(app, 'device-3')),
    payload: { text: 'bright', sourceLang: 'en', targetLang: 'pt', context: 'It was a bright cold day.' },
  });
  assert.equal(res.json().data.translatedText, 'claro');
  assert.equal(seen.text, 'bright');
  assert.match(seen.system, /bright cold day/);
  assert.match(seen.system, /Brazilian Portuguese/);
});

test('enforces the daily character limit per account', async () => {
  const app = await makeApp({ env: { DAILY_CHAR_LIMIT: '50' } });
  const h = bearer(await deviceToken(app, 'device-4'));
  const payload = { text: 'x'.repeat(30), sourceLang: 'en', targetLang: 'pt' };
  assert.equal((await app.inject({ method: 'POST', url: '/translate', headers: h, payload })).statusCode, 200);
  const over = await app.inject({ method: 'POST', url: '/translate', headers: h, payload });
  assert.equal(over.statusCode, 429);
  assert.equal(over.json().error.code, 'LIMIT_EXCEEDED');
});

test('a model outage becomes a 502 the app can explain', async () => {
  const app = await makeApp({
    gemini: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/translate',
    headers: bearer(await deviceToken(app, 'device-5')),
    payload: { text: 'house', sourceLang: 'en', targetLang: 'pt' },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error.code, 'TRANSLATION_FAILED');
});
