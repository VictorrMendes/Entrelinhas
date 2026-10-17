import type { DatabaseSync } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors.ts';
import type { Tokens } from './tokens.ts';

declare module 'fastify' {
  interface FastifyRequest {
    accountId: number;
  }
}

export function requireAccount(db: DatabaseSync, tokens: Tokens) {
  const find = db.prepare('SELECT password_changed_at AS changed FROM accounts WHERE id = ?');
  return async (request: FastifyRequest) => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
    const token = match ? tokens.verify(match[1] as string) : null;
    const account = token && (find.get(token.account) as { changed: number | null } | undefined);
    // a password change signs out every session opened before it
    if (!token || !account || (account.changed !== null && token.issuedAt < account.changed)) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid token');
    }
    request.accountId = token.account;
  };
}
