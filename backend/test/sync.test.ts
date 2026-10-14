import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { bearer, deviceToken, makeApp } from './helpers.ts';

const sha256 = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const upload = (sha: string, body: Buffer, headers: object) => ({
  method: 'PUT' as const,
  url: `/sync/files/${sha}`,
  headers: { ...headers, 'content-type': 'application/octet-stream' },
  payload: body,
});

test('snapshot push rejects a stale version', async () => {
  const app = await makeApp();
  const h = bearer(await deviceToken(app, 'device-1'));
  assert.deepEqual((await app.inject({ url: '/sync/snapshot', headers: h })).json().data, { version: 0, snapshot: null });
  const first = await app.inject({ method: 'PUT', url: '/sync/snapshot', headers: h, payload: { version: 0, snapshot: { a: 1 } } });
  assert.equal(first.json().data.version, 1);
  const stale = await app.inject({ method: 'PUT', url: '/sync/snapshot', headers: h, payload: { version: 0, snapshot: { a: 2 } } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
  const next = await app.inject({ method: 'PUT', url: '/sync/snapshot', headers: h, payload: { version: 1, snapshot: { a: 2 } } });
  assert.equal(next.json().data.version, 2);
});

test('book files are stored by hash and isolated per account', async () => {
  const app = await makeApp();
  const h = bearer(await deviceToken(app, 'device-2'));
  const other = bearer(await deviceToken(app, 'device-3'));
  const data = Buffer.from('%PDF-1.4 fake book');
  const sha = sha256(data);

  const mismatch = await app.inject(upload('0'.repeat(64), data, h));
  assert.equal(mismatch.json().error.code, 'HASH_MISMATCH');
  assert.equal((await app.inject(upload(sha, data, h))).statusCode, 200);
  assert.equal((await app.inject(upload(sha, data, h))).statusCode, 200); // uploading again is harmless
  assert.deepEqual((await app.inject({ url: '/sync/files', headers: h })).json().data.files, [sha]);

  const download = await app.inject({ url: `/sync/files/${sha}`, headers: h });
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, data);
  assert.equal((await app.inject({ url: `/sync/files/${sha}`, headers: other })).statusCode, 404);

  assert.equal((await app.inject({ method: 'DELETE', url: `/sync/files/${sha}`, headers: h })).statusCode, 200);
  assert.deepEqual((await app.inject({ url: '/sync/files', headers: h })).json().data.files, []);
});

test('uploads beyond the account storage are refused', async () => {
  const app = await makeApp({ env: { MAX_ACCOUNT_BYTES: '10' } });
  const h = bearer(await deviceToken(app, 'device-4'));
  const data = Buffer.from('more than ten bytes of book');
  const res = await app.inject(upload(sha256(data), data, h));
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().error.code, 'STORAGE_FULL');
  assert.deepEqual((await app.inject({ url: '/sync/files', headers: h })).json().data.files, []);
});

test('crash reports need a token and a report', async () => {
  const app = await makeApp();
  assert.equal((await app.inject({ method: 'POST', url: '/crash', payload: { report: 'boom' } })).statusCode, 401);
  const h = bearer(await deviceToken(app, 'device-5'));
  assert.equal((await app.inject({ method: 'POST', url: '/crash', headers: h, payload: { report: '' } })).statusCode, 400);
  const ok = await app.inject({
    method: 'POST',
    url: '/crash',
    headers: h,
    payload: { report: 'IllegalStateException: boom\n\tat X', appVersion: '1.0' },
  });
  assert.equal(ok.statusCode, 200);
});

test('health answers and unknown routes keep the error shape', async () => {
  const app = await makeApp();
  assert.equal((await app.inject({ url: '/health' })).json().ok, true);
  const missing = await app.inject({ url: '/nope' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
});
