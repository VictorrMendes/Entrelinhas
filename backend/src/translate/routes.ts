import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount } from '../auth/guard.ts';
import { ApiError } from '../errors.ts';
import { batchPrompt, batchSchema, singlePrompt, wordInContextPrompt } from './prompts.ts';

const MAX_TEXT = 4000;
const MAX_CONTEXT = 1000;
const MAX_ITEMS = 20;
const MAX_BATCH_CHARS = 12_000;

const lang = { type: 'string', pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' } as const;
const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max, pattern: '\\S' }) as const;

interface Single {
  text: string;
  sourceLang: string;
  targetLang: string;
  /** The sentence the word was taken from: the answer is the word's meaning there. */
  context?: string;
}

interface Batch {
  sourceLanguage?: string;
  targetLanguage: string;
  items: { blockId: string; text: string }[];
}

export async function translateRoutes(app: FastifyInstance, { config, db, tokens, gemini }: Deps) {
  const usedToday = db.prepare('SELECT used FROM usage WHERE account_id = ? AND day = ?');
  const addUsage = db.prepare(
    'INSERT INTO usage (account_id, day, used) VALUES (?, ?, ?) ON CONFLICT (account_id, day) DO UPDATE SET used = used + excluded.used',
  );

  const charge = (accountId: number, chars: number) => {
    const day = new Date().toISOString().slice(0, 10);
    const used = (usedToday.get(accountId, day) as { used: number } | undefined)?.used ?? 0;
    if (used + chars > config.dailyCharLimit) throw new ApiError(429, 'LIMIT_EXCEEDED', 'Daily online translation limit reached');
    addUsage.run(accountId, day, chars);
  };

  const callModel: typeof gemini = async (...args) => {
    try {
      return await gemini(...args);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(502, 'TRANSLATION_FAILED', 'Translation failed');
    }
  };

  app.addHook('preHandler', requireAccount(db, tokens));

  app.post<{ Body: Single }>(
    '/translate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text', 'sourceLang', 'targetLang'],
          properties: { text: text(MAX_TEXT), sourceLang: lang, targetLang: lang, context: text(MAX_CONTEXT) },
        },
      },
    },
    async (request) => {
      const { text, sourceLang, targetLang, context } = request.body;
      charge(request.accountId, text.length + (context?.length ?? 0));
      const prompt = context ? wordInContextPrompt(sourceLang, targetLang, context, text) : singlePrompt(sourceLang, targetLang);
      const r = await callModel(prompt, text);
      return { success: true, data: { translatedText: r.text.trim(), model: config.geminiModel }, usage: r.usage };
    },
  );

  app.post<{ Body: Batch }>(
    '/translate/batch',
    {
      config: { invalidCode: 'INVALID_BATCH_REQUEST' },
      schema: {
        body: {
          type: 'object',
          required: ['targetLanguage', 'items'],
          properties: {
            sourceLanguage: lang,
            targetLanguage: lang,
            items: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_ITEMS,
              items: { type: 'object', required: ['blockId', 'text'], properties: { blockId: text(100), text: text(MAX_TEXT) } },
            },
          },
        },
      },
    },
    async (request) => {
      const { sourceLanguage, targetLanguage, items } = request.body;
      const chars = items.reduce((n, i) => n + i.text.length, 0);
      if (chars > MAX_BATCH_CHARS) throw new ApiError(400, 'INVALID_BATCH_REQUEST', `Up to ${MAX_BATCH_CHARS} characters per batch`);
      charge(request.accountId, chars);

      const input = JSON.stringify(items.map(({ blockId, text }) => ({ blockId, text })));
      const r = await callModel(batchPrompt(sourceLanguage, targetLanguage), input, batchSchema);
      let out: unknown;
      try {
        out = JSON.parse(r.text);
      } catch {
        throw new ApiError(502, 'TRANSLATION_FAILED', 'Model returned invalid JSON');
      }
      if (!Array.isArray(out)) throw new ApiError(502, 'TRANSLATION_FAILED', 'Model returned an unexpected shape');
      const byId = new Map(
        out.map((o: { blockId?: unknown; translatedText?: unknown }) => [String(o?.blockId), String(o?.translatedText ?? '')]),
      );
      // ids the model invented are dropped; ids it skipped are simply missing and the app retries them
      const data = items.filter((i) => byId.has(i.blockId)).map((i) => ({ blockId: i.blockId, translatedText: byId.get(i.blockId) }));
      return { success: true, data: { items: data, model: config.geminiModel }, usage: r.usage };
    },
  );
}
