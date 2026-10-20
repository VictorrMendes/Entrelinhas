/**
 * Books are read on the server (backend/src/books): this app keeps each book's place, marks and cover, the server its file
 * and text, which the reader asks for a few pages at a time. Adding a book takes an email account, whose files it joins.
 */
import { ApiError, getBlob, getJson, post, putBytes } from './api';
import type { Block, TocEntry } from './blocks';
import { type Book, db, sha256Hex, transact } from './store';

/** What the server tells about a book it read. */
export interface RemoteBook {
  title: string;
  language: string;
  fileType: string;
  toc: TocEntry[];
  cover: boolean;
  blockCount: number;
}

/** Opens a book on the server, which reads it the first time; [name] is the file name (it tells TXT apart). */
export const openBook = (hash: string, name?: string) => getJson<RemoteBook>(`/books/${hash}${name ? `?name=${encodeURIComponent(name)}` : ''}`);

export const bookBlocks = async (hash: string, from: number, count: number) =>
  (await getJson<{ blocks: Block[] }>(`/books/${hash}/blocks?from=${from}&count=${count}`)).blocks;

export const bookImage = (hash: string, name: string) => getBlob(`/books/${hash}/images/${encodeURIComponent(name)}`);

/** Up to 200 places in a book where [q] is, without case or accents, each with a bit of the text around it. */
export const searchBook = async (hash: string, q: string) =>
  (await getJson<{ results: { block: number; snippet: string }[] }>(`/books/${hash}/search?q=${encodeURIComponent(q)}`)).results;

const bookWith = async (hash: string) => (await db.all<Book>('books')).find((b) => b.hash === hash);

/** The library's record for a book the server read, with its cover; [hash] is the file's sha256, as the Android app knows it. */
export async function keepBook(hash: string, meta: RemoteBook, fields: Partial<Book> = {}): Promise<Book> {
  const now = Date.now();
  const book: Book = {
    title: meta.title,
    language: meta.language,
    blockCount: meta.blockCount,
    lastBlock: 0,
    addedAt: now,
    updatedAt: now,
    toc: meta.toc,
    hash,
    fileType: meta.fileType,
    ...fields,
  };
  const cover = meta.cover ? await getBlob(`/books/${hash}/cover`).catch(() => null) : null;
  let id = 0;
  // the book shows up with its cover, in one go
  await transact(['books', 'covers'], (tx) => {
    const added = tx.objectStore('books').put(book);
    added.onsuccess = () => {
      id = added.result as number;
      if (cover) tx.objectStore('covers').put(cover, id);
    };
  });
  return { ...book, id };
}

/** A book file from this device: up to the account's files, then read by the server. [before]: it was already here. */
export async function addFile(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<{ book: Book; before: boolean }> {
  const hash = await sha256Hex(bytes);
  const before = await bookWith(hash);
  if (before) return { book: before, before: true };
  await putBytes(`/sync/files/${hash}`, bytes);
  return { book: await keepBook(hash, await openBook(hash, name)), before: false };
}

/** A Project Gutenberg book, which the server downloads itself: the phone never holds the file. */
export async function addGutenberg(id: number): Promise<{ book: Book; before: boolean }> {
  const { sha, ...meta } = await post<RemoteBook & { sha: string }>(`/books/gutenberg/${id}`, {});
  const before = await bookWith(sha);
  return before ? { book: before, before: true } : { book: await keepBook(sha, meta), before: false };
}

/** Words for the reader about what went wrong with a book. */
export function bookErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : 'Não consegui abrir este livro.';
  if (e.code === 'BOOK_UNREADABLE' && e.detail) return e.detail;
  if (e.code === 'NO_CONNECTION') return 'Sem conexão com o servidor. Verifique a internet.';
  if (e.code === 'ACCOUNT_REQUIRED' || e.code === 'SESSION_EXPIRED') return 'Entre na sua conta para continuar.';
  if (e.code === 'STORAGE_FULL') return 'O espaço da sua conta na nuvem acabou.';
  if (e.code === 'FILE_TOO_LARGE') return 'Este livro é grande demais (mais de 80 MB).';
  if (e.code === 'GUTENBERG_UNAVAILABLE') return 'O Project Gutenberg não respondeu. Tente de novo em instantes.';
  if (e.code === 'NOT_FOUND') return 'Este livro não está na sua conta.';
  if (e.code === 'TOO_MANY_REQUESTS') return 'Muitos livros seguidos. Tente de novo daqui a pouco.';
  return 'Não consegui abrir este livro.';
}
