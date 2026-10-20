/**
 * Reads one book in a worker thread, so a big PDF never holds up the API's other requests, and writes what the reader asks
 * for into its folder: book.json (text and table of contents), images/ and cover. Written to a temporary folder and renamed,
 * so a reader never sees half a book.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { type ParsedBook, parseBook } from './parser.ts';

export interface ParseJob {
  file: string;
  fileName: string;
  dir: string;
  version: number;
}

/** `unreadable`: the book itself can't be read, and `message` says why in words for the reader. */
export type ParseResult = { ok: true } | { ok: false; unreadable: boolean; message: string };

const { file, fileName, dir, version } = workerData as ParseJob;
const done = (result: ParseResult) => parentPort?.postMessage(result);

let book: ParsedBook | undefined;
try {
  book = await parseBook(fileName, new Uint8Array(await fs.readFile(file)));
} catch (e) {
  done({ ok: false, unreadable: true, message: e instanceof Error ? e.message : 'Não consegui abrir este livro.' });
}
if (book) {
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(path.join(tmp, 'images'), { recursive: true });
    for (const [name, bytes] of Object.entries(book.images)) await fs.writeFile(path.join(tmp, 'images', name), bytes);
    if (book.cover) await fs.writeFile(path.join(tmp, 'cover'), book.cover);
    const { title, language, fileType, toc, blocks } = book;
    await fs.writeFile(
      path.join(tmp, 'book.json'),
      JSON.stringify({ version, title, language, fileType, toc, blocks, cover: !!book.cover }),
    );
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(tmp, dir);
    done({ ok: true });
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    done({ ok: false, unreadable: false, message: e instanceof Error ? e.message : String(e) });
  }
}
