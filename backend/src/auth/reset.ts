import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { ApiError } from '../errors.ts';
import { hashPassword, sha256 } from './passwords.ts';

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT = { rateLimit: { max: 5, timeWindow: '15 minutes' } };

const email = { type: 'string', maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' } as const;

/**
 * "Forgot my password" with a 6-digit code sent by email and typed in the app, so no web page is needed. The forgot route
 * answers the same whether the email exists or not; a code is single-use, expires and allows a few attempts.
 */
export async function resetRoutes(app: FastifyInstance, { db, tokens, mailer }: Deps) {
  const findAccount = db.prepare('SELECT id, name FROM accounts WHERE email = ?');
  const saveCode = db.prepare(
    'INSERT INTO password_resets (account_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ' +
      'ON CONFLICT (account_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0',
  );
  const findCode = db.prepare('SELECT code_hash, expires_at, attempts FROM password_resets WHERE account_id = ?');
  const countAttempt = db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE account_id = ?');
  const dropCode = db.prepare('DELETE FROM password_resets WHERE account_id = ?');
  const setPassword = db.prepare('UPDATE accounts SET password_hash = ?, password_changed_at = ? WHERE id = ?');
  const codeHash = (accountId: number, code: string) => sha256(`${accountId}:${code}`);

  app.post<{ Body: { email: string } }>(
    '/auth/password/forgot',
    { config: RATE_LIMIT, schema: { body: { type: 'object', required: ['email'], properties: { email } } } },
    async (request) => {
      if (!mailer) throw new ApiError(503, 'RESET_UNAVAILABLE', 'Password reset is not configured on this server');
      const address = request.body.email.trim().toLowerCase();
      const account = findAccount.get(address) as { id: number; name: string | null } | undefined;
      if (account) {
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        saveCode.run(account.id, codeHash(account.id, code), Date.now() + CODE_TTL_MS);
        const hello = account.name ? `Olá, ${account.name}!` : 'Olá!';
        await mailer(
          address,
          'Seu código do Entrelinhas',
          `${hello}\n\nSeu código para criar uma nova senha é ${code}.\nEle vale por 15 minutos.\n\n` +
            'Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.',
        );
      }
      return { success: true };
    },
  );

  app.post<{ Body: { email: string; code: string; password: string } }>(
    '/auth/password/reset',
    {
      config: RATE_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'code', 'password'],
          properties: { email, code: { type: 'string', pattern: '^\\d{6}$' }, password: { type: 'string', minLength: 8, maxLength: 128 } },
        },
      },
    },
    async (request) => {
      const address = request.body.email.trim().toLowerCase();
      const account = findAccount.get(address) as { id: number; name: string | null } | undefined;
      const pending = account && (findCode.get(account.id) as { code_hash: string; expires_at: number; attempts: number } | undefined);
      const invalid = new ApiError(400, 'INVALID_CODE', 'Invalid or expired code');
      if (!account || !pending || pending.expires_at < Date.now() || pending.attempts >= MAX_ATTEMPTS) throw invalid;
      const given = Buffer.from(codeHash(account.id, request.body.code));
      if (!crypto.timingSafeEqual(given, Buffer.from(pending.code_hash))) {
        countAttempt.run(account.id);
        throw invalid;
      }
      dropCode.run(account.id);
      setPassword.run(await hashPassword(request.body.password), Math.floor(Date.now() / 1000), account.id);
      return { success: true, data: { token: tokens.issue(account.id), email: address, name: account.name } };
    },
  );
}
