import { BarChart3, BookOpen, Bookmark, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Cards } from './Cards';
import { Dictation } from './Dictation';
import { Kits } from './Kits';
import { Learn } from './Learn';
import { Library } from './Library';
import { Listen } from './Listen';
import { Match } from './Match';
import { Progress } from './Progress';
import { Reader } from './Reader';
import { type Book, type Celebration, celebrations, onChange } from './store';
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
  const [notices, setNotices] = useState<Celebration[]>([]);
  const close = () => setMode(null);

  // counters settle a moment after each change (reading time ticks, a review round), so check once things are quiet
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const found = await celebrations();
        if (found.length) setNotices((n) => [...n, ...found]);
      }, 1500);
    };
    check();
    const stop = onChange(check);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);

  useEffect(() => {
    if (!notices.length) return;
    const t = window.setTimeout(() => setNotices((n) => n.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [notices]);

  let screen;
  if (book) screen = <Reader book={book} onClose={() => setBook(null)} />;
  else if (mode === 'cards') screen = <Cards onClose={close} />;
  else if (mode === 'learn') screen = <Learn onClose={close} />;
  else if (mode === 'test') screen = <Test onClose={close} />;
  else if (mode === 'match') screen = <Match onClose={close} />;
  else if (mode === 'listen') screen = <Listen onClose={close} />;
  else if (mode === 'dictation') screen = <Dictation onClose={close} />;
  else if (mode === 'words') screen = <WordsScreen onClose={close} />;
  else if (mode === 'kits') screen = <Kits onClose={close} />;
  else
    screen = (
      <>
        {tab === 'books' && <Library onOpen={setBook} />}
        {tab === 'vocabulary' && <Vocabulary onStudy={setMode} />}
        {tab === 'progress' && <Progress />}
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

  const notice = notices[0];
  return (
    <>
      {screen}
      {notice && (
        <p className="toast notice" role="status">
          {notice.text}
          {notice.achievement && (
            <button
              type="button"
              className="text"
              onClick={() => {
                setBook(null);
                setMode(null);
                setTab('progress');
                setNotices((n) => n.slice(1));
              }}
            >
              Ver
            </button>
          )}
        </p>
      )}
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
