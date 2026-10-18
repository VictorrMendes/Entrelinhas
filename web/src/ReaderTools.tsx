/** The reader's sentence actions, highlights, read-aloud player and goal celebration (Listening.kt and Reader.kt). */
import pauseSvg from '@material-design-icons/svg/filled/pause.svg?raw';
import playSvg from '@material-design-icons/svg/filled/play_arrow.svg?raw';
import nextSvg from '@material-design-icons/svg/filled/skip_next.svg?raw';
import previousSvg from '@material-design-icons/svg/filled/skip_previous.svg?raw';
import stopSvg from '@material-design-icons/svg/filled/stop.svg?raw';
import highlightSvg from '@material-design-icons/svg/outlined/border_color.svg?raw';
import editSvg from '@material-design-icons/svg/outlined/edit.svg?raw';
import micSvg from '@material-design-icons/svg/outlined/mic.svg?raw';
import repeatSvg from '@material-design-icons/svg/outlined/repeat.svg?raw';
import translateSvg from '@material-design-icons/svg/outlined/translate.svg?raw';
import visibilitySvg from '@material-design-icons/svg/outlined/visibility.svg?raw';
import visibilityOffSvg from '@material-design-icons/svg/outlined/visibility_off.svg?raw';
import volumeSvg from '@material-design-icons/svg/outlined/volume_up.svg?raw';
import { useEffect, useRef, useState } from 'react';
import type { Block } from './book';
import { MarkedWords } from './Dictation';
import { days } from './Goals';
import { Explanation, Sheet } from './ReaderSheets';
import { checkDictation, type StreakState } from './rules';
import { canListen, listen, speak } from './speech';
import type { Highlight } from './store';
import { Icon } from './ui';
import { errorText, translate } from './words';

export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6'];
export const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5];
/** Like Kotlin prints a Float: 1,0x, 0,75x. */
export const rateLabel = (r: number) => `${Number.isInteger(r) ? r.toFixed(1) : r}x`.replace('.', ',');
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
      <div className="sentence-sheet">
        <p className="body-large literata">“{sentence}”</p>
        {translation && <p className="body-medium italic primary-text">{translation}</p>}
        <div className="chip-row">
          <button type="button" className="filled-button with-icon" onClick={() => play()}>
            <Icon svg={volumeSvg} size={18} /> Ouvir
          </button>
          <button
            type="button"
            className={`filter-chip${looping ? ' on' : ''}`}
            onClick={() => {
              const on = !looping;
              setLooping(on);
              if (on) play(rate, true);
              else stop();
            }}
          >
            <Icon svg={repeatSvg} size={18} /> Repetir
          </button>
        </div>
        <div className="chip-row">
          {SLOW_RATES.map((r) => (
            <button
              type="button"
              key={r}
              className={`filter-chip${rate === r ? ' on' : ''}`}
              onClick={() => {
                setRate(r);
                play(r);
              }}
            >
              {rateLabel(r)}
            </button>
          ))}
        </div>
        <div className="chip-flow">
          <button
            type="button"
            className="assist-chip"
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
            {translating ? <span className="spinner small" /> : <Icon svg={translateSvg} size={18} />} Traduzir frase
          </button>
          <button type="button" className="assist-chip" onClick={props.onDictation}>
            <Icon svg={editSvg} size={18} /> Ditado
          </button>
          {canListen() && (
            <button
              type="button"
              className="assist-chip"
              disabled={listening}
              onClick={async () => {
                stop();
                setListening(true);
                const heard = await listen(lang);
                setListening(false);
                if (heard.length) setSpoken(heard.map((h) => checkDictation(sentence, h)).reduce((a, b) => (b.score > a.score ? b : a)));
              }}
            >
              <Icon svg={micSvg} size={18} /> {listening ? 'Ouvindo…' : 'Falar junto'}
            </button>
          )}
          <button type="button" className="assist-chip" onClick={props.onHighlight}>
            <Icon svg={highlightSvg} size={18} /> {props.highlighted ? 'Editar destaque' : 'Destacar'}
          </button>
        </div>
        <Explanation text={sentence} sentence={sentence} src={lang} tgt={props.tgt} />
        {spoken && (
          <>
            <span className="title-medium">Pronúncia: {spoken.score}% das palavras reconhecidas</span>
            <MarkedWords words={spoken.words} />
          </>
        )}
      </div>
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
    <Sheet onClose={props.onClose}>
      <div className="highlight-sheet">
        <h2 className="title-large semibold">{props.existing ? 'Editar destaque' : 'Destacar frase'}</h2>
        <p className="body-large highlight-quote" style={{ background: `color-mix(in srgb, ${HIGHLIGHT_COLORS[color]} 25%, transparent)` }}>
          “{props.quote}”
        </p>
        <div className="colors">
          {HIGHLIGHT_COLORS.map((c, i) => (
            <button type="button" key={c} className={`color${i === color ? ' on' : ''}`} style={{ background: c }} aria-label={`Cor ${i + 1}`} onClick={() => setColor(i)} />
          ))}
        </div>
        <textarea className="outlined-field textarea" rows={2} placeholder="Nota (opcional)" aria-label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row-end">
          {props.existing && (
            <button type="button" className="outlined-button" onClick={props.onRemove}>
              Remover
            </button>
          )}
          <span className="grow" />
          <button type="button" className="filled-button" onClick={() => props.onSave(color, note.trim() || null)}>
            {props.existing ? 'Salvar' : 'Destacar'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function NotesSheet({ highlights, blocks, onPick, onClose }: { highlights: Highlight[]; blocks: Block[]; onPick: (block: number) => void; onClose: () => void }) {
  const sorted = [...highlights].sort((a, b) => a.block - b.block || a.start - b.start);
  return (
    <Sheet title="Destaques e notas" onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="variant sheet-empty">Pressione e segure uma frase no texto para destacá-la e escrever uma nota.</p>
      ) : (
        <ul className="sheet-list" style={{ maxHeight: 520 }}>
          {sorted.map((h) => {
            const text = blocks[h.block]?.text ?? '';
            return (
              <li key={h.id}>
                <button type="button" className="note-row" onClick={() => onPick(h.block)}>
                  <span className="note-bar" style={{ background: HIGHLIGHT_COLORS[h.color] ?? HIGHLIGHT_COLORS[0] }} />
                  <span className="note-text">
                    <span className="body-medium clamp-3">{text.slice(h.start, h.end)}</span>
                    {h.note && <span className="body-small primary-text">{h.note}</span>}
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
    <div className="scrim" onClick={onClose}>
      <div className="goal-dialog" onClick={(e) => e.stopPropagation()}>
        <img src="/celebrate.png" alt="" width={140} height={140} />
        <h2 className="headline-small semibold">Meta do dia concluída!</h2>
        <p className="variant">
          Você leu {minutes} min hoje. Ofensiva: {days(streak.current)} 🔥
        </p>
        <button type="button" className="filled-button wide" onClick={onClose}>
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
    <footer className="reader-bar player-bar">
      <button type="button" className="icon" aria-label="Parágrafo anterior" onClick={props.onPrevious}>
        <Icon svg={previousSvg} />
      </button>
      <button type="button" className="filled-icon" aria-label={props.paused ? 'Continuar' : 'Pausar'} onClick={props.onPlayPause}>
        <Icon svg={props.paused ? playSvg : pauseSvg} />
      </button>
      <button type="button" className="icon" aria-label="Próximo parágrafo" onClick={props.onNext}>
        <Icon svg={nextSvg} />
      </button>
      <button type="button" className="text-button" onClick={props.onRate}>
        {rateLabel(props.rate)}
      </button>
      <button type="button" className={`icon${props.listenOnly ? ' on' : ''}`} aria-label="Só ouvido: esconder o texto" aria-pressed={props.listenOnly} onClick={props.onListenOnly}>
        <Icon svg={props.listenOnly ? visibilityOffSvg : visibilitySvg} />
      </button>
      <button type="button" className="icon" aria-label="Parar leitura em voz" onClick={props.onStop}>
        <Icon svg={stopSvg} />
      </button>
    </footer>
  );
}
