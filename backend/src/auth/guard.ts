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
  const exists = db.prepare('SELECT 1 FROM accounts WHERE id = ?');
  return async (request: FastifyRequest) => {
    const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
    const id = match ? tokens.verify(match[1] as string) : null;
    if (id === null || !exists.get(id)) throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid token');
    request.accountId = id;
  };
}
