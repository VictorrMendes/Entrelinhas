import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, deviceToken, makeApp } from './helpers.ts';

test('device login returns the same account and checks the secret', async () => {
  const app = await makeApp();
  const first = bearer(await deviceToken(app, 'device-1'));
  await app.inject({ method: 'PUT', url: '/sync/snapshot', headers: first, payload: { version: 0, snapshot: { words: ['x'] } } });
  const again = bearer(await deviceToken(app, 'device-1'));
  assert.deepEqual((await app.inject({ url: '/sync/snapshot', headers: again })).json().data.snapshot, { words: ['x'] });
  const wrong = await app.inject({ method: 'POST', url: '/auth/device', payload: { deviceId: 'device-1', secret: 'y'.repeat(40) } });
  assert.equal(wrong.statusCode, 401);
});

test('a tampered or missing token is refused', async () => {
  const app = await makeApp();
  const token = await deviceToken(app, 'device-2');
  const [head, , sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: '1', exp: 9999999999 })).toString('base64url');
  assert.equal((await app.inject({ url: '/sync/snapshot', headers: bearer(`${head}.${forged}.${sig}`) })).statusCode, 401);
  const missing = await app.inject({ url: '/sync/snapshot' });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().error.code, 'UNAUTHORIZED');
});

test('signup, duplicate email, login and wrong password', async () => {
  const app = await makeApp();
  const signup = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: 'Ana@Example.com', password: 'correct horse', name: '  Ana  ' },
  });
  assert.equal(signup.statusCode, 201);
  assert.equal(signup.json().data.email, 'ana@example.com');
  assert.equal(signup.json().data.name, 'Ana');
  const duplicate = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: 'ana@example.com', password: 'correct horse', name: 'Outra' },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'EMAIL_TAKEN');
  const short = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: 'b@example.com', password: 'short', name: 'B' },
  });
  assert.equal(short.json().error.code, 'INVALID_REQUEST');
  for (const name of [undefined, '   ', 'x'.repeat(41)]) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'c@example.com', password: 'long enough', name },
    });
    assert.equal(res.json().error.code, 'INVALID_REQUEST', `name ${JSON.stringify(name)}`);
  }

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@example.com', password: 'correct horse' } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().data.name, 'Ana');
  assert.equal((await app.inject({ url: '/sync/snapshot', headers: bearer(login.json().data.token) })).statusCode, 200);

  const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@example.com', password: 'wrong password' } });
  const unknown = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'nobody@example.com', password: 'wrong password' },
  });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.json(), unknown.json()); // same answer whether or not the email exists
});

test('locks an email after repeated wrong passwords', async () => {
  const app = await makeApp();
  await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: 'lock@example.com', password: 'right password', name: 'Lock' },
  });
  for (let i = 0; i < 10; i++) {
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'lock@example.com', password: 'bad password' } });
  }
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'lock@example.com', password: 'right password' } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, 'TOO_MANY_ATTEMPTS');
});

test('auth routes are rate limited per IP', async () => {
  const app = await makeApp();
  const codes = [];
  for (let i = 0; i < 21; i++) {
    codes.push(
      (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: `u${i}@example.com`, password: 'whatever1' } })).statusCode,
    );
  }
  assert.equal(codes.at(-1), 429);
});
