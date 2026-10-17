import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount } from '../auth/guard.ts';
import { ApiError } from '../errors.ts';
import { withFallback } from './nvidia.ts';
import { batchPrompt, batchSchema, explainPrompt, gradePrompt, levelPrompt, singlePrompt, wordInContextPrompt } from './prompts.ts';

const MAX_TEXT = 4000;
const MAX_CONTEXT = 1000;
const MAX_WORD = 200;
/** A typed vocabulary answer longer than this many words isn't graded by the model: it can't be right and may be a prompt. */
const MAX_ANSWER_WORDS = 6;
/**
 * Words about the grading itself. Measured: flash-lite accepted "correct" and sometimes "ACCEPT" as answers; a learner
 * never types them as a translation unless the word studied is one of them.
 */
const META_ANSWERS = new Set([
  'yes',
  'no',
  'ok',
  'okay',
  'true',
  'false',
  'correct',
  'right',
  'wrong',
  'accept',
  'accepted',
  'reject',
  'sim',
  'não',
  'nao',
  'certo',
  'correto',
  'errado',
  'verdadeiro',
  'falso',
]);
const MAX_ITEMS = 20;
const MAX_BATCH_CHARS = 12_000;
const MAX_SAMPLE = 6000;

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

interface Explain {
  text: string;
  sentence: string;
  sourceLang: string;
  targetLang: string;
}

/** A written practice answer the app's strict check refused; the model decides whether it still means the same. */
interface Grade {
  expected: string;
  meaning: string;
  answer: string;
  sourceLang: string;
  targetLang: string;
}

export async function translateRoutes(app: FastifyInstance, { config, db, tokens, gemini, nvidia }: Deps) {
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

  const guarded =
    (model: typeof gemini): typeof gemini =>
    async (...args) => {
      try {
        return await model(...args);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(502, 'TRANSLATION_FAILED', 'Translation failed');
      }
    };
  const callModel = guarded(gemini);
  // a learner waits for an explanation, so the fast model answers first; book levels are background work, so NVIDIA takes them
  const teacher = guarded(withFallback(gemini, nvidia));
  const assessor = guarded(withFallback(nvidia, gemini));

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

  app.post<{ Body: Explain }>(
    '/explain',
    {
      schema: {
        body: {
          type: 'object',
          required: ['text', 'sentence', 'sourceLang', 'targetLang'],
          properties: { text: text(MAX_CONTEXT), sentence: text(MAX_CONTEXT), sourceLang: lang, targetLang: lang },
        },
      },
    },
    async (request) => {
      const { text, sentence, sourceLang, targetLang } = request.body;
      charge(request.accountId, text.length + sentence.length);
      const r = await teacher(explainPrompt(sourceLang, targetLang, sentence), text);
      return { success: true, data: { explanation: r.text.trim() }, usage: r.usage };
    },
  );

  app.post<{ Body: Grade }>(
    '/grade',
    {
      schema: {
        body: {
          type: 'object',
          required: ['expected', 'meaning', 'answer', 'sourceLang', 'targetLang'],
          properties: { expected: text(MAX_WORD), meaning: text(MAX_WORD), answer: text(MAX_WORD), sourceLang: lang, targetLang: lang },
        },
      },
    },
    async (request) => {
      const { expected, meaning, answer, sourceLang, targetLang } = request.body;
      const plain = (s: string) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\s]/gu, '');
      const meta = META_ANSWERS.has(plain(answer)) && !META_ANSWERS.has(plain(expected));
      if (meta || answer.trim().split(/\s+/).length > Math.max(MAX_ANSWER_WORDS, expected.trim().split(/\s+/).length + 3)) {
        return { success: true, data: { correct: false, note: '' } };
      }
      charge(request.accountId, expected.length + meaning.length + answer.length);
      const r = await teacher(gradePrompt(sourceLang, targetLang, meaning, answer.trim()), 'Grade the answer.');
      // the last verdict and note win: the model sometimes corrects itself halfway through its reply
      const verdict = [...r.text.matchAll(/VERDICT\W*(ACCEPT|REJECT)/gi)].at(-1)?.[1]?.toUpperCase();
      if (!verdict) throw new ApiError(502, 'TRANSLATION_FAILED', 'Model did not grade the answer');
      const note = [...r.text.matchAll(/NOTE\s*:?\s*(.+)/gi)].at(-1)?.[1]?.trim() ?? '';
      return { success: true, data: { correct: verdict === 'ACCEPT', note }, usage: r.usage };
    },
  );

  app.post<{ Body: { sample: string; language: string } }>(
    '/level',
    { schema: { body: { type: 'object', required: ['sample', 'language'], properties: { sample: text(MAX_SAMPLE), language: lang } } } },
    async (request) => {
      charge(request.accountId, request.body.sample.length);
      const r = await assessor(levelPrompt(request.body.language), request.body.sample);
      const level = /\b([ABC][12])\b/.exec(r.text.toUpperCase())?.[1];
      if (!level) throw new ApiError(502, 'TRANSLATION_FAILED', 'Model did not answer with a level');
      return { success: true, data: { level } };
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
