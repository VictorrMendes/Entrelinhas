import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Worker } from 'node:worker_threads';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../app.ts';
import { requireAccount, requireEmailAccount } from '../auth/guard.ts';
import { ApiError } from '../errors.ts';
import { createFileStore } from '../sync/files.ts';
import type { ParseJob, ParseResult } from './parse-worker.ts';
import type { Block, TocEntry } from './parser.ts';

/** Raise when the parser cuts books differently: the books read before are read again. */
const PARSER_VERSION = 1;
const PARSE_TIMEOUT_MS = 120_000;
const MAX_BLOCKS = 200;
const MAX_RESULTS = 200;
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
/** The app's search folding (web/src/text.ts): no case, no accents, the same length, so a match is found in the text too. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .normalize('NFC');

/**
 * The web app reads books through the server: it opens a book (read here once, from the file the account synced) and then
 * asks for its text a few pages at a time, with its pictures, so a phone's browser never holds a whole book.
 */
export async function bookRoutes(app: FastifyInstance, { config, db, tokens }: Deps) {
  const root = path.join(config.dataDir, 'books');
  const dirOf = (hash: string) => path.join(root, hash);
  const files = createFileStore({ config, db });
  const emailOnly = requireEmailAccount(db);

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
    if (!files.has(request.accountId, request.params.sha)) throw new ApiError(404, 'NOT_FOUND', 'Book not found');
    return request.params.sha;
  };
  const opened = async (hash: string) => {
    const book = await read(hash);
    if (!book) throw new ApiError(409, 'BOOK_NOT_OPEN', 'Open the book first');
    return book;
  };
  /** What the app needs to list and open a book, reading it the first time ([name] is its file name: it tells TXT apart). */
  async function open(accountId: number, hash: string, name: string) {
    const failed = unreadable.get(hash);
    if (failed) throw new ApiError(422, 'BOOK_UNREADABLE', failed);
    const book = (await read(hash)) ?? (await parse(accountId, hash, name));
    const { title, language, fileType, toc, cover } = book;
    return { title, language, fileType, toc, cover, blockCount: book.blocks.length };
  }

  app.addHook('preHandler', requireAccount(db, tokens));

  /**
   * Adds a Project Gutenberg book straight from gutenberg.org into the account's files, and opens it: the phone never
   * downloads the whole file. Each call downloads a book, so a few an hour per IP.
   */
  app.post<{ Params: { id: number } }>(
    '/books/gutenberg/:id',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1, maximum: 9_999_999 } } } },
    },
    async (request) => {
      emailOnly(request.accountId);
      const { id } = request.params;
      const unavailable = new ApiError(502, 'GUTENBERG_UNAVAILABLE', 'Project Gutenberg did not answer');
      const res = await fetch(`https://www.gutenberg.org/ebooks/${id}.epub3.images`, {
        headers: { 'user-agent': 'Entrelinhas (one book for a reader who asked for it)' },
        signal: AbortSignal.timeout(90_000),
      }).catch(() => {
        throw unavailable;
      });
      if (res.status === 404) throw new ApiError(404, 'NOT_FOUND', 'No such book on Project Gutenberg');
      if (!res.ok || !res.body) throw unavailable;
      const body = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
      const hash = await files.save(request.accountId, body, Number(res.headers.get('content-length') ?? 0));
      return { success: true, data: { sha: hash, ...(await open(request.accountId, hash, `gutenberg-${id}.epub`)) } };
    },
  );

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
      return { success: true, data: await open(request.accountId, hash, request.query.name ?? 'book.epub') };
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

  /** Where [q] is in the book, without case or accents: the first places, each with a bit of the text around it. */
  // ponytail: folds the whole book on every search (~35 ms for 3 MB of text); keep the folded text in memory if that shows
  app.get<{ Params: { sha: string }; Querystring: { q: string } }>(
    '/books/:sha/search',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        params: shaParams,
        querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 2, maxLength: 200 } } },
      },
    },
    async (request) => {
      const book = await opened(mine(request));
      const needle = fold(request.query.q.trim());
      const results: { block: number; snippet: string }[] = [];
      for (let i = 0; needle.length >= 2 && i < book.blocks.length && results.length < MAX_RESULTS; i++) {
        const { text } = book.blocks[i] as Block;
        const at = fold(text).indexOf(needle);
        if (at < 0) continue;
        const start = Math.max(0, at - 40);
        const end = Math.min(text.length, at + needle.length + 40);
        results.push({ block: i, snippet: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` });
      }
      return { success: true, data: { results } };
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
