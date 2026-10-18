import { ArrowLeft, List, Search, Type } from 'lucide-react';
import { Fragment, memo, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { asBlocks, type Block } from './book';
import { caretAt, mark, offsetIn, rangeIn } from './readerDom';
import { LINE_SPACINGS, MARGINS, themeVars, useReaderPrefs } from './readerPrefs';
import { LanguageSheet, type Lookup, SearchSheet, SettingsSheet, TocSheet, WordSheet } from './ReaderSheets';
import { type Book, db, deleteParagraph, paragraphTranslations, record, saveParagraph, useDb, words } from './store';
import { fold, nextWord, previousWord, sentenceAt, sentenceRanges, wordAt } from './text';
import { errorText, saveWord, TARGET, translate, translateSentences, translateWord } from './words';

type Panel = 'toc' | 'search' | 'settings' | 'languages';

const WORD = /\p{L}[\p{L}'’-]*/gu;

/** [from, to) of the block's text with its bold and italic parts. */
function renderText(b: Block, from: number, to: number): ReactNode[] {
  const spans = b.spans ?? [];
  const cuts = new Set([from, to]);
  for (const s of spans) for (const p of [s.start, s.end]) if (p > from && p < to) cuts.add(p);
  const points = [...cuts].sort((x, y) => x - y);
  return points.slice(0, -1).map((start, k) => {
    const end = points[k + 1];
    let node: ReactNode = b.text.slice(start, end);
    if (spans.some((s) => s.bold && s.start <= start && s.end >= end)) node = <b>{node}</b>;
    if (spans.some((s) => s.italic && s.start <= start && s.end >= end)) node = <i>{node}</i>;
    return <Fragment key={start}>{node}</Fragment>;
  });
}

/** One block: its text, then its translation (one line under each sentence, or a box below) and the small link. */
const BlockView = memo(function BlockView(props: {
  block: Block;
  i: number;
  lang: string;
  translation: string | undefined;
  loading: boolean;
  interlinear: boolean;
  onTranslate: (i: number) => void;
  onHide: (i: number) => void;
}) {
  const { block, i, translation } = props;
  const sentences = props.interlinear && translation !== undefined ? sentenceRanges(block.text, props.lang) : null;
  const lines = translation?.split('\n');
  const asLines = sentences && lines && sentences.length > 0 && lines.length === sentences.length;
  return (
    <div data-i={i} className={`block ${block.type}`}>
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
      {props.loading ? (
        <span data-tr="1" className="tr-loading" />
      ) : (
        <button type="button" data-tr="1" className="para-link" onClick={() => (translation !== undefined ? props.onHide(i) : props.onTranslate(i))}>
          {translation !== undefined ? 'ocultar' : '文A traduzir'}
        </button>
      )}
    </div>
  );
});

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

  useEffect(() => {
    db.get<(Block | string)[]>('texts', id).then((b) => setBlocks(asBlocks(b ?? [])));
    record('sessions');
  }, [id]);

  useEffect(() => {
    paragraphTranslations(id, src, tgt).then(setTranslations);
  }, [id, src, tgt]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

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
        db.put('books', { ...bookRef.current, lastBlock: lo });
      }, 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [blocks]);

  // the marks drawn over the text: the looked-up word, saved words and expressions, a search result
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

  useEffect(() => () => ['word', 'saved', 'search'].forEach((n) => mark(n, [])), []);

  function lookUp(block: number, start: number, end: number) {
    if (!blocks) return;
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

  function onTap(e: MouseEvent) {
    if ((e.target as Element).closest('[data-tr]')) return;
    const caret = caretAt(e.clientX, e.clientY);
    const el = caret?.node.parentElement?.closest<HTMLElement>('[data-i]');
    const offset = caret && el ? offsetIn(el, caret.node, caret.offset) : null;
    if (!el || offset === null || !blocks) return setLookup(null);
    const block = Number(el.dataset.i);
    const w = wordAt(blocks[block].text, offset, src);
    if (w) lookUp(block, w.start, w.end);
    else setLookup(null);
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

  // an expression grows by whole words, within the sentence
  let growBack: { start: number; end: number } | null = null;
  let growOn: { start: number; end: number } | null = null;
  if (lookup && blocks) {
    const text = blocks[lookup.block].text;
    const sentence = sentenceRanges(text, src).find(([s, e]) => lookup.start >= s && lookup.start < e) ?? [0, text.length];
    growBack = previousWord(text, lookup.start, src);
    if (growBack && growBack.start < sentence[0]) growBack = null;
    growOn = nextWord(text, lookup.end, src);
    if (growOn && growOn.end > sentence[1]) growOn = null;
  }

  // the list itself only changes with the text or its translations, never with a lookup, a panel or a toast
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
          onTranslate={onTranslate}
          onHide={onHide}
        />
      )),
    [blocks, src, translations, loading, prefs.interlinear, onTranslate, onHide],
  );

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
      >
        {pages}
      </div>

      <footer className="bottombar">
        <span className="small">{percent}%</span>
        <span className="grow" />
        <button type="button" className="icon" aria-label="Sumário" onClick={() => setPanel('toc')}>
          <List />
        </button>
        <button type="button" className="icon" aria-label="Buscar no livro" onClick={() => setPanel('search')}>
          <Search />
        </button>
      </footer>

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
    </main>
  );
}
