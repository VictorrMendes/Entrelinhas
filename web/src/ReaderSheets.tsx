/** The reader's sheets and dialogs, laid out like the Android app's (Reader.kt, ReaderSettings.kt, Listening.kt). */
import addSvg from '@material-design-icons/svg/filled/add.svg?raw';
import arrowLeftSvg from '@material-design-icons/svg/filled/keyboard_arrow_left.svg?raw';
import arrowRightSvg from '@material-design-icons/svg/filled/keyboard_arrow_right.svg?raw';
import removeSvg from '@material-design-icons/svg/filled/remove.svg?raw';
import sparkleSvg from '@material-design-icons/svg/outlined/auto_awesome.svg?raw';
import volumeSvg from '@material-design-icons/svg/outlined/volume_up.svg?raw';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Block, TocEntry } from './book';
import { langName } from './Learn';
import { MAX_FONT, MIN_FONT, READING_THEMES, type ReaderPrefs } from './readerPrefs';
import { chosenVoice, setVoice, speak, voicesFor } from './speech';
import { fold } from './text';
import { AlertDialog, Icon, Pills } from './ui';
import { errorText, explain } from './words';

/** Material 3 ModalBottomSheet: a drag handle on top, a tap outside closes it. */
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" onClick={(e) => e.stopPropagation()}>
        <span className="drag-handle" />
        <div className="sheet-body">
          {title && <h2 className="title-large semibold">{title}</h2>}
          {children}
        </div>
      </section>
    </div>
  );
}

/** A tapped word or a grown expression: [start, end) in the text of [block]. */
export interface Lookup {
  block: number;
  start: number;
  end: number;
  word: string;
  sentence: string;
  result?: string;
  error?: string;
}

export function WordSheet(props: {
  lookup: Lookup;
  src: string;
  tgt: string;
  canGrowBack: boolean;
  canGrowOn: boolean;
  onGrowBack: () => void;
  onGrowOn: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const l = props.lookup;
  return (
    <Sheet onClose={props.onClose}>
      <div className="word-sheet" aria-live="polite">
        <div className="word-row">
          <button type="button" className="icon" aria-label="Incluir a palavra anterior" disabled={!props.canGrowBack} onClick={props.onGrowBack}>
            <Icon svg={arrowLeftSvg} />
          </button>
          <span className="headline-small word">{l.word}</span>
          <button type="button" className="icon" aria-label="Incluir a próxima palavra" disabled={!props.canGrowOn} onClick={props.onGrowOn}>
            <Icon svg={arrowRightSvg} />
          </button>
          <button type="button" className="icon" aria-label="Ouvir pronúncia" onClick={() => speak(l.word, props.src)}>
            <Icon svg={volumeSvg} />
          </button>
        </div>
        <span className="label-medium variant">
          {langName(props.src)} → {langName(props.tgt)}
        </span>
        {l.error ? <span className="error">{l.error}</span> : l.result ? <span className="title-large">{l.result}</span> : <span className="spinner" />}
        {l.result && <Explanation key={`${l.block}-${l.start}-${l.end}`} text={l.word} sentence={l.sentence} src={props.src} tgt={props.tgt} />}
        <span>
          <button type="button" className="filled-button" disabled={!l.result} onClick={props.onSave}>
            Salvar
          </button>
        </span>
      </div>
    </Sheet>
  );
}

/** "Explicar": the AI says what it means there, the grammar and a new example. */
export function Explanation({ text, sentence, src, tgt }: { text: string; sentence: string; src: string; tgt: string }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (answer) {
    return (
      <p className="explanation body-medium">
        <Icon svg={sparkleSvg} size={18} />
        <span>{answer}</span>
      </p>
    );
  }
  return (
    <>
      <span>
        <button
          type="button"
          className="assist-chip"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setAnswer(await explain(text, sentence, src, tgt));
            } catch (e) {
              setError(errorText(e));
            }
            setBusy(false);
          }}
        >
          {busy ? <span className="spinner small" /> : <Icon svg={sparkleSvg} size={18} />}
          Explicar
        </button>
      </span>
      {error && <span className="body-small error">{error}</span>}
    </>
  );
}

export function TocSheet({ toc, current, onPick, onClose }: { toc: TocEntry[]; current: number; onPick: (block: number) => void; onClose: () => void }) {
  const active = toc.findLastIndex((e) => e.block <= current);
  return (
    <Sheet title="Sumário" onClose={onClose}>
      {toc.length === 0 ? (
        <p className="variant sheet-empty">Este livro não tem sumário nem títulos de capítulo. Continue rolando para avançar.</p>
      ) : (
        <ul className="sheet-list" style={{ maxHeight: 520 }}>
          {toc.map((e, i) => (
            <li key={`${e.block}-${e.title}`}>
              <button type="button" className={`toc-row${i === active ? ' on' : ''}`} onClick={() => onPick(e.block)}>
                {e.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function snippet(text: string, needle: string): ReactNode {
  const at = Math.max(0, fold(text).indexOf(needle));
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + needle.length + 40);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, at)}
      <strong>{text.slice(at, at + needle.length)}</strong>
      {text.slice(at + needle.length, end)}
      {end < text.length && '…'}
    </>
  );
}

export function SearchSheet({ blocks, onPick, onClose }: { blocks: Block[]; onPick: (block: number, query: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [needle, setNeedle] = useState('');
  const folded = useMemo(() => blocks.map((b) => fold(b.text)), [blocks]);
  // debounce typing
  useEffect(() => {
    const t = window.setTimeout(() => setNeedle(fold(query.trim())), 250);
    return () => clearTimeout(t);
  }, [query]);
  const results = needle.length < 2 ? [] : folded.flatMap((t, i) => (t.includes(needle) ? [i] : [])).slice(0, 200);
  return (
    <Sheet onClose={onClose}>
      <input className="outlined-field" placeholder="Buscar no livro" aria-label="Buscar no livro" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
      <span className="label-medium variant search-count">
        {query.trim().length < 2 ? 'Digite ao menos 2 letras' : `${results.length}${results.length === 200 ? '+' : ''} resultado(s)`}
      </span>
      <ul className="sheet-list" style={{ maxHeight: 460 }}>
        {results.map((i) => (
          <li key={i}>
            <button type="button" className="search-result body-medium" onClick={() => onPick(i, query.trim())}>
              {snippet(blocks[i].text, needle)}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const Label = ({ children }: { children: ReactNode }) => <h3 className="title-small variant sheet-label">{children}</h3>;

export function SettingsSheet({ prefs, set, onVoice, onClose }: { prefs: ReaderPrefs; set: (c: Partial<ReaderPrefs>) => void; onVoice: () => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <div className="reader-settings">
        <h2 className="title-large">Aparência da leitura</h2>
        <Label>Tema da página</Label>
        <div className="themes">
          {READING_THEMES.map((t, i) => (
            <button type="button" key={t.label} className={`theme${prefs.theme === i ? ' on' : ''}`} onClick={() => set({ theme: i })}>
              <span className="label-large" style={t.page ? { background: t.page, color: t.text ?? undefined } : undefined}>
                Aa
              </span>
              <span className="label-small">{t.label}</span>
            </button>
          ))}
        </div>
        <Label>Tamanho do texto</Label>
        <div className="stepper">
          <button type="button" className="tonal-icon" aria-label="Diminuir o texto" onClick={() => set({ fontSize: Math.max(MIN_FONT, prefs.fontSize - 2) })}>
            <Icon svg={removeSvg} />
          </button>
          <span className="title-medium">{prefs.fontSize}</span>
          <button type="button" className="tonal-icon" aria-label="Aumentar o texto" onClick={() => set({ fontSize: Math.min(MAX_FONT, prefs.fontSize + 2) })}>
            <Icon svg={addSvg} />
          </button>
        </div>
        <Label>Espaçamento entre linhas</Label>
        <Pills options={['Compacto', 'Normal', 'Amplo']} selected={prefs.spacing} onSelect={(i) => set({ spacing: i })} />
        <Label>Margens</Label>
        <Pills options={['Estreitas', 'Normais', 'Largas']} selected={prefs.margins} onSelect={(i) => set({ margins: i })} />
        <Label>Fonte do livro</Label>
        <Pills options={['Literata', 'Nunito']} selected={prefs.serif ? 0 : 1} onSelect={(i) => set({ serif: i === 0 })} />
        <Label>Voz da leitura</Label>
        <span>
          <button type="button" className="outlined-button" onClick={onVoice}>
            Escolher voz
          </button>
        </span>
        <Label>Tradução do parágrafo</Label>
        <Pills options={['Entre as linhas', 'Abaixo do parágrafo']} selected={prefs.interlinear ? 0 : 1} onSelect={(i) => set({ interlinear: i === 0 })} />
      </div>
    </Sheet>
  );
}

export const LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'sv', 'pl', 'ru', 'uk', 'tr', 'el', 'ar', 'he', 'hi', 'ja', 'ko', 'zh'];

/** "Idiomas deste livro": what it is written in and what it is translated into, optionally the default for other books. */
export function LanguageDialog({ src, tgt, onSave, onClose }: { src: string; tgt: string; onSave: (src: string, tgt: string, asDefault: boolean) => void; onClose: () => void }) {
  const [s, setS] = useState(src);
  const [t, setT] = useState(tgt);
  const [asDefault, setAsDefault] = useState(false);
  const options = [...new Set([src, tgt, ...LANGUAGES])].sort((a, b) => langName(a).localeCompare(langName(b)));
  const picker = (value: string, onChange: (v: string) => void, label: string) => (
    <select className="language-picker label-large" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((l) => (
        <option key={l} value={l}>
          {langName(l)}
        </option>
      ))}
    </select>
  );
  return (
    <AlertDialog
      title="Idiomas deste livro"
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="text-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="text-button" onClick={() => onSave(s, t, asDefault)}>
            OK
          </button>
        </>
      }
    >
      <div className="language-dialog">
        <div className="language-line">
          <span>Livro</span>
          {picker(s, setS, 'Idioma do livro')}
        </div>
        <div className="language-line">
          <span>Traduzir para</span>
          {picker(t, setT, 'Idioma de tradução')}
        </div>
        {s === t && <span className="body-small">Mesmo idioma: as traduções repetem o original.</span>}
        <label className="check-row">
          <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />
          Usar como padrão para outros livros
        </label>
      </div>
    </AlertDialog>
  );
}

/** The device's voices for [lang], each with a preview (VoicePicker on Android). */
export function VoicePicker({ lang, sample, onClose }: { lang: string; sample: string; onClose: () => void }) {
  const [voices, setVoices] = useState(() => voicesFor(lang));
  const [chosen, setChosen] = useState(() => chosenVoice(lang));
  // browsers fill the voice list a moment after the page loads
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(voicesFor(lang));
    speechSynthesis.addEventListener('voiceschanged', update);
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, [lang]);
  const row = (label: string, detail: string | null, uri: string | null) => (
    <div key={uri ?? 'auto'} className="voice-row">
      <button type="button" className="choice" onClick={() => setChosen(uri)}>
        <span className={`radio${chosen === uri ? ' on' : ''}`} />
        <span>
          <span className="body-large">{label}</span>
          {detail && <span className="body-small variant">{detail}</span>}
        </span>
      </button>
      <button type="button" className="icon" aria-label="Ouvir" onClick={() => speak(sample, lang, 1, undefined, uri)}>
        <Icon svg={volumeSvg} />
      </button>
    </div>
  );
  return (
    <AlertDialog
      title={`Voz para ${langName(lang)}`}
      onDismiss={onClose}
      actions={
        <>
          <button type="button" className="text-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setVoice(lang, chosen);
              onClose();
            }}
          >
            OK
          </button>
        </>
      }
    >
      {voices.length === 0 ? (
        <span>Este aparelho não tem voz para {langName(lang)}. No iPhone, instale em Ajustes &gt; Acessibilidade &gt; Conteúdo Falado &gt; Vozes.</span>
      ) : (
        <div className="language-list">
          {row('Automática', null, null)}
          {voices.map((v, i) => row(`Voz ${i + 1}`, v.localService ? 'funciona offline' : 'precisa de internet', v.voiceURI))}
        </div>
      )}
    </AlertDialog>
  );
}
