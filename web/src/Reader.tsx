import { ArrowLeft, Highlighter, List, Play, Search, Type } from 'lucide-react';
import {
  Fragment,
  memo,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { asBlocks, type Block } from './book';
import { DictationRound, speechRate } from './Dictation';
import { caretAt, mark, offsetIn, rangeIn } from './readerDom';
import { LINE_SPACINGS, MARGINS, themeVars, useReaderPrefs } from './readerPrefs';
import { LanguageSheet, type Lookup, SearchSheet, SettingsSheet, TocSheet, WordSheet } from './ReaderSheets';
import { GoalReached, HIGHLIGHT_COLORS, HighlightSheet, NotesSheet, PlayerBar, SPEECH_RATES, SentenceSheet } from './ReaderTools';
import type { StreakState } from './rules';
import { speak } from './speech';
import {
  addReadingSeconds,
  type Book,
  bookHighlights,
  dailyGoalMinutes,
  db,
  deleteParagraph,
  type Highlight,
  paragraphTranslations,
  record,
  saveParagraph,
  streak,
  useDb,
  words,
} from './store';
import { fold, nextWord, previousWord, sentenceAt, sentenceRanges, wordAt } from './text';
import { errorText, saveWord, TARGET, translate, translateSentences, translateWord } from './words';

type Panel = 'toc' | 'search' | 'settings' | 'languages' | 'notes';

const WORD = /\p{L}[\p{L}'’-]*/gu;
/** Reading time is credited in ticks, only while the app is on screen and the reader recently scrolled, tapped or listened. */
const TICK_SECONDS = 10;
const IDLE_AFTER_MS = 120_000;
const LONG_PRESS_MS = 450;

/** [from, to) of the block's text with its bold, italic and linked parts. */
function renderText(b: Block, from: number, to: number): ReactNode[] {
  const spans = b.spans ?? [];
  const links = b.links ?? [];
  const cuts = new Set([from, to]);
  for (const s of [...spans, ...links]) for (const p of [s.start, s.end]) if (p > from && p < to) cuts.add(p);
  const points = [...cuts].sort((x, y) => x - y);
  return points.slice(0, -1).map((start, k) => {
    const end = points[k + 1];
    let node: ReactNode = b.text.slice(start, end);
    if (spans.some((s) => s.bold && s.start <= start && s.end >= end)) node = <b>{node}</b>;
    if (spans.some((s) => s.italic && s.start <= start && s.end >= end)) node = <i>{node}</i>;
    if (links.some((l) => l.start <= start && l.end >= end)) node = <span className="link">{node}</span>;
    return <Fragment key={start}>{node}</Fragment>;
  });
}

/** A line of the book's own contents page: a link and nothing to translate. */
const isNavigation = (b: Block) => !!b.links?.some((l) => l.start === 0 && l.end >= b.text.length);

/** One block: its text, then its translation (one line under each sentence, or a box below) and the small link. */
const BlockView = memo(function BlockView(props: {
  block: Block;
  i: number;
  lang: string;
  translation: string | undefined;
  loading: boolean;
  interlinear: boolean;
  speaking: boolean;
  /** "Ears only": blurred while it is read, until a tap shows it. */
  veiled: boolean;
  /** The picture of an 'img' block. */
  image: string | undefined;
  onTranslate: (i: number) => void;
  onHide: (i: number) => void;
}) {
  const { block, i, translation } = props;
  if (block.type === 'img') {
    return (
      <div data-i={i} className="block img">
        {props.image && <img src={props.image} alt={block.text} loading="lazy" />}
      </div>
    );
  }
  const sentences = props.interlinear && translation !== undefined ? sentenceRanges(block.text, props.lang) : null;
  const lines = translation?.split('\n');
  const asLines = sentences && lines && sentences.length > 0 && lines.length === sentences.length;
  return (
    <div data-i={i} className={`block ${block.type}${props.speaking ? ' speaking' : ''}${props.veiled ? ' veiled' : ''}`}>
      {asLines ? (
        sentences.map(([start], k) => {
          const from = k === 0 ? 0 : start;
          const to = k === sentences.length - 1 ? block.text.length : sentences[k + 1][0];
          return (
            <Fragment key={from}>
              <span>{renderText(block, from, to)}</span>
              <span data-tr="1" className="tr-line">
                {lines[k]}
              </span>
            </Fragment>
          );
        })
      ) : (
        <span>{renderText(block, 0, block.text.length)}</span>
      )}
      {!asLines && translation !== undefined && (
        <span data-tr="1" className="tr-box">
          {translation.replace(/\n/g, ' ')}
        </span>
      )}
      {props.veiled ? (
        <span data-tr="1" className="reveal">
          Toque para ver o texto
        </span>
      ) : props.loading ? (
        <span data-tr="1" className="tr-loading" />
      ) : isNavigation(block) ? null : (
        <button type="button" data-tr="1" className="para-link" onClick={() => (translation !== undefined ? props.onHide(i) : props.onTranslate(i))}>
          {translation !== undefined ? 'ocultar' : '文A traduzir'}
        </button>
      )}
    </div>
  );
});

/** A long-pressed sentence (or the highlight under the finger). */
interface SentenceTarget {
  block: number;
  start: number;
  end: number;
  existing: Highlight | null;
}

export function Reader({ book: opened, onClose }: { book: Book; onClose: () => void }) {
  const [book, setBook] = useState(opened);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [prefs, setPrefs] = useReaderPrefs();
  const [translations, setTranslations] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [searchMark, setSearchMark] = useState<{ block: number; query: string } | null>(null);
  const [current, setCurrent] = useState(opened.lastBlock);
  const [toast, setToast] = useState<string | null>(null);
  const [sentence, setSentence] = useState<SentenceTarget | null>(null);
  const [editing, setEditing] = useState<SentenceTarget | null>(null);
  const [dictation, setDictation] = useState<[string, string][] | null>(null);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [spoken, setSpoken] = useState<{ block: number; start: number; end: number } | null>(null);
  const [listenOnly, setListenOnly] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [rate, setRate] = useState(speechRate);
  const [celebrate, setCelebrate] = useState<StreakState | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bookRef = useRef(book);
  bookRef.current = book;
  const id = book.id as number;
  const src = book.language;
  const tgt = book.target ?? TARGET;
  const element = (i: number) => pagesRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`) ?? null;
  // words and expressions already saved in this book's language get underlined wherever they come back
  const saved = useDb(() => words().then((ws) => new Set(ws.filter((w) => w.src === src).map((w) => w.original.toLowerCase()))), [src]);
  const highlights = useDb(() => bookHighlights(id), [id]) ?? [];
  const lastInteraction = useRef(Date.now());
  const speakingRef = useRef<number | null>(null);
  speakingRef.current = speaking;
  const touch = () => {
    lastInteraction.current = Date.now();
  };

  useEffect(() => {
    db.get<(Block | string)[]>('texts', id).then((b) => setBlocks(asBlocks(b ?? [])));
    record('sessions');
  }, [id]);

  // the book's pictures, as URLs for the 'img' blocks
  const [images, setImages] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let urls = new Map<string, string>();
    db.get<Record<string, Blob>>('images', id).then((all) => {
      urls = new Map(Object.entries(all ?? {}).map(([name, blob]) => [name, URL.createObjectURL(blob)]));
      setImages(urls);
    });
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [id]);

  useEffect(() => {
    paragraphTranslations(id, src, tgt).then(setTranslations);
  }, [id, src, tgt]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // active reading time meets the daily goal; the moment it does, the reader celebrates
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const active = speakingRef.current !== null || Date.now() - lastInteraction.current < IDLE_AFTER_MS;
      if (document.visibilityState === 'visible' && active && (await addReadingSeconds(TICK_SECONDS))) setCelebrate(await streak());
    }, TICK_SECONDS * 1000);
    return () => clearInterval(timer);
  }, []);

  // back to the paragraph the book was left on, then keep the first one on screen as the reader scrolls
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!blocks || restored.current) return;
    restored.current = true;
    element(opened.lastBlock)?.scrollIntoView();
  }, [blocks]);

  useEffect(() => {
    if (!blocks) return;
    let timer: number | undefined;
    const onScroll = () => {
      touch();
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const items = pagesRef.current?.children;
        if (!items?.length) return;
        // binary search for the first block not yet scrolled under the top bar (blocks are in page order)
        const line = headerRef.current?.getBoundingClientRect().bottom ?? 0;
        let lo = 0;
        let hi = items.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (items[mid].getBoundingClientRect().bottom > line) hi = mid;
          else lo = mid + 1;
        }
        setCurrent(lo);
        const atEnd = items[items.length - 1].getBoundingClientRect().bottom <= window.innerHeight;
        const next = { ...bookRef.current, lastBlock: lo, ...(atEnd && !bookRef.current.completedAt && { completedAt: Date.now() }) };
        setBook(next);
        db.put('books', next);
      }, 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [blocks]);

  // the marks drawn over the text: the looked-up word, saved words, a search result, highlights, the word being read
  useEffect(() => {
    const el = lookup && element(lookup.block);
    mark('word', el ? [rangeIn(el, lookup.start, lookup.end)] : []);
  }, [lookup?.block, lookup?.start, lookup?.end]);

  useEffect(() => {
    if (!blocks || !saved?.size) return mark('saved', []);
    const ranges: (Range | null)[] = [];
    const phrases = [...saved].filter((p) => p.includes(' '));
    blocks.forEach((b, i) => {
      const el = element(i);
      if (!el) return;
      const lower = b.text.toLowerCase();
      for (const m of lower.matchAll(WORD)) if (saved.has(m[0])) ranges.push(rangeIn(el, m.index, m.index + m[0].length));
      for (const p of phrases) for (let at = lower.indexOf(p); at >= 0; at = lower.indexOf(p, at + p.length)) ranges.push(rangeIn(el, at, at + p.length));
    });
    mark('saved', ranges);
  }, [blocks, saved, translations, prefs.interlinear]);

  useEffect(() => {
    const el = searchMark && element(searchMark.block);
    if (!el || !blocks) return mark('search', []);
    const needle = fold(searchMark.query);
    const haystack = fold(blocks[searchMark.block].text);
    const ranges: (Range | null)[] = [];
    for (let at = haystack.indexOf(needle); needle && at >= 0; at = haystack.indexOf(needle, at + needle.length)) ranges.push(rangeIn(el, at, at + needle.length));
    mark('search', ranges);
  }, [searchMark, blocks, translations, prefs.interlinear]);

  useEffect(() => {
    HIGHLIGHT_COLORS.forEach((_, c) =>
      mark(
        `hl${c}`,
        highlights.filter((h) => h.color === c).map((h) => {
          const el = element(h.block);
          return el ? rangeIn(el, h.start, h.end) : null;
        }),
      ),
    );
  }, [highlights, blocks, translations, prefs.interlinear]);

  useEffect(() => {
    const el = spoken && element(spoken.block);
    mark('spoken', el ? [rangeIn(el, spoken.start, spoken.end)] : []);
  }, [spoken]);

  useEffect(
    () => () => {
      for (const n of ['word', 'saved', 'search', 'spoken', 'select', ...HIGHLIGHT_COLORS.map((_, c) => `hl${c}`)]) mark(n, []);
      speakRun.current++;
      speechSynthesis.cancel();
    },
    [],
  );

  function lookUp(block: number, start: number, end: number) {
    if (!blocks) return;
    touch();
    const text = blocks[block].text;
    const asked: Lookup = { block, start, end, word: text.slice(start, end), sentence: sentenceAt(text, start, src) };
    setLookup(asked);
    const same = (l: Lookup | null) => l?.block === block && l.start === start && l.end === end;
    translateWord(asked.word, asked.sentence, src, tgt).then(
      (result) => {
        record('words');
        setLookup((l) => (same(l) ? { ...asked, result } : l));
      },
      (e) => setLookup((l) => (same(l) ? { ...asked, error: errorText(e) } : l)),
    );
  }

  /** The block and offset in its text under a screen point, or null outside the book's text. */
  function hitAt(x: number, y: number): { block: number; offset: number } | null {
    const caret = caretAt(x, y);
    const el = caret?.node.parentElement?.closest<HTMLElement>('[data-i]');
    const offset = caret && el ? offsetIn(el, caret.node, caret.offset) : null;
    return el && offset !== null ? { block: Number(el.dataset.i), offset } : null;
  }

  // a long press opens the sentence; holding and dragging marks whole words and translates them on release
  const press = useRef<{
    x: number;
    y: number;
    timer: number;
    active: boolean;
    block: number;
    offset: number;
    anchor: { start: number; end: number };
    range: { start: number; end: number };
  } | null>(null);
  // a mouse fires a click right after a long press, a finger usually doesn't: ignore only one that comes at once
  const suppressClickUntil = useRef(0);

  function onPointerDown(e: PointerEvent) {
    touch();
    if (e.button !== 0 || (e.target as Element).closest('[data-tr]') || !blocks) return;
    const x = e.clientX;
    const y = e.clientY;
    const timer = window.setTimeout(() => {
      const hit = hitAt(x, y);
      const p = press.current;
      if (!hit || !p) return;
      const w = wordAt(blocks[hit.block].text, hit.offset, src) ?? { start: hit.offset, end: hit.offset };
      Object.assign(p, { active: true, block: hit.block, offset: hit.offset, anchor: w, range: w });
      const el = element(hit.block);
      mark('select', el ? [rangeIn(el, w.start, w.end)] : []);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
    press.current = { x, y, timer, active: false, block: 0, offset: 0, anchor: { start: 0, end: 0 }, range: { start: 0, end: 0 } };
  }

  function onPointerMove(e: PointerEvent) {
    const p = press.current;
    if (!p || !blocks) return;
    if (!p.active) {
      // moving before the long press is a scroll
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) {
        clearTimeout(p.timer);
        press.current = null;
      }
      return;
    }
    const hit = hitAt(e.clientX, e.clientY);
    const w = hit && hit.block === p.block ? wordAt(blocks[p.block].text, hit.offset, src) : null;
    if (!w) return;
    p.range = { start: Math.min(p.anchor.start, w.start), end: Math.max(p.anchor.end, w.end) };
    const el = element(p.block);
    mark('select', el ? [rangeIn(el, p.range.start, p.range.end)] : []);
  }

  function onPointerUp() {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.active) return;
    suppressClickUntil.current = Date.now() + 400;
    mark('select', []);
    if (p.range.start === p.anchor.start && p.range.end === p.anchor.end) openSentence(p.block, p.offset);
    else lookUp(p.block, p.range.start, p.range.end);
  }

  // while a long press drags a selection the page must not scroll, and the browser's own selection and menu stay away
  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const noScroll = (e: TouchEvent) => press.current?.active && e.preventDefault();
    const noSelect = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', noScroll, { passive: false });
    el.addEventListener('selectstart', noSelect);
    return () => {
      el.removeEventListener('touchmove', noScroll);
      el.removeEventListener('selectstart', noSelect);
    };
  }, [blocks]);

  function onTap(e: MouseEvent) {
    if (Date.now() < suppressClickUntil.current) return;
    if ((e.target as Element).closest('button')) return;
    const veiled = (e.target as Element).closest<HTMLElement>('.veiled');
    if (veiled) {
      setRevealed((r) => new Set(r).add(Number(veiled.dataset.i)));
      return;
    }
    if ((e.target as Element).closest('[data-tr]')) return;
    const hit = hitAt(e.clientX, e.clientY);
    // a contents line or footnote mark goes where it points
    const link = hit && blocks?.[hit.block].links?.find((l) => hit.offset >= l.start && hit.offset <= l.end);
    if (link) return go(link.target);
    const w = hit && blocks ? wordAt(blocks[hit.block].text, hit.offset, src) : null;
    if (hit && w) lookUp(hit.block, w.start, w.end);
    else setLookup(null);
  }

  function openSentence(block: number, offset: number) {
    if (!blocks) return;
    const text = blocks[block].text;
    const existing = highlights.find((h) => h.block === block && offset >= h.start && offset < h.end) ?? null;
    const range = existing ? [existing.start, existing.end] : (sentenceRanges(text, src).find(([, e]) => offset < e) ?? [0, text.length]);
    setLookup(null);
    setSentence({ block, start: range[0], end: range[1], existing });
  }

  /** The long-pressed sentence and the ones after it, for a dictation that follows the book. */
  function dictationFrom(block: number, start: number): [string, string][] {
    if (!blocks) return [];
    const out: [string, string][] = [];
    for (let i = block; i < blocks.length && out.length < 10; i++) {
      if (blocks[i].type === 'img') continue;
      const text = blocks[i].text;
      for (const [s, e] of sentenceRanges(text, src)) {
        const piece = text.slice(s, e);
        if ((i !== block || s >= start) && piece.split(' ').length >= 3 && out.length < 10) out.push([piece, src]);
      }
    }
    return out;
  }

  async function saveHighlight(color: number, note: string | null) {
    if (!editing) return;
    const now = Date.now();
    const h = editing.existing;
    await db.put(
      'highlights',
      h
        ? { ...h, color, note, updatedAt: now }
        : ({ book: id, block: editing.block, start: editing.start, end: editing.end, color, note, createdAt: now, updatedAt: now } satisfies Highlight),
    );
    setEditing(null);
  }

  // read aloud: one block after another, the word being said lit up where the browser reports it
  const speakRun = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  async function speakFrom(from: number, step = 1) {
    if (!blocks) return;
    const me = ++speakRun.current;
    let i = from;
    while (i >= 0 && i < blocks.length && (blocks[i].type === 'img' || !blocks[i].text.trim())) i += step;
    if (i < 0 || i >= blocks.length) return stopSpeaking();
    setSpeaking(i);
    setPaused(false);
    setSpoken(null);
    const el = element(i);
    const r = el?.getBoundingClientRect();
    if (el && r && (r.top < (headerRef.current?.getBoundingClientRect().bottom ?? 0) || r.bottom > window.innerHeight - 64)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const ok = await speak(blocks[i].text, src, rateRef.current, (start, end) => speakRun.current === me && setSpoken({ block: i, start, end }));
    if (speakRun.current !== me) return; // paused, stopped or moved on
    if (!ok) {
      stopSpeaking();
      setToast('Não foi possível ler em voz alta neste aparelho.');
      return;
    }
    speakFrom(i + 1);
  }
  function stopSpeaking() {
    speakRun.current++;
    speechSynthesis.cancel();
    setSpeaking(null);
    setSpoken(null);
    setListenOnly(false);
    setRevealed(new Set());
  }

  async function translateBlock(i: number) {
    if (!blocks || loading.has(i)) return;
    setLoading((s) => new Set(s).add(i));
    try {
      const text = blocks[i].text;
      const result = prefs.interlinear
        ? (await translateSentences(sentenceRanges(text, src).map(([s, e]) => text.slice(s, e)), src, tgt)).join('\n')
        : await translate(text, src, tgt);
      setTranslations((m) => new Map(m).set(i, result));
      record('paragraphs');
      saveParagraph(id, i, src, tgt, result);
    } catch (e) {
      setToast(errorText(e));
    }
    setLoading((s) => {
      const n = new Set(s);
      n.delete(i);
      return n;
    });
  }

  function hideTranslation(i: number) {
    setTranslations((m) => {
      const n = new Map(m);
      n.delete(i);
      return n;
    });
    deleteParagraph(id, i, src, tgt);
  }

  // stable callbacks for the memoized blocks: a tap on a word must not redraw the whole book
  const latest = useRef({ translateBlock, hideTranslation });
  latest.current = { translateBlock, hideTranslation };
  const onTranslate = useCallback((i: number) => latest.current.translateBlock(i), []);
  const onHide = useCallback((i: number) => latest.current.hideTranslation(i), []);

  // the list itself only changes with the text, its translations or the reading aloud, never with a lookup or a panel
  const pages = useMemo(
    () =>
      blocks?.map((b, i) => (
        <BlockView
          key={i}
          block={b}
          i={i}
          lang={src}
          translation={translations.get(i)}
          loading={loading.has(i)}
          interlinear={prefs.interlinear}
          speaking={speaking === i}
          veiled={listenOnly && speaking !== null && !revealed.has(i)}
          image={b.image && images.get(b.image)}
          onTranslate={onTranslate}
          onHide={onHide}
        />
      )),
    [blocks, src, translations, loading, prefs.interlinear, speaking, listenOnly, revealed, images, onTranslate, onHide],
  );

  // an expression grows by whole words, within the sentence
  let growBack: { start: number; end: number } | null = null;
  let growOn: { start: number; end: number } | null = null;
  if (lookup && blocks) {
    const text = blocks[lookup.block].text;
    const s = sentenceRanges(text, src).find(([a, b]) => lookup.start >= a && lookup.start < b) ?? [0, text.length];
    growBack = previousWord(text, lookup.start, src);
    if (growBack && growBack.start < s[0]) growBack = null;
    growOn = nextWord(text, lookup.end, src);
    if (growOn && growOn.end > s[1]) growOn = null;
  }

  const go = (block: number) => {
    setPanel(null);
    element(block)?.scrollIntoView();
  };
  const percent = blocks?.length ? Math.round(((current + 1) * 100) / blocks.length) : 0;

  return (
    <main className="reader" style={themeVars(prefs.theme)}>
      <header ref={headerRef} className="topbar">
        <button type="button" className="icon" aria-label="Voltar" onClick={onClose}>
          <ArrowLeft />
        </button>
        <span className="topbar-title">{book.title}</span>
        <button type="button" className="text" onClick={() => setPanel('languages')}>
          {src.toUpperCase()} → {tgt.toUpperCase()}
        </button>
        <button type="button" className="icon" aria-label="Aparência da leitura" onClick={() => setPanel('settings')}>
          <Type />
        </button>
      </header>

      <div
        ref={pagesRef}
        className={`pages${prefs.serif ? '' : ' sans'}`}
        style={{ fontSize: prefs.fontSize, lineHeight: LINE_SPACINGS[prefs.spacing], paddingLeft: MARGINS[prefs.margins], paddingRight: MARGINS[prefs.margins] }}
        onClick={onTap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {pages}
      </div>

      {speaking === null ? (
        <footer className="bottombar">
          <span className="small">{percent}%</span>
          <span className="grow" />
          <button type="button" className="icon" aria-label="Sumário" onClick={() => setPanel('toc')}>
            <List />
          </button>
          <button type="button" className="icon" aria-label="Buscar no livro" onClick={() => setPanel('search')}>
            <Search />
          </button>
          <button type="button" className="icon" aria-label="Ouvir o livro" onClick={() => speakFrom(current)}>
            <Play />
          </button>
          <button type="button" className="icon" aria-label="Destaques e notas" onClick={() => setPanel('notes')}>
            <Highlighter />
          </button>
        </footer>
      ) : (
        <PlayerBar
          paused={paused}
          rate={rate}
          listenOnly={listenOnly}
          onPrevious={() => speakFrom(speaking - 1, -1)}
          onPlayPause={() => {
            if (paused) speakFrom(speaking);
            else {
              speakRun.current++;
              speechSynthesis.cancel();
              setPaused(true);
            }
          }}
          onNext={() => speakFrom(speaking + 1)}
          onRate={() => {
            const next = SPEECH_RATES[(SPEECH_RATES.indexOf(rate) + 1) % SPEECH_RATES.length];
            localStorage.setItem('speechRate', String(next));
            setRate(next);
            rateRef.current = next;
            if (!paused) speakFrom(speaking);
          }}
          onListenOnly={() => {
            setListenOnly(!listenOnly);
            setRevealed(new Set());
          }}
          onStop={stopSpeaking}
        />
      )}

      {toast && <p className="toast">{toast}</p>}

      {lookup && (
        <WordSheet
          lookup={lookup}
          src={src}
          tgt={tgt}
          canGrowBack={growBack !== null}
          canGrowOn={growOn !== null}
          onGrowBack={() => growBack && lookUp(lookup.block, growBack.start, lookup.end)}
          onGrowOn={() => growOn && lookUp(lookup.block, lookup.start, growOn.end)}
          onSave={async () => {
            if (!lookup.result) return;
            await saveWord(lookup.word, lookup.result, src, book.title, lookup.sentence, tgt);
            setLookup(null);
            setToast('Salva no vocabulário');
          }}
          onClose={() => setLookup(null)}
        />
      )}
      {sentence && blocks && (
        <SentenceSheet
          sentence={blocks[sentence.block].text.slice(sentence.start, sentence.end)}
          lang={src}
          tgt={tgt}
          highlighted={sentence.existing !== null}
          onHighlight={() => {
            setEditing(sentence);
            setSentence(null);
          }}
          onDictation={() => {
            const list = dictationFrom(sentence.block, sentence.start);
            setSentence(null);
            if (list.length) setDictation(list);
          }}
          onClose={() => setSentence(null)}
        />
      )}
      {editing && blocks && (
        <HighlightSheet
          quote={blocks[editing.block].text.slice(editing.start, editing.end)}
          existing={editing.existing}
          onSave={saveHighlight}
          onRemove={async () => {
            if (editing.existing?.id !== undefined) await db.del('highlights', editing.existing.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {panel === 'toc' && <TocSheet toc={book.toc ?? []} current={current} onPick={go} onClose={() => setPanel(null)} />}
      {panel === 'search' && blocks && (
        <SearchSheet
          blocks={blocks}
          onPick={(block, query) => {
            setSearchMark({ block, query });
            go(block);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'notes' && blocks && <NotesSheet highlights={highlights} blocks={blocks} onPick={go} onClose={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsSheet prefs={prefs} set={setPrefs} onClose={() => setPanel(null)} />}
      {panel === 'languages' && (
        <LanguageSheet
          src={src}
          tgt={tgt}
          onSave={(s, t) => {
            const next = { ...book, language: s, target: t };
            setBook(next);
            db.put('books', next);
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {celebrate && <GoalReached streak={celebrate} minutes={dailyGoalMinutes()} onClose={() => setCelebrate(null)} />}
      {/* over the book, which stays where it was */}
      {dictation && (
        <div className="overlay">
          <DictationRound sentences={dictation} onClose={() => setDictation(null)} />
        </div>
      )}
    </main>
  );
}
