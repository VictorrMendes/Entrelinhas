import { ChevronLeft, ChevronRight, Minus, Plus, Sparkles, Volume2, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Block, TocEntry } from './book';
import { Pills } from './Kits';
import { langName } from './Learn';
import { MAX_FONT, MIN_FONT, READING_THEMES, type ReaderPrefs } from './readerPrefs';
import { speak } from './speech';
import { fold } from './text';
import { errorText, explain } from './words';

/** A bottom sheet over the page; tapping outside closes it. */
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet panel" onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon" aria-label="Fechar" onClick={onClose}>
              <X />
            </button>
          </div>
        )}
        {children}
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
    <section className="sheet word-sheet" aria-live="polite">
      <div className="sheet-head">
        <button type="button" className="icon" aria-label="Incluir a palavra anterior" disabled={!props.canGrowBack} onClick={props.onGrowBack}>
          <ChevronLeft />
        </button>
        <strong className="lookup-word">{l.word}</strong>
        <button type="button" className="icon" aria-label="Incluir a próxima palavra" disabled={!props.canGrowOn} onClick={props.onGrowOn}>
          <ChevronRight />
        </button>
        <button type="button" className="icon" aria-label="Ouvir pronúncia" onClick={() => speak(l.word, props.src)}>
          <Volume2 />
        </button>
        <span className="grow" />
        <button type="button" className="icon" aria-label="Fechar" onClick={props.onClose}>
          <X />
        </button>
      </div>
      <p className="muted small">
        {langName(props.src)} → {langName(props.tgt)}
      </p>
      {l.error ? <p className="error">{l.error}</p> : <p className="translation">{l.result ?? 'Traduzindo…'}</p>}
      {l.result && <Explanation key={`${l.block}-${l.start}-${l.end}`} text={l.word} sentence={l.sentence} src={props.src} tgt={props.tgt} />}
      <button type="button" className="button primary wide" disabled={!l.result} onClick={props.onSave}>
        Salvar
      </button>
    </section>
  );
}

/** "Explicar": the AI says what it means there, the grammar and a new example. */
export function Explanation({ text, sentence, src, tgt }: { text: string; sentence: string; src: string; tgt: string }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (answer) {
    return (
      <p className="explanation">
        <Sparkles size={18} /> <span>{answer}</span>
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        className="chip-button"
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
        <Sparkles size={18} /> {busy ? 'Explicando…' : 'Explicar'}
      </button>
      {error && <p className="error small">{error}</p>}
    </>
  );
}

export function TocSheet({ toc, current, onPick, onClose }: { toc: TocEntry[]; current: number; onPick: (block: number) => void; onClose: () => void }) {
  const active = toc.findLastIndex((e) => e.block <= current);
  return (
    <Sheet title="Sumário" onClose={onClose}>
      {toc.length === 0 ? (
        <p className="muted">Este livro não tem sumário nem títulos de capítulo. Continue rolando para avançar.</p>
      ) : (
        <ul className="sheet-list">
          {toc.map((e, i) => (
            <li key={`${e.block}-${e.title}`}>
              <button type="button" className={i === active ? 'on' : ''} onClick={() => onPick(e.block)}>
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
      <input
        className="answer-input"
        placeholder="Buscar no livro"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="muted small">{query.trim().length < 2 ? 'Digite ao menos 2 letras' : `${results.length}${results.length === 200 ? '+' : ''} resultado(s)`}</p>
      <ul className="sheet-list">
        {results.map((i) => (
          <li key={i}>
            <button type="button" className="snippet" onClick={() => onPick(i, query.trim())}>
              {snippet(blocks[i].text, needle)}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function SettingsSheet({ prefs, set, onClose }: { prefs: ReaderPrefs; set: (c: Partial<ReaderPrefs>) => void; onClose: () => void }) {
  return (
    <Sheet title="Aparência da leitura" onClose={onClose}>
      <h3 className="label">Tema da página</h3>
      <div className="themes">
        {READING_THEMES.map((t, i) => (
          <button type="button" key={t.label} className={`theme${prefs.theme === i ? ' on' : ''}`} onClick={() => set({ theme: i })}>
            <span style={t.page ? { background: t.page, color: t.text ?? undefined } : undefined}>Aa</span>
            {t.label}
          </button>
        ))}
      </div>
      <h3 className="label">Tamanho do texto</h3>
      <div className="row stepper">
        <button type="button" className="icon tonal" aria-label="Diminuir o texto" onClick={() => set({ fontSize: Math.max(MIN_FONT, prefs.fontSize - 2) })}>
          <Minus />
        </button>
        <strong>{prefs.fontSize}</strong>
        <button type="button" className="icon tonal" aria-label="Aumentar o texto" onClick={() => set({ fontSize: Math.min(MAX_FONT, prefs.fontSize + 2) })}>
          <Plus />
        </button>
      </div>
      <h3 className="label">Espaçamento entre linhas</h3>
      <Pills options={['Compacto', 'Normal', 'Amplo']} selected={prefs.spacing} onSelect={(i) => set({ spacing: i })} />
      <h3 className="label">Margens</h3>
      <Pills options={['Estreitas', 'Normais', 'Largas']} selected={prefs.margins} onSelect={(i) => set({ margins: i })} />
      <h3 className="label">Fonte do livro</h3>
      <Pills options={['Literata', 'Nunito']} selected={prefs.serif ? 0 : 1} onSelect={(i) => set({ serif: i === 0 })} />
      <h3 className="label">Tradução do parágrafo</h3>
      <Pills options={['Entre as linhas', 'Abaixo do parágrafo']} selected={prefs.interlinear ? 0 : 1} onSelect={(i) => set({ interlinear: i === 0 })} />
    </Sheet>
  );
}

const LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'sv', 'pl', 'ru', 'uk', 'tr', 'el', 'ar', 'he', 'hi', 'ja', 'ko', 'zh'];

export function LanguageSheet({ src, tgt, onSave, onClose }: { src: string; tgt: string; onSave: (src: string, tgt: string) => void; onClose: () => void }) {
  const [s, setS] = useState(src);
  const [t, setT] = useState(tgt);
  const options = [...new Set([src, tgt, ...LANGUAGES])].sort((a, b) => langName(a).localeCompare(langName(b)));
  const select = (value: string, onChange: (v: string) => void) => (
    <select className="sort wide" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((l) => (
        <option key={l} value={l}>
          {langName(l)}
        </option>
      ))}
    </select>
  );
  return (
    <Sheet title="Idiomas deste livro" onClose={onClose}>
      <h3 className="label">Idioma do livro</h3>
      {select(s, setS)}
      <h3 className="label">Idioma de tradução</h3>
      {select(t, setT)}
      <button type="button" className="button primary wide" onClick={() => onSave(s, t)}>
        Salvar
      </button>
    </Sheet>
  );
}
