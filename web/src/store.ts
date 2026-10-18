/** IndexedDB, on this device only (sync with the Android app comes later). */
import { useEffect, useState } from 'react';
import type { TocEntry } from './book';
import { Leitner } from './rules';
import { localDay } from './text';

export interface Book {
  id?: number;
  title: string;
  language: string;
  /** What the book is translated into; the reader's language when not chosen. */
  target?: string;
  blockCount: number;
  /** First paragraph on screen when the book was last read. */
  lastBlock: number;
  addedAt: number;
  toc?: TocEntry[];
}

/** Same fields as the Android app's synced words, so the two can merge later. */
export interface Word {
  /** normalized|src|tgt */
  key: string;
  normalized: string;
  original: string;
  translated: string;
  src: string;
  tgt: string;
  bookTitle: string | null;
  example: string | null;
  box: number;
  dueDay: number | null;
  savedAt: number;
  updatedAt: number;
}

/** One local day of activity, the Android app's SyncDay. */
export interface Day {
  day: number;
  active: number;
  sessions: number;
  translations: number;
  words: number;
  paragraphs: number;
  autoParagraphs: number;
  seconds: number;
  goalMet: number;
  dictations: number;
}

const opened = new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open('entrelinhas', 4);
  req.onupgradeneeded = (e) => {
    const db = req.result;
    if (e.oldVersion < 1) {
      db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('texts'); // book id -> paragraphs, kept apart so the library loads fast
      db.createObjectStore('words', { keyPath: 'key' });
      db.createObjectStore('cache'); // "src|tgt|text|context" -> translation
    }
    if (e.oldVersion < 2) {
      db.createObjectStore('days', { keyPath: 'day' });
      db.createObjectStore('deletions'); // "kind|key" -> when, so a sync doesn't bring deleted things back
    }
    if (e.oldVersion < 3) db.createObjectStore('kitQueue', { keyPath: 'id', autoIncrement: true }); // kit words waiting for their day
    if (e.oldVersion < 4) db.createObjectStore('paragraphs'); // "book|block|src|tgt" -> its translation, kept on reopening
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

type Store = 'books' | 'texts' | 'words' | 'cache' | 'days' | 'deletions' | 'kitQueue' | 'paragraphs';

const listeners = new Set<() => void>();

async function run<T>(store: Store, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await opened).transaction(store, mode);
  const req = op(tx.objectStore(store));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // screens re-read after a write; the translation cache changes nothing on screen
  if (mode === 'readwrite' && store !== 'cache') for (const f of listeners) f();
  return req.result;
}

export const db = {
  get: <T>(store: Store, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  all: <T>(store: Store) => run<T[]>(store, 'readonly', (s) => s.getAll()),
  put: (store: Store, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key)),
  /** Many records in one transaction: one redraw instead of one per record. */
  putAll: (store: Store, values: unknown[]) =>
    run(store, 'readwrite', (s) => {
      for (const v of values) s.put(v);
      return s.count();
    }),
  del: (store: Store, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key)),
};

/** [load]'s result, read again after every write to the database. */
export function useDb<T>(load: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    const read = () => load().then((v) => alive && setValue(v));
    read();
    listeners.add(read);
    return () => {
      alive = false;
      listeners.delete(read);
    };
  }, deps); // the caller lists what [load] depends on
  return value;
}

/** Newest first, like the Android app's word list. */
export const words = () => db.all<Word>('words').then((all) => all.sort((a, b) => b.savedAt - a.savedAt));

/** Due today or earlier and not mastered, the oldest due first. */
export const dueWords = () =>
  db.all<Word>('words').then((all) =>
    all
      .filter((w) => w.box < Leitner.MASTERED && w.dueDay !== null && w.dueDay <= localDay())
      .sort((a, b) => (a.dueDay ?? 0) - (b.dueDay ?? 0) || a.updatedAt - b.updatedAt),
  );

async function setBox(w: Word, box: number, dueDay: number | null) {
  await db.put('words', { ...w, box, dueDay, updatedAt: Date.now() } satisfies Word);
}

/** A review answer moves the word through the Leitner boxes. */
export function answer(w: Word, known: boolean) {
  const [box, due] = Leitner.next(w.box, known, localDay());
  return setBox(w, box, due);
}

export const setLearned = (w: Word, on: boolean) => (on ? setBox(w, Leitner.MASTERED, null) : setBox(w, 0, localDay()));

export async function deleteWord(w: Word) {
  await db.put('deletions', Date.now(), `word|${w.key}`);
  await db.del('words', w.key);
}

/** Today's numbers, created at zero on the first activity of the day. */
async function today(): Promise<Day> {
  const day = localDay();
  return (
    (await db.get<Day>('days', day)) ?? {
      day,
      active: 0,
      sessions: 0,
      translations: 0,
      words: 0,
      paragraphs: 0,
      autoParagraphs: 0,
      seconds: 0,
      goalMet: 0,
      dictations: 0,
    }
  );
}

/** Finishing an exercise meets the day's goal too (Cartões, Aprender, Avaliar, Ditado; like the Android app). */
export async function completeExercise() {
  await db.put('days', { ...(await today()), active: 1, goalMet: 1 });
}

type Stat = 'words' | 'paragraphs' | 'autoParagraphs' | 'dictations' | 'sessions';

/** Counts today's activity like the Android app's Db.record: translated words and paragraphs also count as translations. */
export async function record(stat: Stat, n = 1) {
  const d = await today();
  const translation = stat === 'words' || stat === 'paragraphs' || stat === 'autoParagraphs';
  await db.put('days', { ...d, active: 1, [stat]: d[stat] + n, translations: d.translations + (translation ? n : 0) });
}

const paragraphKey = (book: number, block: number, src: string, tgt: string) => `${book}|${block}|${src}|${tgt}`;

/** A book's saved paragraph translations for a language pair, by block. */
export async function paragraphTranslations(book: number, src: string, tgt: string): Promise<Map<number, string>> {
  const prefix = `${book}|`;
  const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>('paragraphs', 'readonly', (s) => s.getAllKeys(range)),
    run<string[]>('paragraphs', 'readonly', (s) => s.getAll(range)),
  ]);
  const out = new Map<number, string>();
  keys.forEach((k, i) => {
    const [, block, s, t] = String(k).split('|');
    if (s === src && t === tgt) out.set(Number(block), values[i]);
  });
  return out;
}

export const saveParagraph = (book: number, block: number, src: string, tgt: string, text: string) => db.put('paragraphs', text, paragraphKey(book, block, src, tgt));
export const deleteParagraph = (book: number, block: number, src: string, tgt: string) => db.del('paragraphs', paragraphKey(book, block, src, tgt));
