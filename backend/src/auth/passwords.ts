import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scrypt(password, salt, 32)).toString('base64')}`;
}

export async function checkPassword(stored: string, password: string): Promise<boolean> {
  const [, salt = '', hash = ''] = stored.split('$');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), 32);
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Login with an unknown email still pays for one hash, so response time doesn't reveal which emails exist. */
export const dummyHash = hashPassword('dummy-password-for-timing');

/** Device secrets are 32+ random bytes from the app, so a plain sha256 is enough (no brute force to slow down). */
export const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
