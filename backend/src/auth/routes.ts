import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { ApiError } from '../errors.ts';
import { checkPassword, dummyHash, hashPassword, sha256 } from './passwords.ts';

const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60_000;
// per IP, on top of the per-email lockout: slows down guessing across many emails
const RATE_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };

const credentials = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', maxLength: 254, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
    password: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

const signup = {
  ...credentials,
  required: [...credentials.required, 'name'],
  properties: { ...credentials.properties, name: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' } },
} as const;

interface Credentials {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance, { db, tokens }: Deps) {
  const findDevice = db.prepare('SELECT id, device_secret FROM accounts WHERE device_id = ?');
  const insertDevice = db.prepare('INSERT INTO accounts (device_id, device_secret, created_at) VALUES (?, ?, ?)');
  const findEmail = db.prepare('SELECT id, password_hash, name FROM accounts WHERE email = ?');
  const insertEmail = db.prepare('INSERT INTO accounts (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)');

  // In memory: resets on restart, which is fine for a single instance.
  const failures = new Map<string, { count: number; until: number }>();

  /** Anonymous account bound to a random id+secret the app generates once; it carries the translation quota. */
  app.post<{ Body: { deviceId: string; secret: string } }>(
    '/auth/device',
    {
      config: RATE_LIMIT,
      schema: {
        body: {
          type: 'object',
          required: ['deviceId', 'secret'],
          properties: {
            deviceId: { type: 'string', minLength: 8, maxLength: 100 },
            secret: { type: 'string', minLength: 32, maxLength: 200 },
          },
        },
      },
    },
    async (request) => {
      const { deviceId, secret } = request.body;
      const row = findDevice.get(deviceId) as { id: number; device_secret: string } | undefined;
      if (!row) {
        const { lastInsertRowid } = insertDevice.run(deviceId, sha256(secret), Date.now());
        return { success: true, data: { token: tokens.issue(Number(lastInsertRowid)) } };
      }
      if (!crypto.timingSafeEqual(Buffer.from(row.device_secret), Buffer.from(sha256(secret)))) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid device credentials');
      }
      return { success: true, data: { token: tokens.issue(row.id) } };
    },
  );

  app.post<{ Body: Credentials & { name: string } }>(
    '/auth/signup',
    { config: RATE_LIMIT, schema: { body: signup } },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const name = request.body.name.trim();
      const hash = await hashPassword(request.body.password);
      try {
        const { lastInsertRowid } = insertEmail.run(email, hash, name, Date.now());
        return reply.code(201).send({ success: true, data: { token: tokens.issue(Number(lastInsertRowid)), email, name } });
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new ApiError(409, 'EMAIL_TAKEN', 'Email already registered');
        throw e;
      }
    },
  );

  app.post<{ Body: Credentials }>('/auth/login', { config: RATE_LIMIT, schema: { body: credentials } }, async (request) => {
    const email = request.body.email.trim().toLowerCase();
    const failure = failures.get(email);
    if (failure && failure.count >= MAX_FAILURES && Date.now() < failure.until) {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts, try again later');
    }
    const row = findEmail.get(email) as { id: number; password_hash: string; name: string | null } | undefined;
    const ok = await checkPassword(row?.password_hash ?? (await dummyHash), request.body.password);
    if (!row || !ok) {
      if (!failure || Date.now() >= failure.until) failures.set(email, { count: 1, until: Date.now() + LOCK_MS });
      else failure.count++;
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    failures.delete(email);
    return { success: true, data: { token: tokens.issue(row.id), email, name: row.name } };
  });
}
