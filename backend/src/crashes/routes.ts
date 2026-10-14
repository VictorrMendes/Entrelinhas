import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount } from '../auth/guard.ts';

const MAX_REPORT = 20_000;
const MAX_PER_DAY = 50;

export async function crashRoutes(app: FastifyInstance, { db, tokens }: Deps) {
  const countSince = db.prepare('SELECT COUNT(*) AS n FROM crashes WHERE account_id = ? AND created_at >= ?');
  const insert = db.prepare('INSERT INTO crashes (account_id, app_version, report, created_at) VALUES (?, ?, ?, ?)');

  app.addHook('preHandler', requireAccount(db, tokens));

  app.post<{ Body: { report: string; appVersion?: string } }>(
    '/crash',
    {
      schema: {
        body: {
          type: 'object',
          required: ['report'],
          properties: {
            report: { type: 'string', minLength: 1, maxLength: MAX_REPORT, pattern: '\\S' },
            appVersion: { type: 'string', minLength: 1, maxLength: 50 },
          },
        },
      },
    },
    async (request) => {
      const { report, appVersion } = request.body;
      // a crash loop must not fill the disk: past the daily cap reports are accepted and dropped
      if ((countSince.get(request.accountId, Date.now() - 24 * 3600_000) as { n: number }).n < MAX_PER_DAY) {
        insert.run(request.accountId, appVersion ?? null, report, Date.now());
        request.log.warn({ accountId: request.accountId, appVersion, crash: report.split('\n')[0] }, 'app crash');
      }
      return { success: true };
    },
  );
}
