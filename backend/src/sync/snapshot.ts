import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount } from '../auth/guard.ts';
import { ApiError } from '../errors.ts';

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

/**
 * The snapshot is opaque to the server (the app merges it); a version number makes concurrent pushes from two devices safe:
 * a push based on an old version gets 409 and the app pulls, merges and pushes again.
 */
export async function snapshotRoutes(app: FastifyInstance, { db, tokens }: Deps) {
  const find = db.prepare('SELECT version, data FROM snapshots WHERE account_id = ?');
  const save = db.prepare(
    'INSERT INTO snapshots (account_id, version, data, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (account_id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at',
  );

  app.addHook('preHandler', requireAccount(db, tokens));

  app.get('/sync/snapshot', async (request) => {
    const row = find.get(request.accountId) as { version: number; data: string } | undefined;
    return { success: true, data: { version: row?.version ?? 0, snapshot: row ? JSON.parse(row.data) : null } };
  });

  app.put<{ Body: { version: number; snapshot: object } }>(
    '/sync/snapshot',
    {
      bodyLimit: MAX_SNAPSHOT_BYTES,
      schema: {
        body: {
          type: 'object',
          required: ['version', 'snapshot'],
          properties: { version: { type: 'integer', minimum: 0 }, snapshot: { type: 'object' } },
        },
      },
    },
    async (request) => {
      const { version, snapshot } = request.body;
      const row = find.get(request.accountId) as { version: number } | undefined;
      if (version !== (row?.version ?? 0))
        throw new ApiError(409, 'VERSION_CONFLICT', 'Snapshot changed on the server, pull and merge first');
      save.run(request.accountId, version + 1, JSON.stringify(snapshot), Date.now());
      return { success: true, data: { version: version + 1 } };
    },
  );
}
