import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount } from '../auth/guard.ts';
import { ApiError } from '../errors.ts';
import type { ParseJob, ParseResult } from './parse-worker.ts';
import type { Block, TocEntry } from './parser.ts';

/** Raise when the parser cuts books differently: the books read before are read again. */
const PARSER_VERSION = 1;
const PARSE_TIMEOUT_MS = 120_000;
const MAX_BLOCKS = 200;
/** Books whose text stays in memory for the next pages (a long novel is a few MB). */
const KEEP_IN_MEMORY = 8;

interface Parsed {
  version: number;
  title: string;
  language: string;
  fileType: string;
  toc: TocEntry[];
  blocks: Block[];
  cover: boolean;
}

const sha = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const shaParams = { type: 'object', required: ['sha'], properties: { sha } } as const;
const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};
const imageType = (bytes: Buffer) => (bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0x47 ? 'image/gif' : 'image/jpeg');

/**
 * The web app reads books through the server: it opens a book (read here once, from the file the account synced) and then
 * asks for its text a few pages at a time, with its pictures, so a phone's browser never holds a whole book.
 */
export async function bookRoutes(app: FastifyInstance, { config, db, tokens }: Deps) {
  const root = path.join(config.dataDir, 'books');
  const dirOf = (hash: string) => path.join(root, hash);
  const owns = db.prepare('SELECT 1 FROM files WHERE account_id = ? AND sha256 = ?');

  const memory = new Map<string, Parsed>();
  const parsing = new Map<string, Promise<Parsed>>();
  // In memory, reset on restart: a file that can't be read isn't read again on every open
  const unreadable = new Map<string, string>();
  // one book at a time: the server is a laptop, and a PDF keeps a core busy for seconds
  let queue: Promise<unknown> = Promise.resolve();

  const remember = (hash: string, book: Parsed) => {
    memory.delete(hash);
    memory.set(hash, book);
    if (memory.size > KEEP_IN_MEMORY) memory.delete(memory.keys().next().value as string);
    return book;
  };

  async function read(hash: string): Promise<Parsed | null> {
    const kept = memory.get(hash);
    if (kept) return remember(hash, kept);
    const raw = await fs.promises.readFile(path.join(dirOf(hash), 'book.json'), 'utf8').catch(() => null);
    const book = raw ? (JSON.parse(raw) as Parsed) : null;
    return book && book.version === PARSER_VERSION ? remember(hash, book) : null;
  }

  function parse(accountId: number, hash: string, fileName: string): Promise<Parsed> {
    const running = parsing.get(hash);
    if (running) return running;
    const job: ParseJob = {
      file: path.join(config.dataDir, 'files', String(accountId), hash),
      fileName,
      dir: dirOf(hash),
      version: PARSER_VERSION,
    };
    const run = queue.then(
      () =>
        new Promise<ParseResult>((resolve) => {
          const worker = new Worker(new URL('./parse-worker.ts', import.meta.url), { workerData: job });
          const timer = setTimeout(() => {
            resolve({ ok: false, unreadable: true, message: 'Este livro demorou demais para abrir.' });
            worker.terminate();
          }, PARSE_TIMEOUT_MS);
          const finish = (result: ParseResult) => {
            clearTimeout(timer);
            resolve(result);
          };
          worker.once('message', finish);
          worker.once('error', (e) => finish({ ok: false, unreadable: false, message: e.message }));
          worker.once('exit', (code) => finish({ ok: false, unreadable: false, message: `the parser stopped (${code})` }));
        }),
    );
    queue = run;
    const book = run
      .then(async (result) => {
        if (!result.ok && result.unreadable) unreadable.set(hash, result.message);
        if (!result.ok) throw result.unreadable ? new ApiError(422, 'BOOK_UNREADABLE', result.message) : new Error(result.message);
        const parsed = await read(hash);
        if (!parsed) throw new Error('the parsed book is missing');
        return parsed;
      })
      .finally(() => parsing.delete(hash));
    parsing.set(hash, book);
    return book;
  }

  /** Every book route answers only for an account that synced that file. */
  const mine = (request: FastifyRequest<{ Params: { sha: string } }>) => {
    if (!owns.get(request.accountId, request.params.sha)) throw new ApiError(404, 'NOT_FOUND', 'Book not found');
    return request.params.sha;
  };
  const opened = async (hash: string) => {
    const book = await read(hash);
    if (!book) throw new ApiError(409, 'BOOK_NOT_OPEN', 'Open the book first');
    return book;
  };

  app.addHook('preHandler', requireAccount(db, tokens));

  /** Opens a book (reading it the first time; [name] is its file name, which tells TXT apart). */
  app.get<{ Params: { sha: string }; Querystring: { name?: string } }>(
    '/books/:sha',
    {
      schema: {
        params: shaParams,
        querystring: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 200 } } },
      },
    },
    async (request) => {
      const hash = mine(request);
      const failed = unreadable.get(hash);
      if (failed) throw new ApiError(422, 'BOOK_UNREADABLE', failed);
      const book = (await read(hash)) ?? (await parse(request.accountId, hash, request.query.name ?? 'book.epub'));
      const { title, language, fileType, toc, cover } = book;
      return { success: true, data: { title, language, fileType, toc, cover, blockCount: book.blocks.length } };
    },
  );

  app.get<{ Params: { sha: string }; Querystring: { from: number; count: number } }>(
    '/books/:sha/blocks',
    {
      schema: {
        params: shaParams,
        querystring: {
          type: 'object',
          required: ['from', 'count'],
          properties: { from: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, maximum: MAX_BLOCKS } },
        },
      },
    },
    async (request) => {
      const { from, count } = request.query;
      const book = await opened(mine(request));
      return { success: true, data: { from, blocks: book.blocks.slice(from, from + count) } };
    },
  );

  app.get<{ Params: { sha: string; name: string } }>(
    '/books/:sha/images/:name',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sha', 'name'],
          properties: { sha, name: { type: 'string', pattern: '^\\d+\\.(jpe?g|png|gif|webp|bmp)$' } },
        },
      },
    },
    async (request, reply) => {
      const hash = mine(request);
      const bytes = await fs.promises.readFile(path.join(dirOf(hash), 'images', request.params.name)).catch(() => null);
      if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Image not found');
      const type = IMAGE_TYPES[request.params.name.split('.').pop() as string] as string;
      // the same name in the same book is always the same picture
      return reply.type(type).header('cache-control', 'private, max-age=31536000, immutable').send(bytes);
    },
  );

  app.get<{ Params: { sha: string } }>('/books/:sha/cover', { schema: { params: shaParams } }, async (request, reply) => {
    const bytes = await fs.promises.readFile(path.join(dirOf(mine(request)), 'cover')).catch(() => null);
    if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'This book has no cover');
    return reply.type(imageType(bytes)).header('cache-control', 'private, max-age=31536000, immutable').send(bytes);
  });
}
