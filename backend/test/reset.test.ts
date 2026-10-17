import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, makeApp } from './helpers.ts';

/** An app whose mailer keeps the last code it was asked to send. */
async function appWithInbox() {
  const inbox: { to: string; text: string }[] = [];
  const app = await makeApp({ mailer: async (to, _subject, text) => void inbox.push({ to, text }) });
  const signup = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: 'ana@example.com', password: 'old password', name: 'Ana' },
  });
  const code = () => /(\d{6})/.exec(inbox.at(-1)?.text ?? '')?.[1] ?? '';
  return { app, inbox, code, oldToken: signup.json().data.token as string };
}

test('a code by email resets the password and signs out older sessions', async () => {
  const { app, inbox, code, oldToken } = await appWithInbox();
  const forgot = await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: 'Ana@Example.com' } });
  assert.equal(forgot.statusCode, 200);
  assert.equal(inbox.at(-1)?.to, 'ana@example.com');
  assert.match(inbox.at(-1)?.text ?? '', /Olá, Ana!/);

  // the iat of the new token is compared in whole seconds with the change time
  await new Promise((r) => setTimeout(r, 1100));
  const reset = await app.inject({
    method: 'POST',
    url: '/auth/password/reset',
    payload: { email: 'ana@example.com', code: code(), password: 'new password' },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().data.name, 'Ana');
  assert.equal((await app.inject({ url: '/sync/snapshot', headers: bearer(reset.json().data.token) })).statusCode, 200);
  assert.equal((await app.inject({ url: '/sync/snapshot', headers: bearer(oldToken) })).statusCode, 401);

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@example.com', password: 'new password' } });
  assert.equal(login.statusCode, 200);
  const reused = await app.inject({
    method: 'POST',
    url: '/auth/password/reset',
    payload: { email: 'ana@example.com', code: code(), password: 'another one' },
  });
  assert.equal(reused.json().error.code, 'INVALID_CODE');
});

test('unknown emails get the same answer and no email', async () => {
  const { app, inbox } = await appWithInbox();
  const res = await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: 'nobody@example.com' } });
  assert.equal(res.statusCode, 200);
  assert.equal(inbox.length, 0);
});

test('a code stops working after five wrong tries', async () => {
  const { app, code } = await appWithInbox();
  await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: 'ana@example.com' } });
  const right = code();
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const r = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { email: 'ana@example.com', code: wrong, password: 'whatever1' },
    });
    assert.equal(r.json().error.code, 'INVALID_CODE');
  }
  const late = await app.inject({
    method: 'POST',
    url: '/auth/password/reset',
    payload: { email: 'ana@example.com', code: right, password: 'whatever1' },
  });
  assert.equal(late.statusCode, 429, 'the route rate limit (5 per 15 min) also stops guessing');
});

test('without a mail server the feature says it is unavailable', async () => {
  const app = await makeApp({ mailer: null });
  const res = await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: 'ana@example.com' } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'RESET_UNAVAILABLE');
});
