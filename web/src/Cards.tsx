import { Check, Headphones, MenuBook, Refresh, VolumeUp } from './icons';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { shuffle } from './rules';
import { speak } from './speech';
import { answer, completeExercise, dueWords, type Word, words } from './store';
import { ProgressBar, StudyDone, TopBar } from './study';

/** The example sentence with the studied word in bold. */
export function Example({ sentence, word }: { sentence: string; word: string }) {
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  return (
    <p className="example">
      “{i < 0 ? sentence : sentence.slice(0, i)}
      {i >= 0 && <strong>{sentence.slice(i, i + word.length)}</strong>}
      {i >= 0 && sentence.slice(i + word.length)}”
    </p>
  );
}

export function BookLine({ title }: { title: string }) {
  return (
    <p className="book-line body-medium">
      <MenuBook size={22} /> <span className="clamp-2">{title}</span>
    </p>
  );
}

/**
 * Flashcards: tap to flip, swipe right when you knew it and left when you're still learning it. Due words are a real
 * review (Leitner); with nothing due, every word goes round as free practice that leaves the schedule alone.
 */
export function Cards({ onClose }: { onClose: () => void }) {
  const [deck, setDeck] = useState<{ queue: Word[]; total: number; scheduled: boolean } | null>(null);
  const [learning, setLearning] = useState<Set<string>>(new Set());
  const [known, setKnown] = useState(0);
  const [turn, setTurn] = useState(0);
  const [listenFirst, setListenFirst] = useState(localStorage.getItem('listenFirst') === '1');

  useEffect(() => {
    (async () => {
      const due = await dueWords();
      const queue = due.length ? due : shuffle(await words());
      setDeck({ queue, total: queue.length, scheduled: due.length > 0 });
    })();
  }, []);

  const finished = deck !== null && deck.queue.length === 0;
  useEffect(() => {
    if (finished && deck.total > 0) completeExercise();
  }, [finished, deck]);

  function answerCard(knew: boolean) {
    if (!deck) return;
    const [w, ...rest] = deck.queue;
    if (deck.scheduled) answer(w, knew);
    if (knew) setKnown((k) => k + 1);
    else {
      setLearning((l) => new Set(l).add(w.key));
      rest.push(w); // a card still being learned comes back at the end
    }
    setDeck({ ...deck, queue: rest });
    setTurn((t) => t + 1);
  }

  const toggleListen = () => {
    localStorage.setItem('listenFirst', listenFirst ? '0' : '1');
    setListenFirst(!listenFirst);
  };

  return (
    <main className="study">
      <TopBar
        title="Cartões"
        onClose={onClose}
        trailing={
          <button type="button" className={`icon${listenFirst ? ' on' : ''}`} aria-label="Começar pelo áudio" aria-pressed={listenFirst} onClick={toggleListen}>
            <Headphones />
          </button>
        }
      />
      <ProgressBar done={known} total={deck?.total ?? 0} />
      {finished ? (
        <StudyDone title="Cartões concluídos!" text={`${known} cartões revisados · ${learning.size} precisaram de mais uma volta`} onClose={onClose} />
      ) : (
        deck && (
          <>
            <div className="counts">
              <span className="count learning">
                <b>{learning.size}</b> Aprendendo
              </span>
              <span className="count known">
                <b>{known}</b> Sei
              </span>
            </div>
            {!deck.scheduled && <p className="note">Nada para revisar hoje: este treino não mexe na sua agenda de revisão.</p>}
            <SwipeCard key={turn} word={deck.queue[0]} listenFirst={listenFirst} onDone={answerCard} />
            <div className="round-buttons">
              <button type="button" className="round learning" onClick={() => answerCard(false)}>
                <Refresh />
                <span>Aprendendo</span>
              </button>
              <button type="button" className="round known" onClick={() => answerCard(true)}>
                <Check />
                <span>Sei</span>
              </button>
            </div>
            <p className="note">Toque para virar · arraste: ← aprendendo, sei →</p>
          </>
        )
      )}
    </main>
  );
}

function SwipeCard({ word, listenFirst, onDone }: { word: Word; listenFirst: boolean; onDone: (knew: boolean) => void }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flipped, setFlipped] = useState(false);
  // listening first: the front only plays the word until the reader asks to see it
  const [heard, setHeard] = useState(!listenFirst);
  const start = useRef<number | null>(null);
  // the drag's offset as of the last pointer event; the state copy only moves the card on screen
  const offset = useRef(0);
  const moved = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const say = () => speak(word.original, word.src);

  useEffect(() => {
    if (listenFirst) say();
  }, []);

  const move = (d: number) => {
    offset.current = d;
    setDx(d);
  };
  const onDown = (e: PointerEvent) => {
    start.current = e.clientX;
    moved.current = false;
    setDragging(true);
  };
  const onMove = (e: PointerEvent) => {
    if (start.current === null) return;
    const d = e.clientX - start.current;
    if (Math.abs(d) > 8) moved.current = true;
    move(d);
  };
  const onUp = () => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    const d = offset.current;
    const width = ref.current?.offsetWidth ?? 300;
    if (Math.abs(d) > width * 0.28) {
      move(Math.sign(d) * width * 1.4);
      window.setTimeout(() => onDone(d > 0), 160);
    } else move(0);
  };
  const lean = dx > 40 ? 'known' : dx < -40 ? 'learning' : '';
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      ref={ref}
      className={`swipe ${lean}`}
      style={{ transform: `translateX(${dx}px) rotate(${dx / 60}deg)`, transition: dragging ? 'none' : 'transform 0.2s' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={() => !moved.current && setFlipped(!flipped)}
    >
      <div className={`flip${flipped ? ' flipped' : ''}`}>
        <div className="face front">
          {heard ? (
            <>
              <button type="button" className="icon corner" aria-label="Ouvir pronúncia" onPointerDown={stop} onClick={(e) => (stop(e), say())}>
                <VolumeUp />
              </button>
              <h2>{word.original}</h2>
            </>
          ) : (
            <div className="listen-first">
              <button type="button" className="big-play" aria-label="Ouvir pronúncia" onPointerDown={stop} onClick={(e) => (stop(e), say())}>
                <VolumeUp size={40} />
              </button>
              <p className="muted">Ouça e tente lembrar o significado</p>
              <button type="button" className="text" onPointerDown={stop} onClick={(e) => (stop(e), setHeard(true))}>
                Mostrar
              </button>
            </div>
          )}
        </div>
        <div className="face back">
          <h2>{word.translated}</h2>
          {word.example && <Example sentence={word.example} word={word.original} />}
          {word.bookTitle && <BookLine title={word.bookTitle} />}
        </div>
      </div>
    </div>
  );
}
