import arrowBackSvg from '@material-design-icons/svg/filled/arrow_back.svg?raw';
import formatSizeSvg from '@material-design-icons/svg/filled/format_size.svg?raw';
import playSvg from '@material-design-icons/svg/filled/play_arrow.svg?raw';
import highlightSvg from '@material-design-icons/svg/outlined/border_color.svg?raw';
import listSvg from '@material-design-icons/svg/outlined/list.svg?raw';
import searchSvg from '@material-design-icons/svg/outlined/search.svg?raw';
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
import { account } from './api';
import type { Block } from './blocks';
import { bookBlocks, bookErrorText, bookImage, openBook } from './remote';
import { DictationSheet, speechRate } from './Dictation';
import { notify } from './notices';
import { caretAt, mark, offsetIn, rangeIn } from './readerDom';
import { LINE_SPACINGS, MARGINS, themeVars, useReaderPrefs } from './readerPrefs';
import { LanguageDialog, type Lookup, SearchSheet, SettingsSheet, TocSheet, VoicePicker, WordSheet } from './ReaderSheets';
import { GoalReached, HIGHLIGHT_COLORS, HighlightSheet, NotesSheet, PlayerBar, SPEECH_RATES, SentenceSheet } from './ReaderTools';
import type { StreakState } from './rules';
import { speak } from './speech';
import {
  addReadingSeconds,
  type Book,
  bookHighlights,
  dailyGoalMinutes,
  db,
  deleteHighlight,
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
import { Icon } from './ui';
import { defaultTarget, errorText, saveWord, translate, translateSentences, translateWord } from './words';

type Panel = 'toc' | 'search' | 'settings' | 'languages' | 'notes' | 'voice';

const WORD = /\p{L}[\p{L}'’-]*/gu;
/** The text comes from the server a page of blocks at a time: the page being read, one behind and AHEAD ahead, at most
 *  KEEP in the phone (the ones farthest behind go first). */
const PAGE = 20;
const AHEAD = 3;
const KEEP = 15;
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

/** A book's picture from the server: fetched when it comes near the screen, let go with its block. */
function BookImage({ hash, name, alt }: { hash: string; name: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    let made: string | undefined;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        near.disconnect();
        bookImage(hash, name).then(
          (blob) => {
            if (!alive) return;
            made = URL.createObjectURL(blob);
            setUrl(made);
          },
          () => undefined, // offline: the block stays empty
        );
      },
      { rootMargin: '600px 0px' },
    );
    near.observe(el);
    return () => {
      alive = false;
      near.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [hash, name]);
  return <img ref={ref} src={url} alt={alt} />;
}

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
  /** The book's file hash, which names its pictures on the server. */
  hash: string;
  onTranslate: (i: number) => void;
  onHide: (i: number) => void;
}) {
  const { block, i, translation } = props;
  if (block.type === 'img') {
    return (
      <div data-i={i} className="block img">
        {block.image && <BookImage hash={props.hash} name={block.image} alt={block.text} />}
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
        <span data-tr="1" className="reveal label-large">
          Toque para ver o texto
        </span>
      ) : props.loading ? (
        <span data-tr="1" className="tr-loading" />
      ) : isNavigation(block) ? null : (
        <span data-tr="1" className="para-row">
          <button type="button" className="para-link label-medium" onClick={() => (translation !== undefined ? props.onHide(i) : props.onTranslate(i))}>
            {translation !== undefined ? 'ocultar' : '文A traduzir'}
          </button>
        </span>
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

export function Reader({ book: opened, onClose, onVocabulary }: { book: Book; onClose: () => void; onVocabulary: () => void }) {
  const [book, setBook] = useState(opened);
  // the book's text, as far as it is here: the pages around the reader (holes where a page isn't)
  const [total, setTotal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Map<number, Block[]>>(new Map());
  const blocks = useMemo(() => {
    if (total === null || !loaded.size) return null;
    const all = new Array<Block | undefined>(total);
    for (const [page, list] of loaded) list.forEach((b, k) => (all[page * PAGE + k] = b));
    return all;
  }, [loaded, total]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  /** A block's text; empty for one not here (taps and marks only ever reach blocks on screen, which are). */
  const textOf = (i: number) => blocks?.[i]?.text ?? '';
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
  const tgt = book.target ?? defaultTarget();
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

  // the text comes from the server, which read the book: opened first, then a window of pages follows the reader
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const { hash, title, fileType } = bookRef.current;
    let alive = true;
    setFailure(null);
    (async () => {
      if (!account() || !hash) throw new Error('Entre na sua conta para ler este livro.');
      const { blockCount } = await openBook(hash, `${title}.${fileType ?? 'epub'}`);
      if (alive) setTotal(blockCount);
    })().catch((e) => alive && setFailure(bookErrorText(e)));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  /** The page the reader is on: the window is built around it. */
  const [page, setPage] = useState(Math.floor(opened.lastBlock / PAGE));
  const pageRef = useRef(page);
  pageRef.current = page;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const fetching = useRef(new Set<number>());
  const [pageFailure, setPageFailure] = useState<string | null>(null);
  /** Where the reader lands once its page is here: the book's place when it opens, a jump's target. */
  const landing = useRef<number | null>(opened.lastBlock);
  /** The first block on screen and where it is, kept as the reader scrolls: whatever changes size above it (a page
   *  coming or going, a picture arriving, the book's font loading) puts it back there. Safari doesn't on its own. */
  const anchor = useRef<{ i: number; top: number } | null>(null);
  /** The scroll position the anchor is up to date with (the reader's scrolling moves it, in onScroll). */
  const seen = useRef(0);
  function keepPlace() {
    const before = anchor.current;
    const el = before && element(before.i);
    const moved = el ? el.getBoundingClientRect().top - (before?.top ?? 0) : 0;
    if (moved) window.scrollBy(0, moved);
    seen.current = window.scrollY;
  }

  /** The first block not yet scrolled under the top bar, and where it is (blocks are in the page in order). */
  function firstOnScreen(): { i: number; top: number } | null {
    const items = pagesRef.current?.querySelectorAll<HTMLElement>(':scope > [data-i]');
    if (!items?.length) return null;
    const line = headerRef.current?.getBoundingClientRect().bottom ?? 0;
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].getBoundingClientRect().bottom > line) hi = mid;
      else lo = mid + 1;
    }
    const el = items[lo];
    return { i: Number(el.dataset.i), top: el.getBoundingClientRect().top };
  }

  useEffect(() => {
    const hash = bookRef.current.hash;
    if (total === null || !hash) return;
    const to = Math.min(Math.ceil(total / PAGE) - 1, page + AHEAD);
    const from = page - (KEEP - AHEAD - 1);
    const far = [...loadedRef.current.keys()].filter((p) => p < from || p > to);
    if (far.length) setLoaded((m) => new Map([...m].filter(([p]) => !far.includes(p))));
    for (let p = Math.max(0, page - 1); p <= to; p++) {
      if (loadedRef.current.has(p) || fetching.current.has(p)) continue;
      fetching.current.add(p);
      setPageFailure(null);
      bookBlocks(hash, p * PAGE, PAGE)
        .then(
          (list) => {
            // the reader may have jumped far away meanwhile
            if (p < pageRef.current - (KEEP - AHEAD - 1) || p > pageRef.current + AHEAD) return;
            setLoaded((m) => new Map(m).set(p, list));
          },
          (e) => setPageFailure(bookErrorText(e)),
        )
        .finally(() => fetching.current.delete(p));
    }
    // emptied by a jump to the page it is already on: fetched again all the same
  }, [page, total, attempt, loaded.size === 0]);

  // the window changed: the landing, once its block is here, or else the text stays where it was
  useLayoutEffect(() => {
    if (!blocks) return;
    const target = landing.current;
    const el = target !== null && element(target);
    if (!el) return target === null ? keepPlace() : undefined;
    landing.current = null;
    el.scrollIntoView();
    anchor.current = { i: target as number, top: el.getBoundingClientRect().top };
    seen.current = window.scrollY;
  }, [blocks]);

  // anything else changing size above the screen: put back before the screen is drawn
  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const resized = new ResizeObserver(() => landing.current === null && keepPlace());
    resized.observe(el);
    return () => resized.disconnect();
  }, []);

  /** A block that may still be on its way from the server (reading aloud runs ahead of the scrolling). */
  async function blockAt(i: number): Promise<Block | undefined> {
    for (let tries = 0; tries < 100 && !blocksRef.current?.[i]; tries++) {
      setPage(Math.floor(i / PAGE));
      await new Promise((r) => setTimeout(r, 100));
    }
    return blocksRef.current?.[i];
  }

  useEffect(() => {
    record('sessions');
    // opening counts as reading it now, for the library and the sync
    const now = Date.now();
    const opened = { ...bookRef.current, lastOpenedAt: now, updatedAt: now };
    setBook(opened);
    db.put('books', opened);
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

  // as the reader scrolls: the window follows at once, and the place is saved once the scrolling stops
  useEffect(() => {
    if (total === null) return;
    let timer: number | undefined;
    let frame = 0;
    const onScroll = () => {
      touch();
      // the anchor follows the reader's scrolling without measuring: a measure would also take in whatever changed size
      // since the last frame (a picture, the book's font), as if the reader had scrolled it
      if (anchor.current) anchor.current.top -= window.scrollY - seen.current;
      seen.current = window.scrollY;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (landing.current !== null) return;
        // what changed size goes back first; then the first block on screen is the anchor
        keepPlace();
        const first = firstOnScreen();
        if (!first) return;
        anchor.current = first;
        setPage(Math.floor(first.i / PAGE));
      });
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const first = landing.current === null && firstOnScreen();
        if (!first) return;
        setCurrent(first.i);
        const blocksHere = pagesRef.current?.querySelectorAll<HTMLElement>(':scope > [data-i]');
        const last = blocksHere?.[blocksHere.length - 1];
        const atEnd = !!last && Number(last.dataset.i) === total - 1 && last.getBoundingClientRect().bottom <= window.innerHeight;
        const now = Date.now();
        const next = { ...bookRef.current, lastBlock: first.i, lastOpenedAt: now, updatedAt: now, ...(atEnd && !bookRef.current.completedAt && { completedAt: now }) };
        setBook(next);
        db.put('books', next);
      }, 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [total]);

  // the marks drawn over the text: the looked-up word, saved words, a search result, highlights, the word being read
  useEffect(() => {
    const el = lookup && element(lookup.block);
    mark('word', el ? [rangeIn(el, lookup.start, lookup.end)] : []);
  }, [lookup?.block, lookup?.start, lookup?.end]);

  // saved words are marked only around the reading position (as the Android app does with what is on screen): a whole
  // novel's worth of marks, thousands of them, freezes Safari on the iPhone
  const near = Math.floor(current / 10) * 10;
  useEffect(() => {
    if (!blocks || !saved?.size) return mark('saved', []);
    const ranges: (Range | null)[] = [];
    const phrases = [...saved].filter((p) => p.includes(' '));
    for (let i = Math.max(0, near - 5); i < Math.min(blocks.length, near + 30); i++) {
      const el = element(i);
      const b = blocks[i];
      if (!el || !b) continue;
      const lower = b.text.toLowerCase();
      for (const m of lower.matchAll(WORD)) if (saved.has(m[0])) ranges.push(rangeIn(el, m.index, m.index + m[0].length));
      for (const p of phrases) for (let at = lower.indexOf(p); at >= 0; at = lower.indexOf(p, at + p.length)) ranges.push(rangeIn(el, at, at + p.length));
    }
    mark('saved', ranges);
  }, [blocks, saved, translations, prefs.interlinear, near]);

  useEffect(() => {
    const el = searchMark && element(searchMark.block);
    if (!el || !blocks) return mark('search', []);
    const needle = fold(searchMark.query);
    const haystack = fold(textOf(searchMark.block));
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
    const text = textOf(block);
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
      const w = wordAt(textOf(hit.block), hit.offset, src) ?? { start: hit.offset, end: hit.offset };
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
    const w = hit && hit.block === p.block ? wordAt(textOf(p.block), hit.offset, src) : null;
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
    const link = hit && blocks?.[hit.block]?.links?.find((l) => hit.offset >= l.start && hit.offset <= l.end);
    if (link) return go(link.target);
    const w = hit && blocks ? wordAt(textOf(hit.block), hit.offset, src) : null;
    if (hit && w) lookUp(hit.block, w.start, w.end);
    else setLookup(null);
  }

  function openSentence(block: number, offset: number) {
    if (!blocks) return;
    const text = textOf(block);
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
      // the window holds three pages ahead: plenty for ten sentences, and where it ends, so does the dictation
      const b = blocks[i];
      if (!b) break;
      if (b.type === 'img') continue;
      const text = b.text;
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
    const count = blocksRef.current?.length;
    if (count === undefined) return;
    const me = ++speakRun.current;
    // the next block with words, waiting for its page when reading aloud has run past the window
    let i = from;
    let b: Block | undefined;
    for (; i >= 0 && i < count; i += step) {
      b = blocksRef.current?.[i] ?? (await blockAt(i));
      if (speakRun.current !== me) return;
      if (!b) return stopSpeaking(); // its page didn't come (offline)
      if (b.type !== 'img' && b.text.trim()) break;
    }
    if (!b || i < 0 || i >= count) return stopSpeaking();
    const text = b.text;
    setSpeaking(i);
    setPaused(false);
    setSpoken(null);
    const el = element(i);
    const r = el?.getBoundingClientRect();
    if (el && r && (r.top < (headerRef.current?.getBoundingClientRect().bottom ?? 0) || r.bottom > window.innerHeight - 64)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const ok = await speak(text, src, rateRef.current, (start, end) => speakRun.current === me && setSpoken({ block: i, start, end }));
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
    const text = blocks?.[i]?.text;
    if (text === undefined || loading.has(i)) return;
    setLoading((s) => new Set(s).add(i));
    try {
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
      // only the pages here: the holes in between are skipped
      blocks?.map((b, i) => b && (
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
          hash={book.hash ?? ''}
          onTranslate={onTranslate}
          onHide={onHide}
        />
      )),
    [blocks, src, translations, loading, prefs.interlinear, speaking, listenOnly, revealed, book.hash, onTranslate, onHide],
  );

  // an expression grows by whole words, within the sentence
  let growBack: { start: number; end: number } | null = null;
  let growOn: { start: number; end: number } | null = null;
  if (lookup && blocks) {
    const text = textOf(lookup.block);
    const s = sentenceRanges(text, src).find(([a, b]) => lookup.start >= a && lookup.start < b) ?? [0, text.length];
    growBack = previousWord(text, lookup.start, src);
    if (growBack && growBack.start < s[0]) growBack = null;
    growOn = nextWord(text, lookup.end, src);
    if (growOn && growOn.end > s[1]) growOn = null;
  }

  const go = (block: number) => {
    setPanel(null);
    const el = element(block);
    if (el) return el.scrollIntoView();
    // a page that isn't here (contents, notes, a link): the window starts over there, and the reader lands once it comes
    landing.current = block;
    setLoaded(new Map());
    setPage(Math.floor(block / PAGE));
  };
  const percent = blocks?.length ? Math.round(((current + 1) * 100) / blocks.length) : 0;

  // the reading screen waits for the page being read; at the window's ends, the next page coming (or why it can't)
  const ready = !!blocks && loaded.has(page);
  const here = [...loaded.keys()];
  const edge = (
    <div className="reader-more" role="status">
      {pageFailure ? (
        <>
          <p className="body-medium">{pageFailure}</p>
          <button type="button" className="button outline" onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </button>
        </>
      ) : (
        <span className="spinner" aria-label="Carregando" />
      )}
    </div>
  );

  return (
    <main className="reader" style={themeVars(prefs.theme)}>
      <header ref={headerRef} className="reader-top">
        <button type="button" className="icon" aria-label="Voltar" onClick={onClose}>
          <Icon svg={arrowBackSvg} />
        </button>
        <h1 className="title-large ellipsis">{book.title}</h1>
        <button type="button" className="text-button" onClick={() => setPanel('languages')}>
          {src.toUpperCase()} → {tgt.toUpperCase()}
        </button>
        <button type="button" className="icon" aria-label="Aparência da leitura" onClick={() => setPanel('settings')}>
          <Icon svg={formatSizeSvg} />
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
        {ready && Math.min(...here) > 0 && edge}
        {pages}
        {ready && total !== null && (Math.max(...here) + 1) * PAGE < total && edge}
      </div>
      {!ready && (
        <div className="reader-loading" role="status">
          {failure || pageFailure ? (
            <>
              <p className="body-large">{failure || pageFailure}</p>
              <button type="button" className="button outline" onClick={() => setAttempt((n) => n + 1)}>
                Tentar de novo
              </button>
            </>
          ) : (
            <>
              <span className="spinner" />
              <p className="body-medium variant">Carregando o livro…</p>
            </>
          )}
        </div>
      )}

      {speaking === null ? (
        <footer className="reader-bar">
          <span className="label-medium">{percent}%</span>
          <span className="grow" />
          <button type="button" className="icon" aria-label="Sumário" onClick={() => setPanel('toc')}>
            <Icon svg={listSvg} />
          </button>
          <button type="button" className="icon" aria-label="Buscar no livro" onClick={() => setPanel('search')}>
            <Icon svg={searchSvg} />
          </button>
          <button type="button" className="icon" aria-label="Ouvir o livro" onClick={() => speakFrom(current)}>
            <Icon svg={playSvg} />
          </button>
          <button type="button" className="icon" aria-label="Destaques e notas" onClick={() => setPanel('notes')}>
            <Icon svg={highlightSvg} />
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
            notify({ text: 'Salva no vocabulário', action: { label: 'Ver', run: onVocabulary } });
          }}
          onClose={() => setLookup(null)}
        />
      )}
      {sentence && blocks && (
        <SentenceSheet
          sentence={textOf(sentence.block).slice(sentence.start, sentence.end)}
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
          quote={textOf(editing.block).slice(editing.start, editing.end)}
          existing={editing.existing}
          onSave={saveHighlight}
          onRemove={async () => {
            if (editing.existing) await deleteHighlight(editing.existing);
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
      {panel === 'settings' && <SettingsSheet prefs={prefs} set={setPrefs} onVoice={() => setPanel('voice')} onClose={() => setPanel(null)} />}
      {panel === 'voice' && (
        <VoicePicker
          lang={src}
          sample={(() => {
            const text = blocks?.[current]?.text ?? '';
            const first = sentenceRanges(text, src)[0];
            return first ? text.slice(first[0], first[1]) : book.title;
          })()}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'languages' && (
        <LanguageDialog
          src={src}
          tgt={tgt}
          onSave={(s, t, asDefault) => {
            const next = { ...book, language: s, target: t, updatedAt: Date.now() };
            setBook(next);
            db.put('books', next);
            if (asDefault) localStorage.setItem('defaultTarget', t);
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {celebrate && <GoalReached streak={celebrate} minutes={dailyGoalMinutes()} onClose={() => setCelebrate(null)} />}
      {dictation && <DictationSheet sentences={dictation} onClose={() => setDictation(null)} />}
    </main>
  );
}
