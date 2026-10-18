/** The reader's sentence actions, highlights, read-aloud player and goal celebration (Listening.kt and Reader.kt). */
import { Ear, Highlighter, Languages, Mic, Pause, PencilLine, Play, Repeat, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Block } from './book';
import { MarkedWords } from './Dictation';
import { days } from './Goals';
import { Explanation, Sheet } from './ReaderSheets';
import { checkDictation, type StreakState } from './rules';
import { canListen, listen, speak } from './speech';
import type { Highlight } from './store';
import { errorText, translate } from './words';

export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6'];
export const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5];
export const rateLabel = (r: number) => `${r}x`.replace('.', ',');
const SLOW_RATES = [0.5, 0.75, 1];
const LOOP_PAUSE_MS = 700;

/** A long-pressed sentence: listen (in a loop, slower), translate, explain, dictation from here, say it, highlight. */
export function SentenceSheet(props: {
  sentence: string;
  lang: string;
  tgt: string;
  highlighted: boolean;
  onHighlight: () => void;
  onDictation: () => void;
  onClose: () => void;
}) {
  const { sentence, lang } = props;
  const [rate, setRate] = useState(1);
  const [looping, setLooping] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [spoken, setSpoken] = useState<ReturnType<typeof checkDictation> | null>(null);
  const [listening, setListening] = useState(false);
  // each play gets a number, so a stopped loop doesn't start again
  const run = useRef(0);

  async function play(r = rate, loop = looping) {
    const me = ++run.current;
    do {
      await speak(sentence, lang, r);
      if (loop) await new Promise((res) => setTimeout(res, LOOP_PAUSE_MS));
    } while (loop && run.current === me);
  }
  const stop = () => {
    run.current++;
    speechSynthesis.cancel();
  };
  useEffect(() => stop, []);

  return (
    <Sheet onClose={props.onClose}>
      <p className="quote">“{sentence}”</p>
      {translation && <p className="primary-text italic">{translation}</p>}
      <div className="row">
        <button type="button" className="button primary" onClick={() => play()}>
          <Volume2 /> Ouvir
        </button>
        <button
          type="button"
          className={`chip-button${looping ? ' on' : ''}`}
          onClick={() => {
            const on = !looping;
            setLooping(on);
            if (on) play(rate, true);
            else stop();
          }}
        >
          <Repeat size={18} /> Repetir
        </button>
      </div>
      <div className="row">
        {SLOW_RATES.map((r) => (
          <button
            type="button"
            key={r}
            className={`chip-button${rate === r ? ' on' : ''}`}
            onClick={() => {
              setRate(r);
              play(r);
            }}
          >
            {rateLabel(r)}
          </button>
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          className="chip-button"
          disabled={translation !== null || translating}
          onClick={async () => {
            setTranslating(true);
            try {
              setTranslation(await translate(sentence, lang, props.tgt));
            } catch (e) {
              setTranslation(errorText(e));
            }
            setTranslating(false);
          }}
        >
          <Languages size={18} /> {translating ? 'Traduzindo…' : 'Traduzir frase'}
        </button>
        <button type="button" className="chip-button" onClick={props.onDictation}>
          <PencilLine size={18} /> Ditado
        </button>
        {canListen() && (
          <button
            type="button"
            className={`chip-button${listening ? ' on' : ''}`}
            disabled={listening}
            onClick={async () => {
              stop();
              setListening(true);
              const heard = await listen(lang);
              setListening(false);
              if (heard.length) setSpoken(heard.map((h) => checkDictation(sentence, h)).reduce((a, b) => (b.score > a.score ? b : a)));
            }}
          >
            <Mic size={18} /> {listening ? 'Ouvindo…' : 'Falar junto'}
          </button>
        )}
        <button type="button" className="chip-button" onClick={props.onHighlight}>
          <Highlighter size={18} /> {props.highlighted ? 'Editar destaque' : 'Destacar'}
        </button>
      </div>
      <Explanation text={sentence} sentence={sentence} src={lang} tgt={props.tgt} />
      {spoken && (
        <>
          <h3 className="label">Pronúncia: {spoken.score}% das palavras reconhecidas</h3>
          <MarkedWords words={spoken.words} />
        </>
      )}
    </Sheet>
  );
}

export function HighlightSheet(props: {
  quote: string;
  existing: Highlight | null;
  onSave: (color: number, note: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [color, setColor] = useState(props.existing?.color ?? 0);
  const [note, setNote] = useState(props.existing?.note ?? '');
  return (
    <Sheet title={props.existing ? 'Editar destaque' : 'Destacar frase'} onClose={props.onClose}>
      <p className="quote highlight-quote" style={{ background: `color-mix(in srgb, ${HIGHLIGHT_COLORS[color]} 25%, transparent)` }}>
        “{props.quote}”
      </p>
      <div className="row colors">
        {HIGHLIGHT_COLORS.map((c, i) => (
          <button type="button" key={c} className={`color${i === color ? ' on' : ''}`} style={{ background: c }} aria-label={`Cor ${i + 1}`} onClick={() => setColor(i)} />
        ))}
      </div>
      <textarea className="answer-input" rows={3} placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        {props.existing && (
          <button type="button" className="button outline" onClick={props.onRemove}>
            Remover
          </button>
        )}
        <span className="grow" />
        <button type="button" className="button primary" onClick={() => props.onSave(color, note.trim() || null)}>
          {props.existing ? 'Salvar' : 'Destacar'}
        </button>
      </div>
    </Sheet>
  );
}

export function NotesSheet({ highlights, blocks, onPick, onClose }: { highlights: Highlight[]; blocks: Block[]; onPick: (block: number) => void; onClose: () => void }) {
  const sorted = [...highlights].sort((a, b) => a.block - b.block || a.start - b.start);
  return (
    <Sheet title="Destaques e notas" onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="muted">Pressione e segure uma frase no texto para destacá-la e escrever uma nota.</p>
      ) : (
        <ul className="sheet-list">
          {sorted.map((h) => {
            const text = blocks[h.block]?.text ?? '';
            return (
              <li key={h.id}>
                <button type="button" className="note-row" onClick={() => onPick(h.block)}>
                  <span className="note-bar" style={{ background: HIGHLIGHT_COLORS[h.color] ?? HIGHLIGHT_COLORS[0] }} />
                  <span>
                    {text.slice(h.start, h.end)}
                    {h.note && <span className="primary-text small block-line">{h.note}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

export function GoalReached({ streak, minutes, onClose }: { streak: StreakState; minutes: number; onClose: () => void }) {
  return (
    <div className="sheet-backdrop center-dialog" onClick={onClose}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <img src="/celebrate.png" alt="" width={140} height={140} />
        <h2>Meta do dia concluída!</h2>
        <p className="muted">
          Você leu {minutes} min hoje. Ofensiva: {days(streak.current)} 🔥
        </p>
        <button type="button" className="button primary wide" onClick={onClose}>
          Continuar lendo
        </button>
      </div>
    </div>
  );
}

/** The read-aloud bar: previous and next paragraph, pause, speed, "ears only" and stop. */
export function PlayerBar(props: {
  paused: boolean;
  rate: number;
  listenOnly: boolean;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onRate: () => void;
  onListenOnly: () => void;
  onStop: () => void;
}) {
  return (
    <footer className="bottombar player-bar">
      <button type="button" className="icon" aria-label="Parágrafo anterior" onClick={props.onPrevious}>
        <SkipBack />
      </button>
      <button type="button" className="icon filled" aria-label={props.paused ? 'Continuar' : 'Pausar'} onClick={props.onPlayPause}>
        {props.paused ? <Play /> : <Pause />}
      </button>
      <button type="button" className="icon" aria-label="Próximo parágrafo" onClick={props.onNext}>
        <SkipForward />
      </button>
      <button type="button" className="text" onClick={props.onRate}>
        {rateLabel(props.rate)}
      </button>
      <button type="button" className={`icon${props.listenOnly ? ' on' : ''}`} aria-label="Só ouvido: esconder o texto" aria-pressed={props.listenOnly} onClick={props.onListenOnly}>
        <Ear />
      </button>
      <button type="button" className="icon" aria-label="Parar leitura em voz" onClick={props.onStop}>
        <X />
      </button>
    </footer>
  );
}

