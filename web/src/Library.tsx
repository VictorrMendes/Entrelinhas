import { useEffect, useState } from 'react';
import { parseBook } from './book';
import { type Book, db } from './store';

const onIphone = /iPhone|iPad/.test(navigator.userAgent);
const installed =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function Library({ onOpen }: { onOpen: (book: Book) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = () => db.all<Book>('books').then((all) => setBooks(all.sort((a, b) => b.addedAt - a.addedAt)));
  useEffect(() => {
    load();
  }, []);

  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseBook(file.name, new Uint8Array(await file.arrayBuffer()));
      const book: Book = {
        title: parsed.title,
        language: parsed.language,
        blockCount: parsed.blocks.length,
        lastBlock: 0,
        addedAt: Date.now(),
        toc: parsed.toc,
      };
      const id = (await db.put('books', book)) as number;
      await db.put('texts', parsed.blocks, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui abrir este arquivo.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await db.del('books', id);
    await db.del('texts', id);
    setConfirming(null);
    await load();
  }

  return (
    <main className="page">
      <h1 className="page-title">Biblioteca</h1>
      {onIphone && !installed && (
        <p className="card hint">
          Para instalar: toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
        </p>
      )}

      <label className={`button primary wide${busy ? ' disabled' : ''}`}>
        {busy ? 'Abrindo o livro…' : '+ Adicionar livro (EPUB ou TXT)'}
        <input
          type="file"
          accept=".epub,.txt,application/epub+zip,text/plain"
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
          <p>Nenhum livro ainda. Adicione um EPUB ou TXT do seu aparelho.</p>
        </div>
      )}

      <ul className="books">
        {books.map((b) => {
          const id = b.id as number;
          const progress = Math.round((b.lastBlock / Math.max(1, b.blockCount - 1)) * 100);
          return (
            <li key={id} className="card book">
              <button type="button" className="book-open" onClick={() => onOpen(b)}>
                <strong>{b.title}</strong>
                <span className="muted">
                  {b.language.toUpperCase()} · {progress}% lido
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
