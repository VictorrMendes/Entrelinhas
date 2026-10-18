import { BarChart3, BookOpen, Bookmark, Settings } from 'lucide-react';
import { useState } from 'react';
import { Cards } from './Cards';
import { Dictation } from './Dictation';
import { Kits } from './Kits';
import { Learn } from './Learn';
import { Library } from './Library';
import { Listen } from './Listen';
import { Match } from './Match';
import { Reader } from './Reader';
import type { Book } from './store';
import { Test } from './Test';
import { type StudyMode, Vocabulary, WordsScreen } from './Vocabulary';

type Tab = 'books' | 'vocabulary' | 'progress' | 'settings';

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'books', label: 'Livros', icon: BookOpen },
  { id: 'vocabulary', label: 'Vocabulário', icon: Bookmark },
  { id: 'progress', label: 'Progresso', icon: BarChart3 },
  { id: 'settings', label: 'Ajustes', icon: Settings },
];

/** The Android app's layout: four tabs below, and the reader or a study mode over them. */
export function App() {
  const [tab, setTab] = useState<Tab>('books');
  const [book, setBook] = useState<Book | null>(null);
  const [mode, setMode] = useState<StudyMode | null>(null);
  const close = () => setMode(null);

  if (book) return <Reader book={book} onClose={() => setBook(null)} />;
  if (mode === 'cards') return <Cards onClose={close} />;
  if (mode === 'learn') return <Learn onClose={close} />;
  if (mode === 'test') return <Test onClose={close} />;
  if (mode === 'match') return <Match onClose={close} />;
  if (mode === 'listen') return <Listen onClose={close} />;
  if (mode === 'dictation') return <Dictation onClose={close} />;
  if (mode === 'words') return <WordsScreen onClose={close} />;
  if (mode === 'kits') return <Kits onClose={close} />;

  return (
    <>
      {tab === 'books' && <Library onOpen={setBook} />}
      {tab === 'vocabulary' && <Vocabulary onStudy={setMode} />}
      {tab === 'progress' && <Soon title="Progresso" text="A ofensiva, as metas, o calendário e as conquistas chegam na próxima etapa." />}
      {tab === 'settings' && <Soon title="Ajustes" text="Conta, sincronização com o Android e preferências chegam numa próxima etapa." />}
      <nav className="tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            <span className="tab-icon">
              <Icon />
            </span>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

function Soon({ title, text }: { title: string; text: string }) {
  return (
    <main className="page">
      <h1 className="page-title">{title}</h1>
      <p className="card hint">{text}</p>
    </main>
  );
}
