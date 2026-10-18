import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Book, db } from './store';
import { sentenceAt, wordAt } from './text';
import { errorText, saveWord, translateWord } from './words';

/** A tapped word: paragraph [block], characters [start, end). */
interface Pick {
  block: number;
  start: number;
  end: number;
  word: string;
  sentence: string;
}

/** Where a tap landed in the text: Safari only has caretRangeFromPoint, the others the standard caretPositionFromPoint. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const pos = document.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

export function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const [blocks, setBlocks] = useState<string[] | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [result, setResult] = useState<{ text?: string; error?: string }>({});
  const [saved, setSaved] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const paragraph = (i: number) => textRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);

  useEffect(() => {
    db.get<string[]>('texts', book.id as number).then((b) => setBlocks(b ?? []));
  }, [book.id]);

  // back to the paragraph the book was left on, then remember the first one on screen as the reader scrolls
  useLayoutEffect(() => {
    if (!blocks) return;
    paragraph(book.lastBlock)?.scrollIntoView();
    let timer: number | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ps = textRef.current?.children;
        if (!ps?.length) return;
        // binary search for the first paragraph not yet scrolled under the top bar (paragraphs are in page order)
        const line = headerRef.current?.getBoundingClientRect().bottom ?? 0;
        let lo = 0;
        let hi = ps.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ps[mid].getBoundingClientRect().bottom > line) hi = mid;
          else lo = mid + 1;
        }
        db.put('books', { ...book, lastBlock: lo });
      }, 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [blocks, book]);

  useEffect(() => {
    if (!pick) return;
    let current = true;
    setResult({});
    setSaved(false);
    translateWord(pick.word, pick.sentence, book.language).then(
      (text) => current && setResult({ text }),
      (e) => current && setResult({ error: errorText(e) }),
    );
    // marks the word in the text where the browser supports CSS highlights (Safari 17.2+, Chrome)
    const node = paragraph(pick.block)?.firstChild;
    if (node && 'highlights' in CSS) {
      const range = new Range();
      range.setStart(node, pick.start);
      range.setEnd(node, pick.end);
      CSS.highlights.set('word', new Highlight(range));
    }
    return () => {
      current = false;
      if ('highlights' in CSS) CSS.highlights.delete('word');
    };
  }, [pick, book.language]);

  function onTap(e: MouseEvent) {
    const caret = caretAt(e.clientX, e.clientY);
    const el = caret?.node.parentElement?.closest<HTMLElement>('[data-i]');
    if (!caret || !el || !blocks) return setPick(null);
    const block = Number(el.dataset.i);
    const text = blocks[block];
    const w = wordAt(text, caret.offset, book.language);
    if (!w) return setPick(null);
    setPick({ block, ...w, word: text.slice(w.start, w.end), sentence: sentenceAt(text, w.start, book.language) });
  }

  async function save() {
    if (!pick || !result.text) return;
    await saveWord(pick.word, result.text, book.language, book.title, pick.sentence);
    setSaved(true);
  }

  return (
    <main className="reader">
      <header ref={headerRef} className="topbar">
        <button type="button" className="text" onClick={onClose}>
          ‹ Biblioteca
        </button>
        <span className="topbar-title">{book.title}</span>
      </header>

      <div ref={textRef} className="pages" onClick={onTap}>
        {blocks?.map((t, i) => (
          <p key={i} data-i={i}>
            {t}
          </p>
        ))}
      </div>

      {pick && (
        <section className="sheet" aria-live="polite">
          <div className="sheet-head">
            <strong>{pick.word}</strong>
            <button type="button" className="text" aria-label="Fechar" onClick={() => setPick(null)}>
              ✕
            </button>
          </div>
          <p className={result.error ? 'error' : 'translation'}>{result.text ?? result.error ?? 'Traduzindo…'}</p>
          <button type="button" className="button primary wide" disabled={!result.text || saved} onClick={save}>
            {saved ? 'Salva no vocabulário ✓' : 'Salvar no vocabulário'}
          </button>
        </section>
      )}
    </main>
  );
}
