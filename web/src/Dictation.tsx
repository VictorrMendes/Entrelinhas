import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkDictation, shuffle } from './rules';
import { speak } from './speech';
import { completeExercise, recordDictation, type Word, words } from './store';
import { TopBar } from './study';

export const speechRate = () => Number(localStorage.getItem('speechRate') ?? 1);

/** Heard words in green, typed-but-wrong struck through in red, missed ones underlined in amber. */
export function MarkedWords({ words }: { words: ReturnType<typeof checkDictation>['words'] }) {
  return (
    <p className="marked">
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

export function Dictation({ onClose }: { onClose: () => void }) {
  const [sentences, setSentences] = useState<[string, string][] | null>(null);
  useEffect(() => {
    words().then((all) => setSentences(dictationSentences(all)));
  }, []);
  return sentences?.length ? <DictationRound sentences={sentences} onClose={onClose} /> : null;
}

/** Dictation over the example sentences of saved words: listen, type what you heard, see what you got right. */
function DictationRound({ sentences, onClose }: { sentences: [string, string][]; onClose: () => void }) {
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
    recordDictation();
    if (index === sentences.length - 1) completeExercise(); // the last sentence ends the round
  }

  return (
    <main className="study">
      <TopBar title="Ditado" onClose={onClose} />
      <div className="study-body">
        <p className="muted">
          Ouça e escreva o que entendeu · frase {index + 1} de {sentences.length}
        </p>
        <div className="row">
          <button type="button" className="button primary" onClick={() => play()}>
            <Volume2 /> Ouvir
          </button>
          <button type="button" className="button outline" onClick={() => play(0.6)}>
            Mais devagar
          </button>
        </div>
        <textarea className="answer-input" rows={3} placeholder="O que você ouviu" value={typed} disabled={!!result} onChange={(e) => setTyped(e.target.value)} />
        {!result ? (
          <button type="button" className="button primary wide" disabled={!typed.trim()} onClick={check}>
            Conferir
          </button>
        ) : (
          <>
            <h3 className="label">Você acertou {result.score}% das palavras</h3>
            <MarkedWords words={result.words} />
            <p className="card original">{sentence}</p>
            <div className="row">
              <button
                type="button"
                className="button outline"
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
                  className="button primary"
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
    </main>
  );
}
