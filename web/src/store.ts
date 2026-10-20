/** IndexedDB on this device; cloud.ts syncs it with the Android app through the backend. */
import { useEffect, useState } from 'react';
import type { TocEntry } from './blocks';
import { ACHIEVEMENTS, Leitner, STREAK_GOALS, Streak, type Totals, unlocked, WeekStreak } from './rules';
import { firstDayOfWeek, localDay } from './text';

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
  /** CEFR level (A1–C2) the AI judged the book needs. */
  level?: string;
  /** When the end of the book was first reached. */
  completedAt?: number;
  /** sha256 of the original file: how the Android app and the sync tell books apart (books added before it have none). */
  hash?: string;
  fileType?: string;
  lastOpenedAt?: number;
  /** Last change to what syncs: position, languages, completion. */
  updatedAt?: number;
  /** Shelves made on Android, one per line; kept so a sync doesn't lose them. */
  shelves?: string;
}

/** A highlighted stretch of a block, with an optional note; [color] indexes HIGHLIGHT_COLORS. */
export interface Highlight {
  id?: number;
  book: number;
  block: number;
  start: number;
  end: number;
  color: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
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
  const req = indexedDB.open('entrelinhas', 7);
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
    if (e.oldVersion < 5) db.createObjectStore('highlights', { keyPath: 'id', autoIncrement: true });
    if (e.oldVersion < 6) {
      db.createObjectStore('files'); // book id -> the original file, kept for the cloud backup
      db.createObjectStore('images'); // book id -> { image file name: Blob }
    }
    if (e.oldVersion < 7) db.createObjectStore('covers'); // book id -> its cover, apart so the library loads only those
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

type Store = 'books' | 'texts' | 'words' | 'cache' | 'days' | 'deletions' | 'kitQueue' | 'paragraphs' | 'highlights' | 'files' | 'images' | 'covers';

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
  keys: (store: Store) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  put: (store: Store, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key)),
  /** Many records in one transaction: one redraw instead of one per record. */
  putAll: (store: Store, values: unknown[]) =>
    run(store, 'readwrite', (s) => {
      for (const v of values) s.put(v);
      return s.count();
    }),
  del: (store: Store, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key)),
};

/** Several writes in one transaction, and one redraw after them. */
export async function transact(stores: Store[], write: (tx: IDBTransaction) => void) {
  const tx = (await opened).transaction(stores, 'readwrite');
  write(tx);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  for (const f of listeners) f();
}

/** Calls [f] after every write to the database (the translation cache aside); returns how to stop. */
export function onChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

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

/** Minutes of active reading a day that meet the goal (the Android app's default is 5). */
export const dailyGoalMinutes = () => Number(localStorage.getItem('dailyGoalMinutes') ?? 5);

/** Adds active reading time; true exactly when this call makes today reach the goal. */
export async function addReadingSeconds(seconds: number): Promise<boolean> {
  const d = await today();
  const total = d.seconds + seconds;
  const justMet = !d.goalMet && total >= dailyGoalMinutes() * 60;
  await db.put('days', { ...d, active: 1, seconds: total, goalMet: d.goalMet || (justMet ? 1 : 0) });
  return justMet;
}

/** The daily streak over the days whose goal was met. */
export async function streak() {
  const met = (await db.all<Day>('days')).filter((d) => d.goalMet).map((d) => d.day);
  return Streak.compute(met.sort((a, b) => a - b), localDay());
}

/** The streak goal being aimed at, in days (7 → 14 → 30); 0 once every goal is behind. */
export const streakGoal = () => Number(localStorage.getItem('streakGoal') ?? STREAK_GOALS[0]);

export async function totals(): Promise<Totals> {
  const [days, ws, books] = await Promise.all([db.all<Day>('days'), db.all<Word>('words'), db.all<Book>('books')]);
  const sum = (f: (d: Day) => number) => days.reduce((n, d) => n + f(d), 0);
  const met = days.filter((d) => d.goalMet).map((d) => d.day);
  return {
    readingMinutes: Math.floor(sum((d) => d.seconds) / 60),
    savedWords: ws.length,
    learnedWords: ws.filter((w) => w.box >= Leitner.MASTERED).length,
    booksCompleted: books.filter((b) => b.completedAt).length,
    dictations: sum((d) => d.dictations),
    goalDays: met.length,
    longestStreak: Streak.compute(met.sort((a, b) => a - b), localDay()).longest,
    longestWeeks: WeekStreak.compute(days.filter((d) => d.active).map((d) => d.day), localDay(), firstDayOfWeek()).longest,
  };
}

export interface Celebration {
  text: string;
  /** An achievement has a "Ver" that opens the Progress tab. */
  achievement: boolean;
}

/** Streak goals reached and achievements unlocked since the last check; the very first check only takes note of what is there. */
export async function celebrations(): Promise<Celebration[]> {
  const out: Celebration[] = [];
  const goal = streakGoal();
  if (goal > 0 && (await streak()).current >= goal) {
    out.push({ text: `Meta de ${goal} dias cumprida! Sua chama evoluiu 🔥`, achievement: false });
    localStorage.setItem('streakGoal', String(STREAK_GOALS.find((g) => g > goal) ?? 0));
  }
  const t = await totals();
  const now = ACHIEVEMENTS.filter((a) => unlocked(a, t));
  const stored = localStorage.getItem('achievements');
  const seen = new Set(stored?.split(',').filter(Boolean));
  localStorage.setItem('achievements', [...new Set([...seen, ...now.map((a) => a.id)])].join(','));
  if (stored !== null) for (const a of now) if (!seen.has(a.id)) out.push({ text: `Conquista desbloqueada: ${a.title}`, achievement: true });
  return out;
}

export const bookHighlights = (book: number) => db.all<Highlight>('highlights').then((all) => all.filter((h) => h.book === book));

export async function deleteHighlight(h: Highlight) {
  const hash = (await db.get<Book>('books', h.book))?.hash;
  if (hash) await db.put('deletions', Date.now(), `highlight|${hash}|${h.block}|${h.start}|${h.end}`);
  await db.del('highlights', h.id as number);
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A book with everything kept for it: cover, translated paragraphs and highlights (and the text, file and images books
 * kept here before the server read them). [tombstone] keeps a sync from bringing it back; the sync itself removes books
 * deleted elsewhere without one.
 */
export async function deleteBook(id: number, tombstone = true) {
  const hash = (await db.get<Book>('books', id))?.hash;
  if (tombstone && hash) await db.put('deletions', Date.now(), `book|${hash}`);
  await db.del('books', id);
  await db.del('texts', id);
  await db.del('files', id);
  await db.del('images', id);
  await db.del('covers', id);
  await run('paragraphs', 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${id}|`, `${id}|￿`)));
  for (const h of await bookHighlights(id)) await db.del('highlights', h.id as number);
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
