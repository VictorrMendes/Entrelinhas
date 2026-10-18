/**
 * The Android app's sync snapshot (Sync.kt), field for field: books are identified across devices by the sha256 of their
 * file, words by their normalized text and language pair, highlights by book, block and offsets.
 */

export interface SyncBook {
  hash: string;
  title: string;
  fileType: string;
  language: string | null;
  targetLanguage: string | null;
  lastBlock: number;
  lastOpenedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
  /** Shelf names separated by line breaks (shelves are only made on Android for now). */
  shelves: string;
}

export interface SyncWord {
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

export interface SyncHighlight {
  /** The book's hash. */
  book: string;
  block: number;
  start: number;
  end: number;
  color: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SyncDay {
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

export interface Snapshot {
  books: SyncBook[];
  words: SyncWord[];
  highlights: SyncHighlight[];
  days: SyncDay[];
  /** "kind|key" -> when it was deleted. */
  deletions: Record<string, number>;
}

export const emptySnapshot = (): Snapshot => ({ books: [], words: [], highlights: [], days: [], deletions: {} });
export const wordKey = (w: { normalized: string; src: string; tgt: string }) => `${w.normalized}|${w.src}|${w.tgt}`;
export const highlightKey = (h: { book: string; block: number; start: number; end: number }) => `${h.book}|${h.block}|${h.start}|${h.end}`;

const DAY_COUNTERS = ['active', 'sessions', 'translations', 'words', 'paragraphs', 'autoParagraphs', 'seconds', 'goalMet', 'dictations'] as const;

/**
 * Last write wins per record, and a deletion wins over any edit older than it. Daily stats keep the larger value of each
 * counter: two devices each report their own total for the same day, and summing would count the same minutes again on every sync.
 */
export function merge(a: Snapshot, b: Snapshot): Snapshot {
  const deletions: Record<string, number> = { ...a.deletions };
  for (const [k, at] of Object.entries(b.deletions)) deletions[k] = Math.max(deletions[k] ?? 0, at);
  // ties keep the first side's version, like Kotlin's maxBy
  const lww = <T extends { updatedAt: number }>(kind: string, x: T[], y: T[], key: (t: T) => string): T[] => {
    const newest = new Map<string, T>();
    for (const t of [...x, ...y]) {
      const k = key(t);
      const seen = newest.get(k);
      if (!seen || t.updatedAt > seen.updatedAt) newest.set(k, t);
    }
    return [...newest.values()].filter((t) => t.updatedAt > (deletions[`${kind}|${key(t)}`] ?? Number.MIN_SAFE_INTEGER));
  };
  const books = lww('book', a.books, b.books, (x) => x.hash);
  const hashes = new Set(books.map((x) => x.hash));
  const days = new Map<number, SyncDay>();
  for (const d of [...a.days, ...b.days]) {
    const seen = days.get(d.day);
    days.set(d.day, seen ? { ...seen, ...Object.fromEntries(DAY_COUNTERS.map((c) => [c, Math.max(seen[c], d[c])])) } : d);
  }
  return {
    books,
    words: lww('word', a.words, b.words, wordKey),
    highlights: lww('highlight', a.highlights, b.highlights, highlightKey).filter((h) => hashes.has(h.book)),
    days: [...days.values()],
    deletions,
  };
}

const HASH = /^[0-9a-f]{64}$/;
type Json = Record<string, unknown>;
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter((x): x is Json => typeof x === 'object' && x !== null) : []);
const int = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback);
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * A snapshot as the server keeps it, made by this app or the Android one. Records missing a required field are left out;
 * a book hash also goes into URLs, so only real sha256 hex passes.
 */
export function fromJson(j: unknown): Snapshot {
  const o = (typeof j === 'object' && j !== null ? j : {}) as Json;
  const books = list(o.books).flatMap((b): SyncBook[] => {
    const hash = str(b.hash);
    const title = str(b.title);
    const fileType = str(b.fileType);
    if (!hash || !HASH.test(hash) || title === null || fileType === null || typeof b.updatedAt !== 'number') return [];
    return [
      {
        hash,
        title,
        fileType,
        language: str(b.language),
        targetLanguage: str(b.targetLanguage),
        lastBlock: int(b.lastBlock),
        lastOpenedAt: intOrNull(b.lastOpenedAt),
        completedAt: intOrNull(b.completedAt),
        updatedAt: int(b.updatedAt),
        shelves: str(b.shelves) ?? '',
      },
    ];
  });
  const words = list(o.words).flatMap((w): SyncWord[] => {
    const [normalized, original, translated, src, tgt] = [w.normalized, w.original, w.translated, w.src, w.tgt].map(str);
    if (normalized === null || original === null || translated === null || src === null || tgt === null || typeof w.updatedAt !== 'number') return [];
    return [
      {
        normalized,
        original,
        translated,
        src,
        tgt,
        bookTitle: str(w.bookTitle),
        example: str(w.example),
        box: int(w.box),
        dueDay: intOrNull(w.dueDay),
        savedAt: int(w.savedAt),
        updatedAt: int(w.updatedAt),
      },
    ];
  });
  const highlights = list(o.highlights).flatMap((h): SyncHighlight[] => {
    const book = str(h.book);
    if (!book || typeof h.updatedAt !== 'number') return [];
    return [{ book, block: int(h.block), start: int(h.start), end: int(h.end), color: int(h.color), note: str(h.note), createdAt: int(h.createdAt), updatedAt: int(h.updatedAt) }];
  });
  const days = list(o.days).flatMap((d): SyncDay[] =>
    typeof d.day === 'number' ? [{ day: int(d.day), ...(Object.fromEntries(DAY_COUNTERS.map((c) => [c, int(d[c])])) as Omit<SyncDay, 'day'>) }] : [],
  );
  const deletions: Record<string, number> = {};
  const raw = typeof o.deletions === 'object' && o.deletions !== null ? (o.deletions as Json) : {};
  for (const [k, at] of Object.entries(raw)) if (typeof at === 'number') deletions[k] = int(at);
  return { books, words, highlights, days, deletions };
}
