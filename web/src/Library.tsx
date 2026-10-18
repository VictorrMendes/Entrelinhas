import { useEffect, useState } from 'react';
import { post } from './api';
import { asBlocks, type Block, parseBook } from './book';
import { StreakCard } from './Goals';
import { type Book, db, deleteBook, sha256Hex } from './store';
import { levelSample } from './text';

const onIphone = /iPhone|iPad/.test(navigator.userAgent);
const installed =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const imageType = (name: string) => `image/${name.split('.').pop()?.replace('jpg', 'jpeg')}`;

let assessing = false;

/** Asks the backend, once per book, which CEFR level it needs; a failure (offline, quota) leaves the rest for later. */
async function assessLevels(done: () => void) {
  if (assessing) return;
  assessing = true;
  try {
    for (const b of await db.all<Book>('books')) {
      if (b.level) continue;
      const sample = levelSample(asBlocks((await db.get<(Block | string)[]>('texts', b.id as number)) ?? []));
      const { level } = await post<{ level: string }>('/level', { sample, language: b.language });
      // the reader may have moved on in the book meanwhile: only the level changes
      const now = await db.get<Book>('books', b.id as number);
      if (now) await db.put('books', { ...now, level });
      done();
    }
  } catch {
    // tried again next time the library opens
  } finally {
    assessing = false;
  }
}

export function Library({ onOpen }: { onOpen: (book: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = () => db.all<Book>('books').then((all) => setBooks(all.sort((a, b) => b.addedAt - a.addedAt)));
  useEffect(() => {
    load().then(() => assessLevels(load));
  }, []);

  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      if ((await db.all<Book>('books')).some((b) => b.hash === hash)) throw new Error('Este livro já está na biblioteca.');
      const parsed = parseBook(file.name, bytes);
      const book: Book = {
        title: parsed.title,
        language: parsed.language,
        blockCount: parsed.blocks.length,
        lastBlock: 0,
        addedAt: Date.now(),
        toc: parsed.toc,
        hash,
        fileType: parsed.fileType,
      };
      const id = (await db.put('books', book)) as number;
      try {
        await db.put('texts', parsed.blocks, id);
        await db.put('files', bytes, id);
        const images = Object.fromEntries(Object.entries(parsed.images).map(([name, data]) => [name, new Blob([data as Uint8Array<ArrayBuffer>], { type: imageType(name) })]));
        if (Object.keys(images).length) await db.put('images', images, id);
      } catch (e) {
        await deleteBook(id); // no half-imported book
        throw e;
      }
      await load();
      assessLevels(load);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui abrir este arquivo.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await deleteBook(id);
    setConfirming(null);
    await load();
  }

  return (
    <main className="page">
      <h1 className="page-title">Biblioteca</h1>
      <StreakCard />
      {onIphone && !installed && (
        <p className="card hint">
          Para instalar: toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
        </p>
      )}

      <label className={`button primary wide${busy ? ' disabled' : ''}`}>
        {busy ? 'Abrindo o livro…' : '+ Adicionar livro (EPUB, FB2 ou TXT)'}
        <input
          type="file"
          accept=".epub,.fb2,.zip,.txt,application/epub+zip,text/plain"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) add(file);
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}

      {books.length === 0 && !busy && (
        <div className="empty">
          <img src="/apple-touch-icon.png" alt="" />
          <p>Nenhum livro ainda. Adicione um EPUB, FB2 ou TXT do seu aparelho.</p>
        </div>
      )}

      <ul className="books">
        {books.map((b) => {
          const id = b.id as number;
          const progress = b.completedAt ? 100 : Math.round((b.lastBlock / Math.max(1, b.blockCount - 1)) * 100);
          return (
            <li key={id} className="card book">
              <button type="button" className="book-open" onClick={() => onOpen(b)}>
                <strong>{b.title}</strong>
                <span className="muted">
                  {b.language.toUpperCase()} · {progress}% lido {b.level && <span className="chip">Nível {b.level}</span>}
                </span>
                <span className="bar">
                  <span style={{ width: `${progress}%` }} />
                </span>
              </button>
              {confirming === id ? (
                <span className="confirm">
                  Excluir?
                  <button type="button" className="text danger" onClick={() => remove(id)}>
                    Sim
                  </button>
                  <button type="button" className="text" onClick={() => setConfirming(null)}>
                    Não
                  </button>
                </span>
              ) : (
                <button type="button" className="text" aria-label={`Excluir ${b.title}`} onClick={() => setConfirming(id)}>
                  Excluir
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
