/** Pieces every study mode shares (the Android app's Study.kt and SessionEnd.kt). */
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type Accolade, COMBO_MIN, sessionAccolades } from './rules';

/** Close on the left, title in the middle, [trailing] (or an equal gap, to keep the title centered) on the right. */
export function TopBar({ title, onClose, trailing }: { title: string; onClose: () => void; trailing?: ReactNode }) {
  return (
    <header className="study-top">
      <button type="button" className="icon" aria-label="Fechar" onClick={onClose}>
        <X />
      </button>
      <h1>{title}</h1>
      {trailing ?? <span className="icon" />}
    </header>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
    </div>
  );
}

const initial = { current: 0, best: 0, lost: 0, answers: 0, misses: 0 };

/** Right answers in a row during a round, the round's best, and a combo that just broke (to say so). */
export function useCombo() {
  // the counts live in a ref, so finish() sees the last answer even when called from an older render's timer;
  // the state copy only redraws the badge
  const counts = useRef(initial);
  const [c, setC] = useState(initial);
  const startedAt = useRef(Date.now());
  const set = (next: typeof initial) => {
    counts.current = next;
    setC(next);
  };
  return {
    ...c,
    answer(right: boolean) {
      const s = counts.current;
      set(
        right
          ? { ...s, answers: s.answers + 1, current: s.current + 1, best: Math.max(s.best, s.current + 1), lost: 0 }
          : { ...s, answers: s.answers + 1, misses: s.misses + 1, lost: s.current >= COMBO_MIN ? s.current : 0, current: 0 },
      );
    },
    /** The round's accolades and length; a new best combo becomes the record. Call once, when the round ends. */
    finish(): { accolades: Accolade[]; seconds: number; best: number } {
      const s = counts.current;
      const seconds = Math.round((Date.now() - startedAt.current) / 1000);
      const record = Number(localStorage.getItem('bestCombo') ?? 0);
      if (s.best > record) localStorage.setItem('bestCombo', String(s.best));
      return { accolades: sessionAccolades(s.answers, s.misses, seconds, s.best, record), seconds, best: s.best };
    },
    reset() {
      set(initial);
      startedAt.current = Date.now();
    },
  };
}

export function ComboBadge({ current, lost }: { current: number; lost: number }) {
  if (current >= COMBO_MIN) return <p className="combo on">🔥 {current} seguidas</p>;
  if (lost > 0) return <p className="combo">Combo de {lost} perdido</p>;
  return null;
}

/** A finished round's words, accuracy and minutes (rounded up, at least 1). */
export function sessionStats(words: number, right: number, seconds: number) {
  return [
    { value: words, label: words === 1 ? 'palavra' : 'palavras' },
    { value: Math.floor((right * 100) / Math.max(1, words)), label: '% de acerto' },
    { value: Math.max(1, Math.ceil(seconds / 60)), label: 'min' },
  ];
}

const ACCOLADES: Record<Accolade, { emoji: string; texts: ((n: number) => string)[] }> = {
  perfect: { emoji: '🎯', texts: [() => 'Sem erros!', () => 'Rodada perfeita!', () => 'Nenhum deslize. Impecável!'] },
  fast: { emoji: '⚡', texts: [() => 'Rápido como um raio', () => 'Que velocidade!', () => 'Respostas na ponta da língua'] },
  comboRecord: {
    emoji: '🔥',
    texts: [(n) => `Novo recorde: ${n} seguidas`, (n) => `${n} seguidas! Seu melhor combo`, (n) => `Recorde batido: ${n} seguidas`],
  },
};

function CountUp({ value, delay }: { value: number; delay: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / 800));
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, delay]);
  return <>{shown}</>;
}

/** The end of a study round: numbers counting up, what the round earned and an invite to one more. */
export function SessionEnd(props: {
  title: string;
  stats: { value: number; label: string }[];
  accolades: Accolade[];
  bestCombo: number;
  onMore: (() => void) | null;
  onDone: () => void;
}) {
  // the accolades pop in one by one once the numbers are mostly up
  const [shown, setShown] = useState(0);
  const [texts] = useState(() => props.accolades.map((a) => ACCOLADES[a].texts[Math.floor(Math.random() * 3)]));
  useEffect(() => {
    const timers = props.accolades.map((_, i) => window.setTimeout(() => setShown(i + 1), 900 + i * 350));
    return () => timers.forEach(clearTimeout);
  }, [props.accolades]);
  return (
    <div className="session-end">
      <img src="/celebrate.png" alt="" width={96} height={96} />
      <h2>{props.title}</h2>
      <div className="stats">
        {props.stats.map((s, i) => (
          <div key={s.label} className="card stat">
            <strong>
              <CountUp value={s.value} delay={i * 120} />
            </strong>
            <span className="muted">{s.label}</span>
          </div>
        ))}
      </div>
      {props.accolades.slice(0, shown).map((a, i) => (
        <div key={a} className="card accolade">
          <span className={`accolade-icon ${a}`}>{ACCOLADES[a].emoji}</span>
          <strong>{texts[i](props.bestCombo)}</strong>
        </div>
      ))}
      {props.onMore ? (
        <>
          <button type="button" className="button primary wide" onClick={props.onMore}>
            Mais 5 min
          </button>
          <button type="button" className="button outline wide" onClick={props.onDone}>
            Concluir
          </button>
        </>
      ) : (
        <button type="button" className="button primary wide" onClick={props.onDone}>
          Concluir
        </button>
      )}
    </div>
  );
}

/** The end of a session without a score: the celebration picture, a line of results and a way out. */
export function StudyDone({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <div className="session-end centered">
      <img src="/celebrate.png" alt="" width={120} height={120} />
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      <button type="button" className="button primary wide" onClick={onClose}>
        Concluir
      </button>
    </div>
  );
}
