/** IndexedDB, on this device only (sync with the Android app comes later). */

export interface Book {
  id?: number;
  title: string;
  language: string;
  blockCount: number;
  /** First paragraph on screen when the book was last read. */
  lastBlock: number;
  addedAt: number;
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

const opened = new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open('entrelinhas', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
    req.result.createObjectStore('texts'); // book id -> paragraphs, kept apart so the library loads fast
    req.result.createObjectStore('words', { keyPath: 'key' });
    req.result.createObjectStore('cache'); // "src|tgt|text|context" -> translation
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

type Store = 'books' | 'texts' | 'words' | 'cache';

async function run<T>(store: Store, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await opened).transaction(store, mode);
  const req = op(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const db = {
  get: <T>(store: Store, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  all: <T>(store: Store) => run<T[]>(store, 'readonly', (s) => s.getAll()),
  put: (store: Store, value: unknown, key?: IDBValidKey) => run(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: Store, key: IDBValidKey) => run(store, 'readwrite', (s) => s.delete(key)),
};
