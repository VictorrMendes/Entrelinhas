import { Check, Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AnswerOption, langName } from './Learn';
import { buildTest, isRight, type TestKind, type TestQuestion } from './rules';
import { speak } from './speech';
import { completeExercise, type Word, words } from './store';
import { ComboBadge, ProgressBar, SessionEnd, sessionStats, TopBar, useCombo } from './study';
import { grade } from './words';

type Grade = { correct: boolean; note: string };
type Step = 'setup' | 'taking' | 'results';

const KINDS: [TestKind, string][] = [
  ['choice', 'Múltipla escolha'],
  ['written', 'Escrita'],
  ['trueFalse', 'Verdadeiro ou falso'],
];

/** A test you set up (how many questions, which kinds) and get a grade for. It doesn't change the review schedule. */
export function Test({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<Word[] | null>(null);
  const [step, setStep] = useState<Step>('setup');
  const [count, setCount] = useState(0);
  const [kinds, setKinds] = useState<Set<TestKind>>(new Set(['choice', 'written', 'trueFalse']));
  const [questions, setQuestions] = useState<TestQuestion<Word>[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  // written answers the strict check refused, as graded by the AI, by question index
  const [graded, setGraded] = useState<Record<number, Grade>>({});
  const [end, setEnd] = useState<ReturnType<ReturnType<typeof useCombo>['finish']> | null>(null);
  const combo = useCombo();

  useEffect(() => {
    words().then((w) => {
      setAll(w);
      setCount(Math.min(10, w.length));
    });
  }, []);

  useEffect(() => {
    if (step === 'results') completeExercise();
  }, [step]);

  function start() {
    if (!all) return;
    setQuestions(buildTest(all, all, count, kinds));
    setAnswers([]);
    setGraded({});
    combo.reset();
    setStep('taking');
  }

  function onAnswer(answer: string, ai: Grade | null) {
    const i = answers.length;
    combo.answer(isRight(questions[i], answer) || ai?.correct === true);
    if (ai) setGraded((g) => ({ ...g, [i]: ai }));
    const next = [...answers, answer];
    setAnswers(next);
    if (next.length === questions.length) {
      setEnd(combo.finish());
      setStep('results');
    }
  }

  const title = step === 'taking' ? `Avaliar · ${answers.length + 1}/${questions.length}` : 'Avaliar';
  return (
    <main className="study">
      <TopBar title={title} onClose={onClose} />
      {step === 'setup' && all && <Setup available={all.length} count={count} setCount={setCount} kinds={kinds} setKinds={setKinds} onStart={start} />}
      {step === 'taking' && (
        <>
          <ProgressBar done={answers.length} total={questions.length} />
          <ComboBadge current={combo.current} lost={combo.lost} />
          <QuestionView key={answers.length} q={questions[answers.length]} onAnswer={onAnswer} />
        </>
      )}
      {step === 'results' && end && <Results questions={questions} answers={answers} graded={graded} end={end} onMore={start} onClose={onClose} />}
    </main>
  );
}

function Setup(props: {
  available: number;
  count: number;
  setCount: (n: number) => void;
  kinds: Set<TestKind>;
  setKinds: (k: Set<TestKind>) => void;
  onStart: () => void;
}) {
  const counts = [...new Set([...[5, 10, 20].filter((n) => n < props.available), props.available])];
  return (
    <div className="study-body">
      <h2 className="setup-title">Monte seu teste</h2>
      <h3 className="label">Quantas perguntas</h3>
      <div className="pills">
        {counts.map((n) => (
          <button type="button" key={n} className={`pill${props.count === n ? ' on' : ''}`} onClick={() => props.setCount(n)}>
            {n === props.available ? `Todas (${n})` : n}
          </button>
        ))}
      </div>
      <h3 className="label">Tipos de pergunta</h3>
      {KINDS.map(([kind, label]) => (
        <label key={kind} className="switch-row">
          {label}
          <input
            type="checkbox"
            className="switch"
            checked={props.kinds.has(kind)}
            onChange={(e) => {
              const next = new Set(props.kinds);
              if (e.target.checked) next.add(kind);
              else next.delete(kind);
              if (next.size) props.setKinds(next); // at least one kind stays on
            }}
          />
        </label>
      ))}
      <button type="button" className="button primary wide" disabled={props.count === 0} onClick={props.onStart}>
        Começar teste
      </button>
    </div>
  );
}

function QuestionView({ q, onAnswer }: { q: TestQuestion<Word>; onAnswer: (answer: string, ai: Grade | null) => void }) {
  const [typed, setTyped] = useState('');
  const [grading, setGrading] = useState(false);
  const w = q.word;

  async function send() {
    if (!typed.trim() || grading) return;
    if (isRight(q, typed)) return onAnswer(typed, null);
    // refused by the strict check: the AI may still accept a synonym or another form of the word
    setGrading(true);
    onAnswer(typed, await grade(w.original, w.translated, typed, w.src));
  }

  return (
    <div className="study-body">
      <div className="question-head">
        <h2>{q.kind === 'written' ? w.translated : w.original}</h2>
        {q.kind !== 'written' && (
          <button type="button" className="icon" aria-label="Ouvir pronúncia" onClick={() => speak(w.original, w.src)}>
            <Volume2 />
          </button>
        )}
      </div>
      {q.kind === 'choice' && (
        <>
          <p className="verdict">Escolha o significado</p>
          {q.options.map((o) => (
            <AnswerOption key={o} text={o} state={null} onClick={() => onAnswer(o, null)} />
          ))}
        </>
      )}
      {q.kind === 'written' && (
        <>
          <p className="verdict">Escreva a palavra em {langName(w.src)}</p>
          <input
            className="answer-input"
            placeholder="Sua resposta"
            value={typed}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button type="button" className="button primary wide" disabled={!typed.trim() || grading} onClick={send}>
            {grading ? 'Conferindo…' : 'Responder'}
          </button>
        </>
      )}
      {q.kind === 'trueFalse' && (
        <>
          <p className="verdict">significa</p>
          <h2 className="shown">{q.shown}</h2>
          <div className="tf">
            <button type="button" className="button outline" onClick={() => onAnswer('true', null)}>
              Verdadeiro
            </button>
            <button type="button" className="button outline" onClick={() => onAnswer('false', null)}>
              Falso
            </button>
          </div>
        </>
      )}
      <button type="button" className="button text-only wide" disabled={grading} onClick={() => onAnswer('', null)}>
        Não sei
      </button>
    </div>
  );
}

const tf = (s: string) => (s === 'true' ? 'Verdadeiro' : 'Falso');

function Results(props: {
  questions: TestQuestion<Word>[];
  answers: string[];
  graded: Record<number, Grade>;
  end: ReturnType<ReturnType<typeof useCombo>['finish']>;
  onMore: () => void;
  onClose: () => void;
}) {
  const { questions, answers, graded, end } = props;
  const right = questions.filter((q, i) => isRight(q, answers[i]) || graded[i]?.correct).length;
  const score = right / Math.max(1, questions.length);
  const title = score >= 0.9 ? 'Excelente!' : score >= 0.7 ? 'Muito bem!' : score >= 0.5 ? 'Bom começo' : 'Vale praticar mais';
  return (
    <div className="study-body">
      <SessionEnd
        title={title}
        stats={sessionStats(questions.length, right, end.seconds)}
        accolades={end.accolades}
        bestCombo={end.best}
        onMore={props.onMore}
        onDone={props.onClose}
      />
      <h3 className="label">Suas respostas</h3>
      {questions.map((q, i) => {
        const answer = answers[i];
        const ai = graded[i];
        const ok = isRight(q, answer) || ai?.correct === true;
        const correct =
          q.kind === 'choice'
            ? q.word.translated
            : q.kind === 'written'
              ? q.word.original
              : `${tf(String(q.shown === q.word.translated.trim()))} · ${q.word.original} = ${q.word.translated}`;
        return (
          <div key={`${q.word.key}-${i}`} className={`card review ${ok ? 'right' : 'wrong'}`}>
            <strong>{q.kind === 'written' ? q.word.translated : q.kind === 'trueFalse' ? `${q.word.original} = ${q.shown}?` : q.word.original}</strong>
            <span className="given">
              {ok ? <Check size={18} /> : <X size={18} />}
              {!answer.trim() ? 'Sem resposta' : q.kind === 'trueFalse' ? tf(answer) : answer}
            </span>
            {ai?.note && <span className="muted small">{ai.correct ? `Aceita pela IA: ${ai.note}` : `IA: ${ai.note}`}</span>}
            {ai?.correct && q.kind === 'written' && <span className="muted">Palavra estudada: {q.word.original}</span>}
            {!ok && <span className="muted">Certa: {correct}</span>}
          </div>
        );
      })}
    </div>
  );
}
