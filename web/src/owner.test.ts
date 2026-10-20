import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimData, forgetData } from './owner.ts';

/** localStorage as a Map, and a database that counts how often it was cleared. */
function device(entries: Record<string, string>) {
  const keys = new Map(Object.entries(entries));
  const storage = {
    getItem: (k: string) => keys.get(k) ?? null,
    setItem: (k: string, v: string) => void keys.set(k, v),
    removeItem: (k: string) => void keys.delete(k),
  };
  const cleared = { times: 0 };
  return { keys, storage, cleared, clearDb: async () => void cleared.times++ };
}

const used = { dataOwner: 'ana@example.com', lastSync: '1', achievements: 'first-book', addedKits: 'a1-1', theme: '2', readerPrefs: '{}', onboarded: '1' };

test('another email signing in clears the data here first, and keeps the device preferences', async () => {
  const d = device(used);
  await claimData('bia@example.com', d.storage, d.clearDb);
  assert.equal(d.cleared.times, 1);
  assert.deepEqual(Object.fromEntries(d.keys), { theme: '2', readerPrefs: '{}', onboarded: '1', dataOwner: 'bia@example.com' });
});

test('the same email signing in keeps everything, whatever the case', async () => {
  const d = device(used);
  await claimData('Ana@Example.com', d.storage, d.clearDb);
  assert.equal(d.cleared.times, 0);
  assert.equal(d.keys.get('lastSync'), '1');
  assert.equal(d.keys.get('achievements'), 'first-book');
});

test('data of no one yet (before the first sign-in) becomes the account’s', async () => {
  const d = device({ addedKits: 'a1-1' });
  await claimData('ana@example.com', d.storage, d.clearDb);
  assert.equal(d.cleared.times, 0);
  assert.deepEqual(Object.fromEntries(d.keys), { addedKits: 'a1-1', dataOwner: 'ana@example.com' });
});

test('forgetting clears the database and the account’s keys, owner included', async () => {
  const d = device(used);
  await forgetData(d.storage, d.clearDb);
  assert.equal(d.cleared.times, 1);
  assert.deepEqual(Object.fromEntries(d.keys), { theme: '2', readerPrefs: '{}', onboarded: '1' });
});
