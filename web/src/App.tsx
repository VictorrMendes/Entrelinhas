import barChartSvg from '@material-design-icons/svg/filled/bar_chart.svg?raw';
import bookmarksSvg from '@material-design-icons/svg/outlined/bookmarks.svg?raw';
import menuBookSvg from '@material-design-icons/svg/outlined/menu_book.svg?raw';
import settingsSvg from '@material-design-icons/svg/outlined/settings.svg?raw';
import { useEffect, useState } from 'react';
import { Cards } from './Cards';
import { sync } from './cloud';
import { FreeBooks } from './FreeBooks';
import { Kits } from './Kits';
import { Learn } from './Learn';
import { Library } from './Library';
import { Listen } from './Listen';
import { Match } from './Match';
import { type Notice, onNotice } from './notices';
import { Onboarding, onboarded } from './Onboarding';
import { Progress } from './Progress';
import { Reader } from './Reader';
import { Settings, SignInSheet } from './Settings';
import { type Book, celebrations, onChange } from './store';
import { Test } from './Test';
import { Icon } from './ui';
import { type StudyMode, Vocabulary, WordsScreen } from './Vocabulary';

type Tab = 'books' | 'vocabulary' | 'progress' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'books', label: 'Livros', icon: menuBookSvg },
  { id: 'vocabulary', label: 'Vocabulário', icon: bookmarksSvg },
  { id: 'progress', label: 'Progresso', icon: barChartSvg },
  { id: 'settings', label: 'Ajustes', icon: settingsSvg },
];

/** The Android app's layout: four tabs below, and the reader or a study mode over them. */
export function App() {
  const [tab, setTab] = useState<Tab>('books');
  const [book, setBook] = useState<Book | null>(null);
  const [mode, setMode] = useState<StudyMode | null>(null);
  const [exploring, setExploring] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [welcome, setWelcome] = useState(() => !onboarded());
  const [signingIn, setSigningIn] = useState(false);
  const close = () => setMode(null);
  const openProgress = () => {
    setBook(null);
    setMode(null);
    setTab('progress');
  };

  // like the Android app: a quiet sync when the app starts, then the notices anything else sends
  useEffect(() => {
    sync(true);
    return onNotice((n) => setNotices((q) => [...q, n]));
  }, []);

  // counters settle a moment after each change (reading time ticks, a review round), so check once things are quiet
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const found = (await celebrations()).map((c): Notice => ({ text: c.text, ...(c.achievement && { action: { label: 'Ver', run: openProgress } }) }));
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
  if (welcome)
    screen = (
      <Onboarding
        onSignIn={() => setSigningIn(true)}
        onDone={() => {
          localStorage.setItem('onboarded', '1');
          setWelcome(false);
        }}
      />
    );
  else if (book)
    screen = (
      <Reader
        book={book}
        onClose={() => setBook(null)}
        onVocabulary={() => {
          setBook(null);
          setTab('vocabulary');
        }}
      />
    );
  else if (mode === 'cards') screen = <Cards onClose={close} />;
  else if (mode === 'learn') screen = <Learn onClose={close} />;
  else if (mode === 'test') screen = <Test onClose={close} />;
  else if (mode === 'match') screen = <Match onClose={close} />;
  else if (mode === 'listen') screen = <Listen onClose={close} />;
  else if (mode === 'words') screen = <WordsScreen onClose={close} />;
  else if (mode === 'kits') screen = <Kits onClose={close} />;
  else if (exploring)
    screen = (
      <FreeBooks
        onClose={() => setExploring(false)}
        onOpen={(b) => {
          setExploring(false);
          setBook(b);
        }}
      />
    );
  else
    screen = (
      <>
        {tab === 'books' && (
          <Library onOpen={setBook} onReview={() => setMode('cards')} onExplore={() => setExploring(true)} />
        )}
        {tab === 'vocabulary' && <Vocabulary onStudy={setMode} />}
        {tab === 'progress' && <Progress />}
        {tab === 'settings' && <Settings />}
        <nav className="tabs">
          {TABS.map(({ id, label, icon }) => (
            <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              <span className="tab-icon">
                <Icon svg={icon} size={22} />
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
      {signingIn && (
        <SignInSheet
          onDone={() => {
            setSigningIn(false);
            sync();
          }}
          onClose={() => setSigningIn(false)}
        />
      )}
      {notice && (
        <p className="toast notice" role="status">
          {notice.text}
          {notice.action && (
            <button
              type="button"
              className="text"
              onClick={() => {
                notice.action?.run();
                setNotices((n) => n.slice(1));
              }}
            >
              {notice.action.label}
            </button>
          )}
        </p>
      )}
    </>
  );
}

