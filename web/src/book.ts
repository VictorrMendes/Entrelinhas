import { strFromU8, unzipSync } from 'fflate';
import { txtBlocks } from './text';

/** Bold or italic text inside a block: [start, end) of its text. */
export interface Span {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
}

/** One paragraph-like piece of a book, like the Android app's Block (images aren't read yet). */
export interface Block {
  type: 'p' | 'h' | 'q' | 'li';
  text: string;
  spans?: Span[];
}

export interface TocEntry {
  title: string;
  block: number;
}

export interface ParsedBook {
  title: string;
  /** Primary language subtag, e.g. "en". */
  language: string;
  blocks: Block[];
  toc: TocEntry[];
}

/** Books saved before blocks had types are plain strings. */
export const asBlocks = (stored: (Block | string)[]): Block[] => stored.map((b) => (typeof b === 'string' ? { type: 'p', text: b } : b));

const TYPES: Record<string, Block['type']> = { h1: 'h', h2: 'h', h3: 'h', h4: 'h', h5: 'h', h6: 'h', blockquote: 'q', li: 'li' };

/** The element's text with spaces collapsed, and where it is bold or italic. */
function flatten(el: Element): { text: string; spans: Span[] } {
  let text = '';
  const spans: Span[] = [];
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        let piece = (child.textContent ?? '').replace(/\s+/g, ' ');
        if (text === '' || text.endsWith(' ')) piece = piece.replace(/^ /, '');
        if (!piece) continue;
        const start = text.length;
        text += piece;
        if (bold || italic) spans.push({ start, end: text.length, ...(bold && { bold }), ...(italic && { italic }) });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).localName;
        if (tag === 'br') {
          if (text && !text.endsWith(' ')) text += ' ';
        } else walk(child, bold || tag === 'b' || tag === 'strong', italic || tag === 'i' || tag === 'em');
      }
    }
  };
  walk(el, false, false);
  const trimmed = text.replace(/ $/, '');
  return { text: trimmed, spans: spans.filter((s) => s.start < trimmed.length).map((s) => ({ ...s, end: Math.min(s.end, trimmed.length) })) };
}

/** EPUB (spine order) or TXT. Only text is read: book HTML never reaches the page. */
export function parseBook(fileName: string, data: Uint8Array): ParsedBook {
  const name = fileName.replace(/\.[^.]+$/, '');
  if (/\.txt$/i.test(fileName)) {
    return { title: name, language: 'en', blocks: txtBlocks(new TextDecoder().decode(data)).map((text) => ({ type: 'p', text })), toc: [] };
  }

  const files = unzipSync(data);
  const read = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`EPUB sem o arquivo ${path}`);
    return strFromU8(file);
  };
  const parse = (path: string) => {
    const source = read(path);
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    return doc.querySelector('parsererror') ? new DOMParser().parseFromString(source, 'text/html') : doc;
  };
  // hrefs are relative to the file that holds them and may climb with ../ or point at an #anchor
  const resolve = (href: string, from: string) => decodeURIComponent(new URL(href, `http://book/${from}`).pathname.slice(1));

  const opfPath = parse('META-INF/container.xml').querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB sem container.xml válido');
  const opf = parse(opfPath);
  const meta = (tag: string) => opf.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim();
  const items = [...opf.querySelectorAll('manifest > item')];
  const hrefOf = new Map(items.map((i) => [i.getAttribute('id'), i.getAttribute('href') ?? '']));

  const blocks: Block[] = [];
  const firstBlock = new Map<string, number>(); // spine file -> its first block, for the table of contents
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = hrefOf.get(ref.getAttribute('idref'));
    if (!href) continue;
    const path = resolve(href, opfPath);
    firstBlock.set(path, blocks.length);
    for (const el of parse(path).querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre')) {
      if (el.querySelector('p, li, blockquote')) continue; // a wrapper: its children are blocks of their own
      const { text, spans } = flatten(el);
      if (text) blocks.push({ type: TYPES[el.localName] ?? 'p', text, ...(spans.length && { spans }) });
    }
  }
  if (!blocks.length) throw new Error('Não encontrei texto neste EPUB');

  // the book's own contents: EPUB 3 nav, else the EPUB 2 NCX; without either, the headings
  const toc: TocEntry[] = [];
  const add = (title: string | null | undefined, href: string | null | undefined, from: string) => {
    const block = href ? firstBlock.get(resolve(href.split('#')[0], from)) : undefined;
    if (title?.trim() && block !== undefined) toc.push({ title: title.replace(/\s+/g, ' ').trim(), block });
  };
  const nav = items.find((i) => (i.getAttribute('properties') ?? '').split(' ').includes('nav'));
  const ncx = items.find((i) => i.getAttribute('media-type') === 'application/x-dtbncx+xml');
  try {
    if (nav) {
      const path = resolve(nav.getAttribute('href') ?? '', opfPath);
      const doc = parse(path);
      const list = [...doc.querySelectorAll('nav')].find((n) => n.getAttribute('epub:type') === 'toc' || n.getAttributeNS('*', 'type') === 'toc') ?? doc.querySelector('nav');
      for (const a of list?.querySelectorAll('a') ?? []) add(a.textContent, a.getAttribute('href'), path);
    } else if (ncx) {
      const path = resolve(ncx.getAttribute('href') ?? '', opfPath);
      for (const point of parse(path).getElementsByTagNameNS('*', 'navPoint')) {
        add(point.getElementsByTagNameNS('*', 'text')[0]?.textContent, point.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src'), path);
      }
    }
  } catch {
    // a broken contents file isn't worth refusing the book over: the headings stand in
  }
  if (!toc.length) blocks.forEach((b, i) => b.type === 'h' && b.text.length <= 120 && toc.push({ title: b.text, block: i }));

  return { title: meta('title') || name, language: (meta('language') || 'en').split('-')[0].toLowerCase(), blocks, toc };
}
