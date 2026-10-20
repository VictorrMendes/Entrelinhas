/**
 * Whose data this device holds. The library, words, marks and progress kept here belong to one email account: someone
 * else signing in on the same device must neither see them nor sync them into their own account.
 */

/** The bit of the browser's storage this needs (localStorage, or a stand-in in tests). */
type Keys = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The account's own records outside the database; the device's preferences (theme, reader font, voice) stay. */
const ACCOUNT_KEYS = ['lastSync', 'achievements', 'streakGoal', 'addedKits', 'kitDay', 'kitReleased', 'bestCombo', 'matchBest'];

/** Clears what is kept here for the account: the database, through [clearDb], and the account's keys. */
export async function forgetData(keys: Keys, clearDb: () => Promise<void>) {
  await clearDb();
  for (const k of [...ACCOUNT_KEYS, 'dataOwner']) keys.removeItem(k);
}

/** Before [email]'s first sync here: another account's data goes; the same account's, or data of no one yet, stays as [email]'s. */
export async function claimData(email: string, keys: Keys, clearDb: () => Promise<void>) {
  const owner = keys.getItem('dataOwner');
  if (owner !== null && owner.toLowerCase() !== email.toLowerCase()) await forgetData(keys, clearDb);
  keys.setItem('dataOwner', email);
}
