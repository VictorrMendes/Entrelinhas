/** Backup and sync with the Android app through the backend, step for step like Sync.kt's syncNow. */
import { useEffect, useState } from 'react';
import { account, ApiError, del, getJson, putBytes, putJson } from './api';
import { notify } from './notices';
import { keepBook, openBook } from './remote';
import { type Book, type Day, db, deleteBook, type Highlight, transact, type Word } from './store';
import { emptySnapshot, fromJson, highlightKey, merge, type Snapshot, wordKey } from './sync';

async function deletions(): Promise<Map<string, number>> {
  const [keys, values] = await Promise.all([db.keys('deletions'), db.all<number>('deletions')]);
  return new Map(keys.map((k, i) => [String(k), values[i]]));
}

/** Books added before content hashes existed have no identity across devices, so they stay local. */
async function exportSnapshot(): Promise<Snapshot> {
  const [books, words, highlights, days, deleted] = await Promise.all([
    db.all<Book>('books'),
    db.all<Word>('words'),
    db.all<Highlight>('highlights'),
    db.all<Day>('days'),
    deletions(),
  ]);
  const hashOf = new Map(books.flatMap((b) => (b.hash ? [[b.id, b.hash]] : [])));
  return {
    books: books.flatMap((b) =>
      b.hash
        ? [
            {
              hash: b.hash,
              title: b.title,
              fileType: b.fileType ?? 'epub',
              language: b.language || null,
              targetLanguage: b.target ?? null,
              lastBlock: b.lastBlock,
              lastOpenedAt: b.lastOpenedAt ?? null,
              completedAt: b.completedAt ?? null,
              updatedAt: b.updatedAt ?? b.addedAt,
              shelves: b.shelves ?? '',
            },
          ]
        : [],
    ),
    words: words.map((w) => ({
      normalized: w.normalized,
      original: w.original,
      translated: w.translated,
      src: w.src,
      tgt: w.tgt,
      bookTitle: w.bookTitle,
      example: w.example,
      box: w.box,
      dueDay: w.dueDay,
      savedAt: w.savedAt,
      updatedAt: w.updatedAt,
    })),
    highlights: highlights.flatMap((h) => {
      const book = hashOf.get(h.book);
      return book ? [{ book, block: h.block, start: h.start, end: h.end, color: h.color, note: h.note, createdAt: h.createdAt, updatedAt: h.updatedAt }] : [];
    }),
    days: days.map((d) => ({
      day: d.day,
      active: d.active,
      sessions: d.sessions,
      translations: d.translations,
      words: d.words,
      paragraphs: d.paragraphs,
      autoParagraphs: d.autoParagraphs,
      seconds: d.seconds,
      goalMet: d.goalMet,
      dictations: d.dictations,
    })),
    deletions: Object.fromEntries(deleted),
  };
}

/** The merge already picked the newest version of each record, so values are written as they are. */
async function applySnapshot(s: Snapshot) {
  const [books, words, highlights, days, deleted] = await Promise.all([
    db.all<Book>('books'),
    db.all<Word>('words'),
    db.all<Highlight>('highlights'),
    db.all<Day>('days'),
    deletions(),
  ]);
  const byHash = new Map(books.flatMap((b) => (b.hash ? [[b.hash, b]] : [])));
  const hashOf = new Map(books.flatMap((b) => (b.hash ? [[b.id, b.hash]] : [])));
  const localWords = new Map(words.map((w) => [w.key, w]));
  const localHighlights = new Map(
    highlights.flatMap((h) => {
      const book = hashOf.get(h.book);
      return book ? [[highlightKey({ ...h, book }), h]] : [];
    }),
  );
  const localDays = new Map(days.map((d) => [d.day, d]));
  await transact(['books', 'words', 'highlights', 'days', 'deletions'], (tx) => {
    for (const b of s.books) {
      const book = byHash.get(b.hash);
      if (!book) continue;
      tx.objectStore('books').put({
        ...book,
        language: b.language ?? book.language,
        target: b.targetLanguage ?? undefined,
        lastBlock: b.lastBlock,
        lastOpenedAt: b.lastOpenedAt ?? undefined,
        completedAt: b.completedAt ?? undefined,
        shelves: b.shelves,
        updatedAt: b.updatedAt,
      } satisfies Book);
    }
    for (const w of s.words) tx.objectStore('words').put({ ...w, key: wordKey(w) } satisfies Word);
    for (const h of s.highlights) {
      const book = byHash.get(h.book)?.id;
      if (book === undefined) continue;
      const id = localHighlights.get(highlightKey(h))?.id;
      tx.objectStore('highlights').put({ ...(id !== undefined && { id }), book, block: h.block, start: h.start, end: h.end, color: h.color, note: h.note, createdAt: h.createdAt, updatedAt: h.updatedAt } satisfies Highlight);
    }
    // what was counted here meanwhile stays: each counter keeps the larger value
    for (const d of s.days) {
      const old = localDays.get(d.day);
      tx.objectStore('days').put(old ? { ...d, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.max(v, old[k as keyof Day])])) } : d);
    }
    for (const [kindKey, at] of Object.entries(s.deletions)) {
      tx.objectStore('deletions').put(Math.max(at, deleted.get(kindKey) ?? 0), kindKey);
      // the records a deletion removes; books are removed by the caller, together with their files
      const [kind, ...parts] = kindKey.split('|');
      const key = parts.join('|');
      const word = kind === 'word' && parts.length === 3 ? localWords.get(key) : undefined;
      if (word && word.updatedAt <= at) tx.objectStore('words').delete(word.key);
      const highlight = kind === 'highlight' && parts.length === 4 ? localHighlights.get(key) : undefined;
      if (highlight?.id !== undefined && highlight.updatedAt <= at) tx.objectStore('highlights').delete(highlight.id);
    }
  });
}

/**
 * Pull, merge, apply, push. Book files go up before the snapshot that mentions them, so another device never sees a book
 * it can't download; a push that lost the race to another device (409) starts the round again from a fresh pull. A book
 * from another device only gets a place in the library: the server, which has its file, reads it.
 */
async function syncNow(): Promise<string> {
  if (!account()) throw new Error('sem conta');
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await getJson<{ version: number; snapshot: unknown }>('/sync/snapshot');
    const merged = merge(await exportSnapshot(), remote.snapshot ? fromJson(remote.snapshot) : emptySnapshot());
    const mergedHashes = new Set(merged.books.map((b) => b.hash));

    for (const b of await db.all<Book>('books')) if (b.hash && !mergedHashes.has(b.hash)) await deleteBook(b.id as number, false);
    const local = new Set((await db.all<Book>('books')).map((b) => b.hash));
    let added = 0;
    for (const book of merged.books) {
      if (local.has(book.hash)) continue;
      try {
        await keepBook(book.hash, await openBook(book.hash, `${book.title}.${book.fileType}`), { title: book.title });
        added++;
      } catch (e) {
        // its device hasn't uploaded it yet (404), or the server can't read it (a PDF of scanned pages needs the
        // Android app's OCR): it stays in the cloud for the other devices
        if (!(e instanceof ApiError && (e.status === 404 || e.code === 'BOOK_UNREADABLE'))) throw e;
      }
    }
    await applySnapshot(merged);

    const onServer = new Set((await getJson<{ files: string[] }>('/sync/files')).files);
    let uploaded = 0;
    for (const b of await db.all<Book>('books')) {
      if (!b.hash || onServer.has(b.hash)) continue;
      const file = await db.get<Uint8Array<ArrayBuffer>>('files', b.id as number);
      if (!file) continue; // added before original files were kept
      await putBytes(`/sync/files/${b.hash}`, file);
      onServer.add(b.hash);
      uploaded++;
    }
    // books kept whole on this device before the server read them: once their file is in the cloud, the copy here goes
    const inCloud = (await db.all<Book>('books')).filter((b) => b.hash && onServer.has(b.hash)).map((b) => b.id as number);
    await transact(['texts', 'files', 'images'], (tx) => {
      for (const id of inCloud) for (const store of ['texts', 'files', 'images']) tx.objectStore(store).delete(id);
    });

    try {
      await putJson('/sync/snapshot', { version: remote.version, snapshot: merged });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') continue;
      throw e;
    }
    for (const hash of onServer) if (!mergedHashes.has(hash)) await del(`/sync/files/${hash}`);
    localStorage.setItem('lastSync', String(Date.now()));
    return [
      'Tudo sincronizado.',
      added > 0 && `${added} livro(s) novo(s) na biblioteca.`,
      uploaded > 0 && `${uploaded} livro(s) enviado(s) para a nuvem.`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  throw new Error('outro aparelho está sincronizando; tente de novo');
}

let syncing = false;
const watchers = new Set<() => void>();
const changed = () => {
  for (const f of watchers) f();
};

/** One sync at a time; [quiet] (the automatic one at start) shows nothing, success or failure. */
export async function sync(quiet = false) {
  if (syncing || !account()) return;
  syncing = true;
  changed();
  let text: string;
  let error = false;
  try {
    text = await syncNow();
  } catch (e) {
    error = true;
    const code = e instanceof ApiError ? e.code : '';
    text =
      code === 'SESSION_EXPIRED'
        ? 'Sua sessão expirou. Entre de novo para sincronizar.'
        : code === 'STORAGE_FULL'
          ? 'Espaço na nuvem esgotado. Exclua livros para liberar.'
          : code === 'NO_CONNECTION'
            ? 'Sem conexão com o servidor. Tente de novo mais tarde.'
            : 'Não foi possível sincronizar agora.';
  } finally {
    syncing = false;
    changed();
  }
  if (!quiet) notify({ text, error, ...(error && { action: { label: 'Tentar de novo', run: () => sync() } }) });
}

/** Whether a sync is running and when the last one finished (0: never), redrawn as that changes. */
export function useSyncState(): { syncing: boolean; lastSync: number } {
  const read = () => ({ syncing, lastSync: Number(localStorage.getItem('lastSync') ?? 0) });
  const [state, setState] = useState(read);
  useEffect(() => {
    const f = () => setState(read());
    watchers.add(f);
    return () => {
      watchers.delete(f);
    };
  }, []);
  return state;
}
