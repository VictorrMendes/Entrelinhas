/**
 * "Falar": say saved words aloud and see whether the phone's recognizer heard them right, almost or wrong (speakGrade).
 * Pronunciation isn't knowing a word: the round leaves the review boxes alone and only counts for the day's streak.
 */
import micSvg from '@material-design-icons/svg/outlined/mic.svg?raw';
import volumeSvg from '@material-design-icons/svg/outlined/volume_up.svg?raw';
import { useEffect, useState } from 'react';
import { speechRate } from './Dictation';
import { practiceWords, type SpeakGrade, speakGrade } from './rules';
import { listen, speak } from './speech';
import { completeExercise, dueWords, type Word, words } from './store';
import { ComboBadge, ProgressBar, SessionEnd, TopBar, useCombo } from './study';
import { Icon } from './ui';

const ROUND_WORDS = 10;
const TRIES = 3;
const SLOW_RATE = 0.6;
const NOT_HEARD = 'Não ouvi. Toque no 🎤 e fale de novo.';
const RANK: Record<SpeakGrade, number> = { wrong: 0, almost: 1, right: 2 };
/** Each grade in the colors of the dictation's marks (MarkedWords). */
const MARK: Record<SpeakGrade, string> = { right: 'ok', almost: 'missing', wrong: 'wrong' };

/** What a recognizer error means for the reader: a hint to try again, never a grade. */
function micHint(code: string): string {
  if (code === 'no-speech' || code === 'aborted') return NOT_HEARD;
  if (code === 'not-allowed')
    return 'O app não tem acesso ao microfone. Libere o microfone para este site nas configurações do navegador (no iPhone: Ajustes › Safari › Microfone) e tente de novo.';
  if (code === 'network') return 'Sem internet: o reconhecimento de voz precisa de conexão. Tente de novo quando estiver online.';
  if (code === 'audio-capture') return 'Não encontrei o microfone. Confira se ele está ligado e tente de novo.';
  return 'O reconhecimento de voz não está disponível agora neste aparelho.';
}

export function Speak({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Word[] | null>(null);
  const [index, setIndex] = useState(0);
  // each finished word's best grade
  const [grades, setGrades] = useState<SpeakGrade[]>([]);
  const [said, setSaid] = useState(0);
  const [end, setEnd] = useState<ReturnType<ReturnType<typeof useCombo>['finish']> | null>(null);
  const combo = useCombo();

  const start = async () => {
    const all = await words();
    setList(practiceWords(all, await dueWords(), ROUND_WORDS));
    setIndex(0);
    setGrades([]);
    setSaid(0);
    setEnd(null);
    combo.reset();
  };
  useEffect(() => {
    start();
    return () => speechSynthesis.cancel();
  }, []);

  function next(grade: SpeakGrade, tried: boolean) {
    if (!list) return;
    combo.answer(grade === 'right');
    setGrades((g) => [...g, grade]);
    const spoken = said + (tried ? 1 : 0);
    setSaid(spoken);
    if (index + 1 < list.length) return setIndex(index + 1);
    setEnd(combo.finish());
    // like the dictation, a round that was spoken counts for the day; skipping every word doesn't
    if (spoken > 0) completeExercise();
  }

  const count = (g: SpeakGrade) => grades.filter((x) => x === g).length;
  return (
    <main className="study">
      <TopBar title="Falar" onClose={onClose} />
      {list && list.length === 0 && (
        <div className="empty-state">
          <img src="/art/empty_vocabulary.png" alt="" width={128} height={128} />
          <span className="title-medium">Nenhuma palavra salva ainda</span>
          <span className="body-medium variant">Traduza uma palavra durante a leitura e toque em Salvar para treinar a pronúncia dela aqui.</span>
        </div>
      )}
      {list && list.length > 0 && !end && (
        <>
          <ProgressBar done={index} total={list.length} />
          <ComboBadge current={combo.current} lost={combo.lost} />
          <div className="study-body">
            <SpeakWord key={index} word={list[index]} last={index === list.length - 1} onDone={next} />
          </div>
        </>
      )}
      {end && (
        <div className="study-body">
          <SessionEnd
            title="Rodada concluída!"
            stats={[
              { value: count('right'), label: count('right') === 1 ? 'certa' : 'certas' },
              { value: count('almost'), label: 'quase' },
              { value: count('wrong'), label: count('wrong') === 1 ? 'errada' : 'erradas' },
            ]}
            accolades={end.accolades}
            bestCombo={end.best}
            onMore={start}
            onDone={onClose}
          />
        </div>
      )}
    </main>
  );
}

/** One word: hear it, say it up to three times, then move on with the best grade. */
function SpeakWord({ word, last, onDone }: { word: Word; last: boolean; onDone: (grade: SpeakGrade, tried: boolean) => void }) {
  const [tries, setTries] = useState(0);
  const [best, setBest] = useState<SpeakGrade>('wrong');
  const [result, setResult] = useState<ReturnType<typeof speakGrade> | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const play = (rate: number) => speak(word.original, word.src, rate);
  const finished = result?.grade === 'right' || tries >= TRIES;

  useEffect(() => {
    play(speechRate());
  }, []);

  async function say() {
    setHint(null);
    setListening(true);
    try {
      const heard = await listen(word.src);
      if (!heard.length) return setHint(NOT_HEARD);
      const r = speakGrade(word.original, heard);
      setResult(r);
      setTries((t) => t + 1);
      setBest((b) => (RANK[r.grade] > RANK[b] ? r.grade : b));
    } catch (code) {
      setHint(micHint(String(code)));
    } finally {
      setListening(false);
    }
  }

  return (
    <div className="speak">
      <p className="speak-word">{word.original}</p>
      <p className="body-large variant">{word.translated}</p>
      <div className="chip-row">
        <button type="button" className="filled-button with-icon" onClick={() => play(speechRate())}>
          <Icon svg={volumeSvg} size={18} /> Ouvir
        </button>
        <button type="button" className="outlined-button" onClick={() => play(SLOW_RATE)}>
          Ouvir devagar
        </button>
      </div>
      {result && (
        <p className="marked title-medium">
          {result.grade === 'right' && <span className={MARK.right}>Certo!</span>}
          {result.grade === 'almost' && <span className={MARK.almost}>Quase lá</span>}
          {result.grade === 'wrong' && (
            <>
              Ouvi: <span className={MARK.wrong}>{result.heard}</span>
            </>
          )}
        </p>
      )}
      {result && !finished && <p className="note">Tentativa {tries} de {TRIES}: toque no 🎤 e tente de novo.</p>}
      {hint && <p className="note">{hint}</p>}
      {!finished && (
        <button type="button" className="filled-button wide with-icon" disabled={listening} onClick={say}>
          <Icon svg={micSvg} size={20} /> {listening ? 'Ouvindo…' : 'Falar'}
        </button>
      )}
      <button type="button" className={finished ? 'filled-button wide' : 'text-button'} disabled={listening} onClick={() => onDone(best, tries > 0)}>
        {finished ? (last ? 'Ver resultado' : 'Próxima') : 'Pular'}
      </button>
    </div>
  );
}
