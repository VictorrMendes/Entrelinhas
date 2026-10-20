/** Dictation as a bottom sheet, over the book or the vocabulary, like the Android app's DictationSheet (Listening.kt). */
import volumeSvg from '@material-design-icons/svg/outlined/volume_up.svg?raw';
import { useEffect, useState } from 'react';
import { Sheet } from './ReaderSheets';
import { checkDictation, shuffle } from './rules';
import { speak } from './speech';
import { completeExercise, record, type Word } from './store';
import { Icon } from './ui';

export const speechRate = () => Number(localStorage.getItem('speechRate') ?? 1);

/** Heard words in green, typed-but-wrong struck through in red, missed ones underlined in amber. */
export function MarkedWords({ words }: { words: ReturnType<typeof checkDictation>['words'] }) {
  return (
    <p className="marked body-large">
      {words.map((w, i) => (
        <span key={`${i}-${w.text}`} className={w.mark}>
          {w.text}{' '}
        </span>
      ))}
    </p>
  );
}

/** Sentences for a dictation: examples of saved words (three words or more), in the language each word was read in. */
export const dictationSentences = (all: Word[]): [string, string][] =>
  shuffle(all.flatMap((w) => (w.example && w.example.split(' ').length >= 3 ? [[w.example, w.src] as [string, string]] : []))).slice(0, 10);

/** Hear a sentence, type it, see what was missed. */
export function DictationSheet({ sentences, onClose }: { sentences: [string, string][]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<ReturnType<typeof checkDictation> | null>(null);
  const [sentence, lang] = sentences[index];
  const play = (rate = speechRate()) => speak(sentence, lang, rate);

  useEffect(() => {
    play();
    return () => speechSynthesis.cancel();
  }, [index]);

  function check() {
    setResult(checkDictation(sentence, typed));
    record('dictations');
    if (index === sentences.length - 1) completeExercise(); // the last sentence ends the round
  }

  return (
    <Sheet onClose={onClose}>
      <div className="dictation-sheet">
        <h2 className="title-large">Ditado</h2>
        <p className="body-medium variant">
          Ouça e escreva o que entendeu · frase {index + 1} de {sentences.length}
        </p>
        <div className="chip-row">
          <button type="button" className="filled-button with-icon" onClick={() => play()}>
            <Icon svg={volumeSvg} size={18} /> Ouvir
          </button>
          <button type="button" className="outlined-button" onClick={() => play(0.6)}>
            Mais devagar
          </button>
        </div>
        <textarea
          className="outlined-field textarea"
          rows={2}
          placeholder="O que você ouviu"
          aria-label="O que você ouviu"
          value={typed}
          disabled={!!result}
          onChange={(e) => setTyped(e.target.value)}
        />
        {!result ? (
          <button type="button" className="filled-button wide" disabled={!typed.trim()} onClick={check}>
            Conferir
          </button>
        ) : (
          <>
            <span className="title-medium">Você acertou {result.score}% das palavras</span>
            <MarkedWords words={result.words} />
            <p className="body-medium answer-box">{sentence}</p>
            <div className="chip-row">
              <button
                type="button"
                className="outlined-button"
                onClick={() => {
                  setTyped('');
                  setResult(null);
                  play();
                }}
              >
                Tentar de novo
              </button>
              {index < sentences.length - 1 && (
                <button
                  type="button"
                  className="filled-button"
                  onClick={() => {
                    setIndex(index + 1);
                    setTyped('');
                    setResult(null);
                  }}
                >
                  Próxima frase
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
