import { useEffect, useMemo, useRef, useState } from 'react';
import { type MatchTile, matchTiles } from './rules';
import { type Word, words } from './store';
import { StudyDone, TopBar } from './study';

/** 12.3, the device's way. */
export const seconds = (ms: number) => (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const matchBest = () => Number(localStorage.getItem('matchBest') ?? 0);

/** Six words and their meanings shuffled on a grid; match every pair as fast as you can. The best time is kept. */
export function Match({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<Word[]>([]);
  const [round, setRound] = useState(0);
  const [started, setStarted] = useState(false);
  const tiles: MatchTile[] = useMemo(() => matchTiles(all), [all, round]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [wrong, setWrong] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [record, setRecord] = useState(false);
  const startAt = useRef(0);
  const finished = tiles.length > 0 && matched.size * 2 === tiles.length;

  useEffect(() => {
    words().then(setAll);
  }, []);

  useEffect(() => {
    if (!started) return;
    if (finished) {
      const ms = Date.now() - startAt.current;
      setElapsed(ms);
      const best = matchBest();
      setRecord(best === 0 || ms < best);
      if (best === 0 || ms < best) localStorage.setItem('matchBest', String(ms));
      return;
    }
    const timer = window.setInterval(() => setElapsed(Date.now() - startAt.current), 100);
    return () => clearInterval(timer);
  }, [started, finished]);

  function begin() {
    setMatched(new Set());
    setSelected(null);
    setWrong([]);
    setElapsed(0);
    startAt.current = Date.now();
    setStarted(true);
  }

  function tap(i: number) {
    const other = selected;
    if (other === null) setSelected(i);
    else if (other === i) setSelected(null);
    else if (tiles[other].pair === tiles[i].pair) {
      setMatched((m) => new Set(m).add(tiles[i].pair));
      setSelected(null);
    } else {
      setSelected(null);
      setWrong([i, other]);
      window.setTimeout(() => setWrong([]), 450);
    }
  }

  const best = matchBest();
  return (
    <main className="study">
      <TopBar title={started && !finished ? `${seconds(elapsed)} s` : 'Combinar'} onClose={onClose} />
      {!started ? (
        <div className="session-end centered">
          <h2 className="intro">Junte cada palavra ao seu significado o mais rápido que puder.</h2>
          {best > 0 && <p className="muted">Recorde: {seconds(best)} s</p>}
          <button type="button" className="button primary wide" onClick={begin}>
            Começar
          </button>
        </div>
      ) : finished ? (
        <>
          <StudyDone
            title={record ? 'Novo recorde!' : 'Pares completos!'}
            text={`${seconds(elapsed)} s${record ? '' : `\nRecorde: ${seconds(matchBest())} s`}`}
            onClose={onClose}
          />
          <div className="study-body">
            <button
              type="button"
              className="button outline wide"
              onClick={() => {
                setRound((r) => r + 1);
                begin();
              }}
            >
              Jogar de novo
            </button>
          </div>
        </>
      ) : (
        <div className="match-grid">
          {tiles.map((t, i) => (
            <button
              type="button"
              key={`${round}-${i}`}
              className={`match-tile${i === selected ? ' selected' : ''}${wrong.includes(i) ? ' wrong' : ''}${matched.has(t.pair) ? ' gone' : ''}`}
              disabled={matched.has(t.pair)}
              onClick={() => tap(i)}
            >
              {t.text}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
