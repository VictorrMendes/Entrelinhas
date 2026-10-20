import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount, requireEmailAccount } from '../auth/guard.ts';
import { ApiError } from '../errors.ts';

const MAX_FILE_BYTES = 80 * 1024 * 1024; // same cap as the app's free-books downloads
const sha256Param = {
  type: 'object',
  required: ['sha'],
  properties: { sha: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
} as const;

/** Book files by account and hash. Uploads stream through the hash straight to disk: an 80 MB PDF never sits in memory. */
export function createFileStore({ config, db }: Pick<Deps, 'config' | 'db'>) {
  const root = path.join(config.dataDir, 'files');
  const fileOf = (accountId: number, sha: string) => path.join(root, String(accountId), sha);
  const find = db.prepare('SELECT size FROM files WHERE account_id = ? AND sha256 = ?');
  const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files WHERE account_id = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO files (account_id, sha256, size) VALUES (?, ?, ?)');

  return {
    fileOf,
    has: (accountId: number, sha: string) => !!find.get(accountId, sha),
    /** Saves [body] (up to [declared] bytes, if known) and returns its sha256, which must be [expected] when given. */
    async save(accountId: number, body: Readable, declared: number, expected?: string): Promise<string> {
      const quota = config.maxAccountBytes - (used.get(accountId) as { n: number }).n;
      if (declared > MAX_FILE_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', `Files up to ${MAX_FILE_BYTES} bytes`);
      if (declared > quota) throw new ApiError(413, 'STORAGE_FULL', 'Cloud storage limit reached');

      const dir = path.join(root, String(accountId));
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `.upload-${crypto.randomUUID()}`);
      const hash = crypto.createHash('sha256');
      let size = 0;
      try {
        await pipeline(
          body,
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              size += chunk.length;
              if (size > Math.min(MAX_FILE_BYTES, quota)) {
                callback(
                  size > MAX_FILE_BYTES
                    ? new ApiError(413, 'FILE_TOO_LARGE', 'File too large')
                    : new ApiError(413, 'STORAGE_FULL', 'Cloud storage limit reached'),
                );
                return;
              }
              hash.update(chunk);
              callback(null, chunk);
            },
          }),
          fs.createWriteStream(tmp),
        );
        if (size === 0) throw new ApiError(400, 'INVALID_REQUEST', 'File body is required');
        const sha = hash.digest('hex');
        if (expected && sha !== expected) throw new ApiError(400, 'HASH_MISMATCH', 'Body does not match the sha256 in the path');
        if (!find.get(accountId, sha)) {
          await fs.promises.rename(tmp, fileOf(accountId, sha));
          insert.run(accountId, sha, size);
        }
        return sha;
      } finally {
        await fs.promises.rm(tmp, { force: true });
      }
    },
  };
}

export async function fileRoutes(app: FastifyInstance, { config, db, tokens }: Deps) {
  const files = createFileStore({ config, db });
  const emailOnly = requireEmailAccount(db);
  const list = db.prepare('SELECT sha256 FROM files WHERE account_id = ?');
  const remove = db.prepare('DELETE FROM files WHERE account_id = ? AND sha256 = ?');
  const anyOwner = db.prepare('SELECT 1 FROM files WHERE sha256 = ?');

  // the body reaches the handler as the raw request stream instead of being buffered
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
  app.addHook('preHandler', requireAccount(db, tokens));

  app.get('/sync/files', async (request) => ({
    success: true,
    data: { files: (list.all(request.accountId) as { sha256: string }[]).map((r) => r.sha256) },
  }));

  app.get<{ Params: { sha: string } }>('/sync/files/:sha', { schema: { params: sha256Param } }, async (request, reply) => {
    const { sha } = request.params;
    if (!files.has(request.accountId, sha)) throw new ApiError(404, 'NOT_FOUND', 'File not found');
    return reply.type('application/octet-stream').send(fs.createReadStream(files.fileOf(request.accountId, sha)));
  });

  app.delete<{ Params: { sha: string } }>('/sync/files/:sha', { schema: { params: sha256Param } }, async (request) => {
    remove.run(request.accountId, request.params.sha);
    await fs.promises.rm(files.fileOf(request.accountId, request.params.sha), { force: true });
    // the book as the server read it (books/routes.ts) goes with the last account that had the file
    if (!anyOwner.get(request.params.sha))
      await fs.promises.rm(path.join(config.dataDir, 'books', request.params.sha), { recursive: true, force: true });
    return { success: true };
  });

  app.put<{ Params: { sha: string } }>('/sync/files/:sha', { schema: { params: sha256Param } }, async (request) => {
    emailOnly(request.accountId);
    const body = request.body as Readable | undefined;
    if (!body || !request.headers['content-type']?.startsWith('application/octet-stream')) {
      throw new ApiError(415, 'INVALID_REQUEST', 'Send the file as application/octet-stream');
    }
    await files.save(request.accountId, body, Number(request.headers['content-length'] ?? 0), request.params.sha);
    return { success: true };
  });
}
