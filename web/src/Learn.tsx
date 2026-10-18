import { Check, RotateCcw, Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { closeEnough, type PracticeQuestion, PracticeRound, practiceWords } from './rules';
import { speak } from './speech';
import { answer, completeExercise, dueWords, type Word, words } from './store';
import { ComboBadge, ProgressBar, SessionEnd, sessionStats, TopBar, useCombo } from './study';
import { grade } from './words';

const NEXT_AFTER_RIGHT_MS = 700;

const languages = new Intl.DisplayNames(['pt-BR'], { type: 'language' });
export const langName = (code: string) => languages.of(code) ?? code;

/** The answer to the question on screen: [right] or not, [exact] unless a typo was forgiven, [note] from the AI when it graded it. */
interface Verdict {
  right: boolean;
  exact: boolean;
  typed?: string;
  note?: string;
}

async function newRound() {
  const all = await words();
  return new PracticeRound(practiceWords(all, await dueWords()), all);
}

/**
 * "Aprender": a round over saved words. Each word is first recognized (its meaning among four) and later recalled (typed
 * from its meaning). A miss stops on the right answer until "Continuar". At the end, words without a miss move up a
 * Leitner box and the others go back to today's review.
 */
export function Learn({ onClose }: { onClose: () => void }) {
  const [round, setRound] = useState<PracticeRound<Word> | null>(null);
  // the round is a plain object; this counter makes the screen read it again after every answer
  const [step, setStep] = useState(0);
  const [end, setEnd] = useState<ReturnType<ReturnType<typeof useCombo>['finish']> | null>(null);
  const combo = useCombo();

  const start = async () => {
    setRound(await newRound());
    setEnd(null);
    combo.reset();
    setStep((s) => s + 1);
  };
  useEffect(() => {
    start();
  }, []);

  const question = round?.current;
  return (
    <main className="study">
      <TopBar title="Aprender" onClose={onClose} />
      {question && (
        <>
          <ProgressBar done={round.done} total={round.total} />
          <ComboBadge current={combo.current} lost={combo.lost} />
        </>
      )}
      <div className="study-body">
        {round && !question && end && <Summary round={round} end={end} onAgain={start} onDone={onClose} />}
        {question && (
          <Question
            key={step}
            q={question}
            onVerdict={combo.answer}
            onAnswered={(right) => {
              round.answer(right);
              if (!round.current) setEnd(combo.finish());
              setStep((s) => s + 1);
            }}
          />
        )}
      </div>
    </main>
  );
}

function blankOut(sentence: string, word: string): string | null {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blanked = sentence.replace(new RegExp(escaped, 'gi'), '_____');
  return blanked === sentence ? null : blanked;
}

function Question({ q, onVerdict, onAnswered }: { q: PracticeQuestion<Word>; onVerdict: (right: boolean) => void; onAnswered: (right: boolean) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [grading, setGrading] = useState(false);
  const w = q.word;
  const expected = q.stage === 'choice' ? w.translated.trim() : w.original;

  // the combo counts the answer as soon as it's judged; a right answer moves on by itself, a wrong one waits for "Continuar"
  useEffect(() => {
    if (!verdict) return;
    onVerdict(verdict.right);
    if (verdict.right && verdict.exact) {
      const t = window.setTimeout(() => onAnswered(true), NEXT_AFTER_RIGHT_MS);
      return () => clearTimeout(t);
    }
  }, [verdict]);

  async function check() {
    if (!typed.trim() || grading) return;
    if (closeEnough(w.original, typed)) {
      setVerdict({ right: true, exact: typed.trim().toLowerCase() === w.original.trim().toLowerCase(), typed });
      return;
    }
    // refused by the strict check: the AI may still accept a synonym or another form of the word
    setGrading(true);
    const g = await grade(w.original, w.translated, typed, w.src);
    setGrading(false);
    setVerdict({ right: g?.correct === true, exact: false, typed, note: g?.note || undefined });
  }

  const v = verdict;
  const message = !v
    ? q.stage === 'choice'
      ? 'Escolha o significado'
      : `Escreva a palavra em ${langName(w.src)}`
    : v.right && v.exact
      ? 'Isso!'
      : v.right && v.note
        ? `Também vale! A palavra estudada é ${expected}`
        : v.right
          ? `Quase! Escreve-se ${expected}`
          : picked === null && v.typed === undefined
            ? 'Essa é a resposta. Ela volta mais tarde nesta rodada.'
            : 'Errado. Ela volta mais tarde nesta rodada.';
  const hint = q.stage === 'written' && w.example ? blankOut(w.example, w.original) : null;

  return (
    <>
      <div className="question-head">
        <h2>{q.stage === 'choice' ? w.original : w.translated}</h2>
        {(q.stage === 'choice' || v) && (
          <button type="button" className="icon" aria-label="Ouvir pronúncia" onClick={() => speak(w.original, w.src)}>
            <Volume2 />
          </button>
        )}
      </div>
      <p className={`verdict${v ? (v.right ? ' right' : ' wrong') : ''}`}>{message}</p>

      {q.stage === 'choice' ? (
        q.options.map((option) => (
          <AnswerOption
            key={option}
            text={option}
            state={!v ? null : option === expected ? true : option === picked ? false : null}
            disabled={!!v}
            onClick={() => {
              setPicked(option);
              setVerdict({ right: option === expected, exact: true });
            }}
          />
        ))
      ) : (
        <>
          {hint && <p className="hint-sentence">{hint}</p>}
          <input
            className="answer-input"
            placeholder="Sua resposta"
            value={typed}
            disabled={!!v}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && check()}
          />
          {v?.note && <p className="muted">{v.note}</p>}
          {v && !v.right && (
            <>
              <AnswerOption text={expected} state disabled />
              {v.typed && <AnswerOption text={v.typed} state={false} disabled />}
            </>
          )}
          {!v && (
            <button type="button" className="button primary wide" disabled={!typed.trim() || grading} onClick={check}>
              {grading ? 'Conferindo…' : 'Conferir'}
            </button>
          )}
        </>
      )}

      {!v ? (
        <button type="button" className="button text-only wide" onClick={() => setVerdict({ right: false, exact: true })}>
          Não sei
        </button>
      ) : (
        (!v.exact || !v.right) && (
          <button type="button" className="button primary wide" onClick={() => onAnswered(v.right)}>
            Continuar
          </button>
        )
      )}
    </>
  );
}

/** A choice, or an answer shown after the fact: [state] true marks it right, false wrong, null neutral. */
export function AnswerOption({ text, state, disabled, onClick }: { text: string; state: boolean | null; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`option${state === true ? ' right' : state === false ? ' wrong' : ''}`} disabled={disabled} onClick={onClick}>
      {state === true && <Check size={20} />}
      {state === false && <X size={20} />}
      {text}
    </button>
  );
}

function Summary({
  round,
  end,
  onAgain,
  onDone,
}: {
  round: PracticeRound<Word>;
  end: ReturnType<ReturnType<typeof useCombo>['finish']>;
  onAgain: () => void;
  onDone: () => void;
}) {
  // the round counts as a review: no miss moves a word up a box, a miss sends it back to today's queue
  useEffect(() => {
    (async () => {
      for (const w of round.words) await answer(w, !round.missed.has(w.key));
      await completeExercise();
    })();
  }, [round]);
  const clean = round.words.filter((w) => !round.missed.has(w.key)).length;
  return (
    <>
      <SessionEnd
        title="Rodada concluída!"
        stats={sessionStats(round.words.length, clean, end.seconds)}
        accolades={end.accolades}
        bestCombo={end.best}
        onMore={onAgain}
        onDone={onDone}
      />
      {/* without a miss the 100% already says it all */}
      {clean < round.words.length && (
        <p className="muted">
          {clean} de {round.words.length} palavras sem nenhum erro. As que você errou voltam para a revisão de hoje.
        </p>
      )}
      <ul className="summary-words">
        {round.words.map((w) => {
          const missed = round.missed.has(w.key);
          return (
            <li key={w.key}>
              <span className={`dot ${missed ? 'learning' : 'known'}`}>{missed ? <RotateCcw size={18} /> : <Check size={18} />}</span>
              <span>
                <strong>{w.original}</strong>
                <span className="muted">{w.translated}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
