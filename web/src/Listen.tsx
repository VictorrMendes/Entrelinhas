import { Gauge, Pause, Play, Quote, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { speechRate } from './Dictation';
import { speak } from './speech';
import { dueWords, type Word, words } from './store';
import { ProgressBar, TopBar } from './study';

const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5];
const rateLabel = (r: number) => `${r}x`.replace('.', ',');
const PAUSE_BEFORE_MEANING_MS = 900;
const PAUSE_BEFORE_EXAMPLE_MS = 500;
const PAUSE_BETWEEN_WORDS_MS = 1300;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Ouvir": each word read aloud, then its meaning (and example), one after another, like a podcast of your vocabulary. */
export function Listen({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // the meaning shows once it is being said, so the listener gets a moment to recall it
  const [showMeaning, setShowMeaning] = useState(false);
  const [examples, setExamples] = useState(localStorage.getItem('listenExamples') !== '0');
  const [rate, setRate] = useState(speechRate());
  // each play gets a number; a newer play or a pause makes the older loop stop at its next step
  const run = useRef(0);

  useEffect(() => {
    (async () => {
      const due = await dueWords();
      const seen = new Set(due.map((w) => w.key));
      setList([...due, ...(await words()).filter((w) => !seen.has(w.key))]);
    })();
    return () => {
      run.current++;
      speechSynthesis.cancel();
    };
  }, []);

  async function play(from: number) {
    const me = ++run.current;
    speechSynthesis.cancel();
    setPlaying(true);
    for (let i = from; i < list.length && run.current === me; i++) {
      const w = list[i];
      setIndex(i);
      setShowMeaning(false);
      await speak(w.original, w.src, rate);
      await wait(PAUSE_BEFORE_MEANING_MS);
      if (run.current !== me) return;
      setShowMeaning(true);
      await speak(w.translated, w.tgt, rate);
      if (examples && w.example && run.current === me) {
        await wait(PAUSE_BEFORE_EXAMPLE_MS);
        if (run.current === me) await speak(w.example, w.src, rate);
      }
      await wait(PAUSE_BETWEEN_WORDS_MS);
    }
    if (run.current === me) setPlaying(false);
  }

  function pause() {
    run.current++;
    speechSynthesis.cancel();
    setPlaying(false);
  }

  function move(by: number) {
    const i = Math.min(Math.max(0, index + by), list.length - 1);
    setIndex(i);
    setShowMeaning(false);
    if (playing) play(i);
  }

  const word = list[index];
  return (
    <main className="study">
      <TopBar title="Ouvir" onClose={onClose} />
      <ProgressBar done={word ? index + 1 : 0} total={list.length} />
      <p className="muted center">
        {index + 1} de {list.length}
      </p>
      <div className="card listen-card">
        {word && (
          <>
            <h2>{word.original}</h2>
            <p className="meaning">{showMeaning ? word.translated : '…'}</p>
            {showMeaning && examples && word.example && <p className="example">“{word.example}”</p>}
          </>
        )}
      </div>
      <div className="row center">
        <button
          type="button"
          className={`chip-button${examples ? ' on' : ''}`}
          onClick={() => {
            localStorage.setItem('listenExamples', examples ? '0' : '1');
            setExamples(!examples);
          }}
        >
          <Quote size={18} /> Frase de exemplo
        </button>
        <button
          type="button"
          className="chip-button"
          onClick={() => {
            const next = SPEECH_RATES[(SPEECH_RATES.indexOf(rate) + 1) % SPEECH_RATES.length];
            localStorage.setItem('speechRate', String(next));
            setRate(next);
          }}
        >
          <Gauge size={18} /> {rateLabel(rate)}
        </button>
      </div>
      <div className="player">
        <button type="button" className="icon big" aria-label="Anterior" onClick={() => move(-1)}>
          <SkipBack size={32} />
        </button>
        <button type="button" className="big-play" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={() => (playing ? pause() : play(index))}>
          {playing ? <Pause size={40} /> : <Play size={40} />}
        </button>
        <button type="button" className="icon big" aria-label="Próxima" onClick={() => move(1)}>
          <SkipForward size={32} />
        </button>
      </div>
      <p className="note">Mantenha a tela ligada: no iPhone, a leitura para quando a tela apaga.</p>
    </main>
  );
}
