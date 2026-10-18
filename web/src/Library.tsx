/** The Books tab, laid out like the Android app's Library (Screens.kt). */
import addSvg from '@material-design-icons/svg/filled/add.svg?raw';
import arrowRightSvg from '@material-design-icons/svg/filled/keyboard_arrow_right.svg?raw';
import moreSvg from '@material-design-icons/svg/filled/more_horiz.svg?raw';
import exploreSvg from '@material-design-icons/svg/outlined/explore.svg?raw';
import menuBookSvg from '@material-design-icons/svg/outlined/menu_book.svg?raw';
import styleSvg from '@material-design-icons/svg/outlined/style.svg?raw';
import { useEffect, useState } from 'react';
import { post } from './api';
import { asBlocks, type Block } from './book';
import { StreakCard } from './Goals';
import { notify } from './notices';
import { type Book, db, deleteBook, dueWords, importBook, onChange, useDb } from './store';
import { levelSample } from './text';
import { AlertDialog, Confirm, Icon, Menu, Pills, ScreenTitle } from './ui';

const onIphone = /iPhone|iPad/.test(navigator.userAgent);
const installed =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

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

type Status = 'ready' | 'reading' | 'done';
const status = (b: Book): Status => (b.completedAt ? 'done' : b.lastOpenedAt ? 'reading' : 'ready');
const STATUS_LABEL: Record<Status, string> = { ready: 'NOVO', reading: 'EM ANDAMENTO', done: 'CONCLUÍDO' };
const progress = (b: Book) => (b.completedAt ? 1 : !b.lastOpenedAt || !b.blockCount ? 0 : (b.lastBlock + 1) / b.blockCount);
const percent = (b: Book) => `${Math.round(progress(b) * 100)}%`;
const shelvesOf = (b: Book) => (b.shelves ?? '').split('\n').filter(Boolean);

/** Each book's cover as a URL, made again when the books change. */
function useCovers(books: Book[]): Map<number, string> {
  const [urls, setUrls] = useState<Map<number, string>>(new Map());
  const ids = books.map((b) => b.id as number).join(',');
  useEffect(() => {
    let made = new Map<number, string>();
    let alive = true;
    Promise.all(books.map(async (b) => [b.id as number, await db.get<Blob>('covers', b.id as number)] as const)).then((all) => {
      made = new Map(all.flatMap(([id, blob]) => (blob ? [[id, URL.createObjectURL(blob)]] : [])));
      if (alive) setUrls(made);
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ids]);
  return urls;
}

function Cover({ url, fileType, width, height }: { url?: string; fileType?: string; width: number; height: number }) {
  return (
    <span className="cover" style={{ width, height }}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="cover-blank">
          <Icon svg={menuBookSvg} />
          <span className="label-medium">{(fileType ?? 'epub').toUpperCase()}</span>
        </span>
      )}
    </span>
  );
}

export function Library({ onOpen, onReview, onExplore }: { onOpen: (book: Book) => void; onReview: () => void; onExplore: () => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(0);
  const [deleting, setDeleting] = useState<Book | null>(null);
  const [shelving, setShelving] = useState<Book | null>(null);
  const due = useDb(() => dueWords().then((w) => w.length)) ?? 0;
  const covers = useCovers(books);

  // the book read last first, like the Android app
  const load = () => db.all<Book>('books').then((all) => setBooks(all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))));
  useEffect(() => {
    load().then(() => assessLevels(load));
    return onChange(load); // books a sync downloads or removes show up at once
  }, []);

  async function add(file: File) {
    setBusy(true);
    try {
      await importBook(file.name, new Uint8Array(await file.arrayBuffer()));
      await load();
      assessLevels(load);
    } catch (e) {
      notify({ text: e instanceof Error ? e.message : 'Não consegui abrir este arquivo.', error: true });
    } finally {
      setBusy(false);
    }
  }

  const current = books.filter((b) => status(b) === 'reading').sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
  // shelves follow the three status filters; a shelf that lost its last book falls back to "all"
  const shelves = [...new Set(books.flatMap(shelvesOf))].sort();
  const shelf = shelves[filter - 3];
  const shown = books.filter((b) => (shelf !== undefined ? shelvesOf(b).includes(shelf) : filter === 1 ? status(b) === 'reading' : filter === 2 ? status(b) === 'done' : true));

  return (
    <main className="tab-page">
      <ScreenTitle>Biblioteca</ScreenTitle>
      {busy && <span className="linear-progress" />}
      <div className="library">
        {onIphone && !installed && (
          <p className="card hint body-medium">
            Para instalar: toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
          </p>
        )}
        <StreakCard />
        {(current || due > 0) && (
          <div className="card continue-card">
            {current && (
              <button type="button" className="continue-row" onClick={() => onOpen(current)}>
                <Cover url={covers.get(current.id as number)} fileType={current.fileType} width={36} height={50} />
                <span className="grow continue-text">
                  <span className="label-medium primary-text">Continuar lendo</span>
                  <span className="body-large ellipsis">{current.title}</span>
                </span>
                <span className="body-medium variant">{percent(current)}</span>
                <Icon svg={arrowRightSvg} className="variant" />
              </button>
            )}
            {due > 0 && (
              <button type="button" className={`continue-row${current ? ' divided' : ''}`} onClick={onReview}>
                <span className="icon-circle" style={{ width: 36, height: 36 }}>
                  <Icon svg={styleSvg} size={20} />
                </span>
                <span className="grow body-large">
                  {due} {due === 1 ? 'palavra para revisar hoje' : 'palavras para revisar hoje'}
                </span>
                <Icon svg={arrowRightSvg} className="variant" />
              </button>
            )}
          </div>
        )}
        <Pills options={['Todos', 'Em andamento', 'Concluídos', ...shelves]} selected={filter >= 3 && shelf === undefined ? 0 : filter} onSelect={setFilter} />
        <div className="action-tiles">
          <label className={`card action-tile${busy ? ' disabled' : ''}`}>
            <span className="icon-circle">
              <Icon svg={addSvg} size={22} />
            </span>
            <span className="title-small">Adicionar livro</span>
            <span className="body-small variant">EPUB, FB2 ou TXT do aparelho</span>
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
          <button type="button" className="card action-tile" onClick={onExplore}>
            <span className="icon-circle">
              <Icon svg={exploreSvg} size={22} />
            </span>
            <span className="title-small">Livros grátis</span>
            <span className="body-small variant">Clássicos do Gutenberg e outros acervos</span>
          </button>
        </div>
        {shown.length === 0 && !busy && (
          <div className="empty-state">
            <img src="/art/empty_library.png" alt="" width={128} height={128} />
            <span className="title-medium">{books.length === 0 ? 'Nenhum livro ainda' : 'Nada por aqui'}</span>
            <span className="body-medium variant">Adicione um livro EPUB, FB2 ou TXT para começar a ler.</span>
          </div>
        )}
        {shown.map((b) => (
          <BookCard key={b.id} book={b} cover={covers.get(b.id as number)} onOpen={() => onOpen(b)} onShelves={() => setShelving(b)} onDelete={() => setDeleting(b)} />
        ))}
      </div>
      {deleting && (
        <Confirm
          title={`Excluir "${deleting.title}"?`}
          text="O livro e o progresso de leitura serão removidos."
          onConfirm={() => deleteBook(deleting.id as number)}
          onDismiss={() => setDeleting(null)}
        />
      )}
      {shelving && (
        <ShelvesDialog
          book={shelving}
          all={shelves}
          onDismiss={() => setShelving(null)}
          onSave={async (chosen) => {
            const now = await db.get<Book>('books', shelving.id as number);
            if (now) await db.put('books', { ...now, shelves: chosen.join('\n'), updatedAt: Date.now() });
            setShelving(null);
          }}
        />
      )}
    </main>
  );
}

function BookCard({ book: b, cover, onOpen, onShelves, onDelete }: { book: Book; cover?: string; onOpen: () => void; onShelves: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="card book-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <Cover url={cover} fileType={b.fileType} width={84} height={118} />
      <div className="book-info">
        <div className="book-head">
          <span className="title-medium book-title">{b.title}</span>
          <span className="menu-anchor">
            <button
              type="button"
              className="more-button"
              aria-label="Mais opções"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(true);
              }}
            >
              <Icon svg={moreSvg} size={20} />
            </button>
            {menu && (
              <Menu
                items={[
                  { label: 'Estantes', onClick: onShelves },
                  { label: 'Excluir', onClick: onDelete },
                ]}
                onDismiss={() => setMenu(false)}
              />
            )}
          </span>
        </div>
        <div className="badges">
          <span className="badge label-large">{STATUS_LABEL[status(b)]}</span>
          {b.level && <span className="badge label-large">Nível {b.level}</span>}
        </div>
        <div className="book-progress body-medium">
          <span>Progresso salvo</span>
          <span>{percent(b)}</span>
        </div>
        <span className="progress-line">{progress(b) > 0 && <span style={{ width: `${Math.max(1.5, Math.min(100, progress(b) * 100))}%` }} />}</span>
      </div>
    </div>
  );
}

function ShelvesDialog({ book, all, onDismiss, onSave }: { book: Book; all: string[]; onDismiss: () => void; onSave: (shelves: string[]) => void }) {
  const [chosen, setChosen] = useState(new Set(shelvesOf(book)));
  const [name, setName] = useState('');
  return (
    <AlertDialog
      title={`Estantes de “${book.title}”`}
      onDismiss={onDismiss}
      actions={
        <>
          <button type="button" className="text-button" onClick={onDismiss}>
            Cancelar
          </button>
          <button type="button" className="text-button" onClick={() => onSave([...new Set([...chosen, name.trim()])].filter(Boolean).sort())}>
            Salvar
          </button>
        </>
      }
    >
      {all.map((s) => (
        <label key={s} className="check-row body-large">
          <input
            type="checkbox"
            checked={chosen.has(s)}
            onChange={() => {
              const next = new Set(chosen);
              if (!next.delete(s)) next.add(s);
              setChosen(next);
            }}
          />
          {s}
        </label>
      ))}
      <input className="outlined-field" placeholder="Nova estante" value={name} maxLength={40} onChange={(e) => setName(e.target.value.replace(/\n/g, ' '))} />
    </AlertDialog>
  );
}
