/** The Android app's FreeBooks (Explore.kt): the same four collections. The app browses them in its own browser and catches
 *  the download; a web app can't, so Project Gutenberg comes as a catalog inside the app (the server downloads the book
 *  straight into the library, as in the app) and the other three open in the browser, their file coming in through
 *  "Adicionar livro". */
import arrowBackSvg from '@material-design-icons/svg/filled/arrow_back.svg?raw';
import downloadSvg from '@material-design-icons/svg/outlined/download.svg?raw';
import openInNewSvg from '@material-design-icons/svg/outlined/open_in_new.svg?raw';
import { type FormEvent, useEffect, useState } from 'react';
import { coverUrl, type FreeBook, searchBooks } from './gutenberg';
import { Close, Search } from './icons';
import { notify } from './notices';
import { addGutenberg, bookErrorText } from './remote';
import type { Book } from './store';
import { AlertDialog, Icon } from './ui';

const SITES = [
  { name: 'Standard Ebooks', url: 'https://standardebooks.org/ebooks', text: 'Clássicos em inglês revisados, com capa e tipografia caprichadas.', formats: 'EPUB' },
  { name: 'Wikisource', url: 'https://wikisource.org/wiki/Main_Page', text: 'Biblioteca livre e multilíngue; cada obra tem o botão de baixar em EPUB.', formats: 'EPUB · PDF' },
  { name: 'Internet Archive', url: 'https://archive.org/details/texts', text: 'Milhões de livros digitalizados. Prefira os de domínio público.', formats: 'EPUB · PDF · TXT' },
];

export function FreeBooks({ onClose, onOpen }: { onClose: () => void; onOpen: (book: Book) => void }) {
  const [catalog, setCatalog] = useState(false);
  if (catalog) return <Catalog onClose={() => setCatalog(false)} onOpen={onOpen} />;
  return (
    <main className="free-books">
      <header className="app-bar">
        <button type="button" className="icon" aria-label="Voltar" onClick={onClose}>
          <Icon svg={arrowBackSvg} />
        </button>
        <h1 className="title-large">Livros grátis</h1>
      </header>
      <div className="free-list">
        <div className="free-hint">
          <img src="/art/empty_explore.png" alt="" width={140} height={140} />
          <p className="body-medium variant">
            Escolha um livro do Project Gutenberg e ele entra direto na sua biblioteca. Os outros acervos abrem no navegador; depois use “Adicionar livro”.
          </p>
        </div>
        <button type="button" className="card site-card" onClick={() => setCatalog(true)}>
          <span className="title-medium semibold">Project Gutenberg</span>
          <span className="body-medium variant">Mais de 75 mil clássicos em domínio público, em dezenas de idiomas.</span>
          <span className="label-medium primary-text">EPUB</span>
        </button>
        {SITES.map((s) => (
          <a key={s.name} className="card site-card" href={s.url} target="_blank" rel="noopener noreferrer">
            <span className="site-name">
              <span className="title-medium semibold">{s.name}</span>
              <Icon svg={openInNewSvg} size={18} className="variant" />
            </span>
            <span className="body-medium variant">{s.text}</span>
            <span className="label-medium primary-text">{s.formats}</span>
          </a>
        ))}
      </div>
    </main>
  );
}

/** The app's Browser for Project Gutenberg: the most downloaded books, a search, and one tap to add a book. */
function Catalog({ onClose, onOpen }: { onClose: () => void; onOpen: (book: Book) => void }) {
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<FreeBook[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [added, setAdded] = useState<{ book: Book; before: boolean } | null>(null);

  async function load(q: string, page: string | null) {
    setLoading(true);
    try {
      const found = await searchBooks(q, page);
      setBooks((shown) => (page ? [...shown, ...found.books] : found.books));
      setNext(found.next);
    } catch (e) {
      notify({ text: (e as Error).message, error: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load('', null);
  }, []);

  async function add(b: FreeBook) {
    setDownloading(b.id);
    notify({ text: `Baixando ${b.title}…` });
    try {
      setAdded(await addGutenberg(b.id));
    } catch (e) {
      notify({ text: bookErrorText(e), error: true });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <main className="free-books">
      <header className="app-bar">
        <button type="button" className="icon" aria-label="Fechar" onClick={onClose}>
          <Close />
        </button>
        <h1 className="title-large">Project Gutenberg</h1>
      </header>
      {(loading || downloading !== null) && <span className="linear-progress" />}
      <form
        className="search-row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          load(query, null);
        }}
      >
        <label className="search">
          <Search />
          <input type="search" placeholder="Título ou autor" aria-label="Buscar no Project Gutenberg" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </form>
      <div className="catalog-list">
        {!loading && !books.length && <p className="variant center sheet-empty">Nenhum livro encontrado.</p>}
        {books.map((b) => (
          <button type="button" key={b.id} className="card free-book" disabled={downloading !== null} onClick={() => add(b)}>
            <img src={coverUrl(b.id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            <span className="grow">
              <span className="title-medium clamp-2">{b.title}</span>
              <span className="body-medium variant">{b.author}</span>
            </span>
            <Icon svg={downloadSvg} className="primary-text" />
          </button>
        ))}
        {next && !loading && (
          <button type="button" className="button outline" onClick={() => load(query, next)}>
            Mostrar mais
          </button>
        )}
      </div>
      {added && (
        <AlertDialog
          title="Livro adicionado"
          onDismiss={() => setAdded(null)}
          actions={
            <>
              <button type="button" className="text-button" onClick={() => setAdded(null)}>
                Continuar navegando
              </button>
              <button type="button" className="text-button" onClick={() => onOpen(added.book)}>
                Ler agora
              </button>
            </>
          }
        >
          {added.before ? 'Já está na sua biblioteca.' : added.book.title}
        </AlertDialog>
      )}
    </main>
  );
}
