/**
 * The Android app's BookParser.kt, rule for rule: reading positions and highlights sync by block index and text offset,
 * so both apps must cut a book into exactly the same blocks. Book markup is only tokenized, never handed to the DOM.
 * PDF comes later.
 */
import { strFromU8, unzipSync } from 'fflate';

/** Bold or italic text inside a block: [start, end) of its text. */
export interface Span {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
}

/** A link from [start, end) of a block's text to block [target] of the same book (contents pages, footnotes). */
export interface Link {
  start: number;
  end: number;
  target: number;
}

/** A text block; 'img' blocks carry the image file name in [image] and its alt text in [text]. */
export interface Block {
  type: 'p' | 'h' | 'q' | 'poem' | 'li' | 'img';
  text: string;
  spans?: Span[];
  image?: string;
  links?: Link[];
}

export interface TocEntry {
  title: string;
  block: number;
}

export interface ParsedBook {
  title: string;
  fileType: 'epub' | 'fb2' | 'txt';
  /** Primary language subtag from the book's metadata, e.g. "en" (the Android app guesses it from the text instead). */
  language: string;
  blocks: Block[];
  /** Image file name -> its bytes. */
  images: Record<string, Uint8Array>;
  toc: TocEntry[];
}

/** Books saved before blocks had types are plain strings. */
export const asBlocks = (stored: (Block | string)[]): Block[] => stored.map((b) => (typeof b === 'string' ? { type: 'p', text: b } : b));

const MAX_BLOCK = 1500;
const HARD_MAX_BLOCK = 3500;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
// Kotlin's Char.isWhitespace (text is collapsed and trimmed with it) and \s of the regexes, as ICU reads it on Android
const KT_WS = '\\t\\n\\v\\f\\r\\x1C-\\x1F\\p{Zs}\\u2028\\u2029';
const S = '[\\t\\n\\f\\r\\p{Z}]';
const WS = new RegExp(`${S}+`, 'gu');
const KT_WS_RUN = new RegExp(`[${KT_WS}]+`, 'gu');
const KT_TRIM = new RegExp(`^[${KT_WS}]+|[${KT_WS}]+$`, 'gu');
const KT_TRIM_END = new RegExp(`[${KT_WS}]+$`, 'u');
const trim = (s: string) => s.replace(KT_TRIM, '');

const TAG = /<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>|<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>/g;
const ENTITY = /&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+\d*);/g;
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  copy: '©',
};
const EXTERNAL = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SENTENCE_GAP = new RegExp(`(?<=[.!?…。！？])${S}+`, 'gu');

// Formats without markup (TXT) still announce chapters in words; those short lines become headings for the table of contents.
const W = '[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]';
const BOUNDARY = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const CHAPTER = new RegExp(
  `^(?:(chapter|cap[ií]tulo|cap\\.|part|parte|livro|book|section|se[çc][ãa]o)${S}+[\\p{L}\\p{M}\\p{Nd}\\p{Pc}.]+${BOUNDARY}.*` +
    `|(prologue|pr[óo]logo|epilogue|ep[íi]logo|introduction|introdu[çc][ãa]o|preface|pref[áa]cio|foreword|afterword|posf[áa]cio)${BOUNDARY}.*)$`,
  'iu',
);
const classify = (text: string): Block['type'] => (text.length <= 80 && CHAPTER.test(text) ? 'h' : 'p');

// Only common named entities are decoded; unknown ones stay literal.
function decodeEntities(s: string): string {
  return s.replace(ENTITY, (m, e: string) => {
    if (e[0] !== '#') return NAMED[e] ?? m;
    try {
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    } catch {
      return m;
    }
  });
}

const decode = (s: string) => trim(decodeEntities(s).replace(WS, ' '));

const attrs = new Map<string, RegExp>();
/** Attribute value; also matches namespaced names (xlink:href, l:href). */
function attr(tag: string, name: string): string | null {
  let re = attrs.get(name);
  if (!re) attrs.set(name, (re = new RegExp(`${S}(?:[\\w-]+:)?${name}${S}*=${S}*(["'])(.*?)\\1`, 'u')));
  return re.exec(tag)?.[2] ?? null;
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolve(dir: string, href: string): string {
  const raw = href.split('#')[0];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // a stray % stays as it is
  }
  const parts: string[] = [];
  for (const p of ((dir ? `${dir}/` : '') + decoded).split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '' && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

const anchorKey = (file: string, href: string) => {
  const id = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
  return id ? `${file}#${id}` : file;
};

/** XML or HTML in the encoding it declares, UTF-8 otherwise. */
function xmlText(bytes: Uint8Array): string {
  const enc = /encoding\s*=\s*["']([\w.-]+)/.exec(strFromU8(bytes.subarray(0, 200), true))?.[1];
  let text: string;
  try {
    text = new TextDecoder(enc ?? 'utf-8').decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

// Non-UTF-8 text files are read as Windows-1252 (Western languages).
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const B64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));

/** Whitespace and '=' padding are skipped, like the Android app's hand-written decoder. */
function base64(s: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    const v = B64.get(c);
    if (v === undefined) continue;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

class ImageStore {
  bytes: Record<string, Uint8Array> = {};
  private names = new Map<string, string>();

  /** The image's file name in the book, or null for SVG and unknown formats (skipped). */
  add(key: string, data: Uint8Array): string | null {
    const known = this.names.get(key);
    if (known) return known;
    const ext = IMAGE_EXT.exec(key)?.[0].toLowerCase() ?? sniff(data);
    if (!ext) return null;
    const name = `${this.names.size}${ext}`;
    this.names.set(key, name);
    this.bytes[name] = data;
    return name;
  }
}

function sniff(d: Uint8Array): string | null {
  if (d.length > 3 && d[0] === 0xff && d[1] === 0xd8) return '.jpg';
  if (d.length > 3 && d[0] === 0x89 && d[1] === 0x50) return '.png';
  if (d.length > 3 && d[0] === 0x47 && d[1] === 0x49) return '.gif';
  return null;
}

interface Markup {
  /** Decides a block's type, first match wins. */
  ctx: [string, Block['type']][];
  /** Ends the current block. */
  breaks: Set<string>;
  /** Content ignored entirely. */
  skip: Set<string>;
  bold: Set<string>;
  italic: Set<string>;
  images: Set<string>;
}

const HTML: Markup = {
  ctx: [
    ['h1', 'h'],
    ['h2', 'h'],
    ['h3', 'h'],
    ['h4', 'h'],
    ['h5', 'h'],
    ['h6', 'h'],
    ['blockquote', 'q'],
    ['li', 'li'],
  ],
  breaks: new Set(['p', 'div', 'section', 'article', 'pre', 'td', 'th', 'tr', 'dd', 'dt', 'figcaption', 'ul', 'ol', 'table', 'hr', 'br', 'body', 'header', 'footer', 'aside', 'nav']),
  skip: new Set(['head', 'script', 'style', 'math']),
  bold: new Set(['b', 'strong']),
  italic: new Set(['i', 'em']),
  images: new Set(['img', 'image']),
};

const FB2: Markup = {
  ctx: [
    ['title', 'h'],
    ['subtitle', 'h'],
    ['poem', 'poem'],
    ['cite', 'q'],
    ['epigraph', 'q'],
  ],
  breaks: new Set(['p', 'v', 'stanza', 'section', 'text-author', 'empty-line', 'body']),
  skip: new Set(['description', 'binary']),
  bold: new Set(['strong']),
  italic: new Set(['emphasis']),
  images: new Set(['image']),
};

interface RawLink {
  block: number;
  start: number;
  end: number;
  href: string;
}

interface Parsed {
  blocks: Block[];
  /** Element ids -> the block they open; link hrefs are resolved by the caller, which knows the files. */
  anchors: Map<string, number>;
  links: RawLink[];
}

const count = (n: number, closing: boolean) => Math.max(0, n + (closing ? -1 : 1));

function groupBy<T>(list: T[], key: (x: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const x of list) {
    const k = key(x);
    const group = out.get(k);
    if (group) group.push(x);
    else out.set(k, [x]);
  }
  return out;
}

function markupBlocks(src: string, m: Markup, image: (tag: string) => string | null): Parsed {
  const out: Block[] = [];
  const anchors = new Map<string, number>();
  const links: RawLink[] = [];
  let linkHref: string | null = null;
  let linkStart = 0;
  let sb = '';
  let spans: { start: number; end: number; bold: boolean; italic: boolean }[] = [];
  const depth = new Map<string, number>();
  let skipping = 0;
  let bold = 0;
  let italic = 0;
  let pos = 0;

  // Appends text with entities decoded and whitespace collapsed, so span offsets match the final string.
  const text = (raw: string) => {
    const start = sb.length;
    let piece = decodeEntities(raw).replace(KT_WS_RUN, ' ');
    if (sb === '' || sb.endsWith(' ')) piece = piece.replace(/^ /, '');
    sb += piece;
    if ((bold > 0 || italic > 0) && sb.length > start) {
      const last = spans.at(-1);
      if (last && last.end === start && last.bold === bold > 0 && last.italic === italic > 0) last.end = sb.length;
      else spans.push({ start, end: sb.length, bold: bold > 0, italic: italic > 0 });
    }
  };

  const flush = () => {
    if (sb.endsWith(' ')) sb = sb.slice(0, -1);
    if (sb) {
      const type = m.ctx.find(([k]) => (depth.get(k) ?? 0) > 0)?.[1] ?? 'p';
      const kept = spans
        .map((s) => ({ ...s, end: Math.min(s.end, sb.length) }))
        .filter((s) => s.end > s.start)
        .map((s) => ({ start: s.start, end: s.end, ...(s.bold && { bold: true }), ...(s.italic && { italic: true }) }));
      out.push({ type, text: sb, ...(kept.length && { spans: kept }) });
      // a link still open continues in the next block
      if (linkHref !== null && sb.length > linkStart) links.push({ block: out.length - 1, start: linkStart, end: sb.length, href: linkHref });
      linkStart = 0;
    }
    sb = '';
    spans = [];
  };

  for (const match of src.matchAll(TAG)) {
    if (skipping === 0) text(src.slice(pos, match.index));
    pos = match.index + match[0].length;
    const full = match[2] ?? '';
    const name = (full.includes(':') ? full.slice(full.indexOf(':') + 1) : full).toLowerCase();
    const closing = !!match[1];
    const selfClosing = !!match[3];
    if (!name) {
      // a comment, doctype or processing instruction
    } else if (m.skip.has(name)) {
      if (!selfClosing) skipping = count(skipping, closing);
    } else if (skipping > 0) {
      // inside skipped content
    } else if (name === 'a') {
      if (closing) {
        if (linkHref !== null) {
          if (sb.length > linkStart) links.push({ block: out.length, start: linkStart, end: sb.length, href: linkHref });
          linkHref = null;
        }
      } else if (!selfClosing) {
        const href = attr(match[0], 'href');
        if (href !== null && !EXTERNAL.test(href)) {
          linkHref = href;
          linkStart = sb.length;
        }
      }
    } else if (m.bold.has(name)) {
      if (!selfClosing) bold = count(bold, closing);
    } else if (m.italic.has(name)) {
      if (!selfClosing) italic = count(italic, closing);
    } else if (m.images.has(name)) {
      const file = closing ? null : image(match[0]);
      if (file !== null) {
        flush();
        out.push({ type: 'img', text: attr(match[0], 'alt') ?? '', image: file });
      }
    } else if (m.ctx.some(([k]) => k === name)) {
      flush();
      if (!selfClosing) depth.set(name, count(depth.get(name) ?? 0, closing));
    } else if (m.breaks.has(name)) flush();
    // recorded after the tag's own flush, so an id on a heading points at the heading, not the paragraph before
    if (!closing && skipping === 0) {
      const id = attr(match[0], 'id') ?? (name === 'a' ? attr(match[0], 'name') : null);
      if (id !== null && !anchors.has(id)) anchors.set(id, out.length);
    }
  }
  if (skipping === 0) text(src.slice(pos));
  flush();
  return { blocks: out, anchors, links };
}

/** One HTML document's blocks (for tests). */
export const htmlBlocks = (src: string) => markupBlocks(src, HTML, () => null).blocks;

/** Plain text: blank lines separate paragraphs, unless the file barely has any (then one line = one paragraph). */
export function txt(s: string): Block[] {
  const t = s.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = (t.match(/\n/g)?.length ?? 0) + 1;
  const blanks = t.match(/\n[ \t]*\n/g)?.length ?? 0;
  const paras = blanks * 20 >= lines ? t.split(/\n[ \t]*\n/) : t.split('\n');
  return paras.map((p) => trim(p.replace(WS, ' '))).filter(Boolean).map((text) => ({ type: classify(text), text }));
}

/** [from, to) of a block, with its styles and links moved along. */
function slice(b: Block, from: number, to: number): Block {
  const text = b.text.slice(from, to).replace(KT_TRIM_END, '');
  const end = from + text.length;
  const cut = <T extends { start: number; end: number }>(list: T[] | undefined) =>
    (list ?? []).flatMap((x) => (x.end <= from || x.start >= end ? [] : [{ ...x, start: Math.max(x.start, from) - from, end: Math.min(x.end, end) - from }]));
  const spans = cut(b.spans);
  const links = cut(b.links);
  const { spans: _, links: __, ...rest } = b;
  return { ...rest, text, ...(spans.length && { spans }), ...(links.length && { links }) };
}

/** Keeps blocks small enough for one translation request: split at sentence ends, hard-split as a last resort. */
function splitLong(b: Block): Block[] {
  if (b.text.length <= MAX_BLOCK) return [b];
  const pieces: Block[] = [];
  let start = 0;
  let prev = 0;
  const cuts = [...b.text.matchAll(SENTENCE_GAP)].map((m) => m.index + m[0].length);
  cuts.push(b.text.length);
  for (const cut of cuts) {
    if (cut - start > MAX_BLOCK && prev > start) {
      pieces.push(slice(b, start, prev));
      start = prev;
    }
    prev = cut;
  }
  pieces.push(slice(b, start, b.text.length));
  return pieces.flatMap((p) => {
    if (p.text.length <= HARD_MAX_BLOCK) return [p];
    const hard: Block[] = [];
    for (let i = 0; i < p.text.length; i += HARD_MAX_BLOCK) hard.push(slice(p, i, Math.min(i + HARD_MAX_BLOCK, p.text.length)));
    return hard;
  });
}

const metaText = (doc: string, tag: string) => {
  const raw = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(doc)?.[1];
  return raw === undefined ? null : decode(raw.replace(TAG, ''));
};
const languageOf = (code: string | null) => (code || 'en').split('-')[0].toLowerCase();

function epub(files: Record<string, Uint8Array>, fallback: string): Omit<ParsedBook, 'fileType'> {
  const container = xmlText(files['META-INF/container.xml']);
  const root = /<(?:\w+:)?rootfile\b[^>]*>/.exec(container)?.[0];
  const opfPath = root ? attr(root, 'full-path') : null;
  if (!opfPath) throw new Error('EPUB sem o arquivo de conteúdo (OPF).');
  if (!files[opfPath]) throw new Error(`EPUB sem o arquivo ${opfPath}.`);
  const opf = xmlText(files[opfPath]);
  const items = [...opf.matchAll(/<(?:\w+:)?item\b[^>]*>/g)].map((m) => m[0]);
  const manifest = new Map(items.map((it) => [attr(it, 'id'), attr(it, 'href')]));
  const opfDir = dirOf(opfPath);
  const images = new ImageStore();
  const blocks: Block[] = [];
  const anchors = new Map<string, number>(); // "file" and "file#id" -> block
  const links: [RawLink, string][] = []; // with the target resolved to "file" or "file#id"
  for (const m of opf.matchAll(/<(?:\w+:)?itemref\b[^>]*>/g)) {
    const href = manifest.get(attr(m[0], 'idref'));
    if (href === undefined || href === null) continue;
    const chapter = resolve(opfDir, href);
    if (!files[chapter]) continue;
    const html = xmlText(files[chapter]);
    const chapterDir = dirOf(chapter);
    const base = blocks.length;
    const parsed = markupBlocks(html, HTML, (tag) => {
      const src = attr(tag, 'src') ?? attr(tag, 'href');
      if (src === null) return null;
      const path = resolve(chapterDir, src);
      return files[path] ? images.add(path, files[path]) : null;
    });
    anchors.set(chapter, base);
    for (const [id, i] of parsed.anchors) anchors.set(`${chapter}#${id}`, base + i);
    for (const l of parsed.links) {
      const file = l.href.startsWith('#') ? chapter : resolve(chapterDir, l.href);
      links.push([{ ...l, block: base + l.block }, anchorKey(file, l.href)]);
    }
    for (const b of parsed.blocks) blocks.push(b);
  }
  const target = (key: string) => {
    const at = anchors.get(key) ?? anchors.get(key.split('#')[0]);
    return at === undefined ? null : Math.min(at, blocks.length - 1);
  };
  for (const [i, group] of groupBy(links, ([l]) => l.block)) {
    const inBlock = group.flatMap(([l, key]) => {
      const t = target(key);
      return t === null ? [] : [{ start: l.start, end: Math.min(l.end, blocks[i].text.length), target: t }];
    });
    if (inBlock.length) blocks[i] = { ...blocks[i], links: inBlock };
  }
  return {
    title: metaText(opf, 'dc:title') || fallback,
    language: languageOf(metaText(opf, 'dc:language')),
    blocks,
    images: images.bytes,
    toc: epubToc(files, items, opfDir, target),
  };
}

function epubToc(files: Record<string, Uint8Array>, items: string[], opfDir: string, target: (key: string) => number | null): TocEntry[] {
  const entry = (title: string, dir: string, href: string) => {
    const block = target(anchorKey(resolve(dir, href), href));
    return block === null ? [] : [{ title: decode(title.replace(TAG, ' ')), block }];
  };
  const navItem = items.find((it) => attr(it, 'properties')?.split(' ').includes('nav'));
  const nav = navItem ? attr(navItem, 'href') : null;
  if (nav !== null) {
    const path = resolve(opfDir, nav);
    const doc = files[path] ? xmlText(files[path]) : '';
    const section = /<(?:\w+:)?nav\b[^>]*toc[^>]*>([\s\S]*?)<\/(?:\w+:)?nav>/.exec(doc)?.[1] ?? doc;
    const dir = dirOf(path);
    const entries = [...section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].flatMap((m) => {
      const href = attr(` ${m[1]}`, 'href');
      return href === null ? [] : entry(m[2], dir, href);
    });
    if (entries.length) return entries;
  }
  const ncxItem = items.find((it) => attr(it, 'media-type') === 'application/x-dtbncx+xml');
  const ncx = ncxItem ? attr(ncxItem, 'href') : null;
  if (ncx === null) return [];
  const path = resolve(opfDir, ncx);
  const dir = dirOf(path);
  const navPoint = new RegExp(`<navLabel>${S}*<text>([\\s\\S]*?)</text>${S}*</navLabel>${S}*<content\\b([^>]*)>`, 'gu');
  return [...(files[path] ? xmlText(files[path]) : '').matchAll(navPoint)].flatMap((m) => {
    const src = attr(` ${m[2]}`, 'src');
    return src === null ? [] : entry(m[1], dir, src);
  });
}

function fb2(bytes: Uint8Array, fallback: string): Omit<ParsedBook, 'fileType'> {
  const xml = xmlText(bytes);
  const binaries = new Map<string, string>();
  for (const m of xml.matchAll(/<binary\b([^>]*)>([\s\S]*?)<\/binary>/g)) {
    const id = attr(m[1], 'id');
    if (id !== null) binaries.set(id, m[2]);
  }
  const images = new ImageStore();
  const parsed = markupBlocks(xml, FB2, (tag) => {
    const id = attr(tag, 'href')?.replace(/^#/, '');
    const data = id === undefined ? undefined : binaries.get(id);
    return id === undefined || data === undefined ? null : images.add(id, base64(data));
  });
  const blocks = [...parsed.blocks];
  for (const [i, group] of groupBy(parsed.links, (l) => l.block)) {
    const inBlock = group.flatMap((l) => {
      const t = parsed.anchors.get(l.href.replace(/^#/, ''));
      return t === undefined ? [] : [{ start: l.start, end: Math.min(l.end, blocks[i].text.length), target: Math.min(t, blocks.length - 1) }];
    });
    if (inBlock.length) blocks[i] = { ...blocks[i], links: inBlock };
  }
  const title = /<book-title>([\s\S]*?)<\/book-title>/.exec(xml)?.[1];
  return { title: (title && decode(title)) || fallback, language: languageOf(metaText(xml, 'lang')), blocks, images: images.bytes, toc: [] };
}

/** EPUB, FB2 (also zipped) or TXT. */
export function parseBook(fileName: string, bytes: Uint8Array): ParsedBook {
  const dot = fileName.lastIndexOf('.');
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
  const fallback = trim(stem) ? stem : fileName;
  const head = strFromU8(bytes.subarray(0, 1024), true);
  let book: ParsedBook;
  if (head.startsWith('%PDF')) throw new Error('PDF ainda não abre aqui; use EPUB, FB2 ou TXT.');
  if (head.startsWith('PK')) {
    const files = Object.fromEntries(Object.entries(unzipSync(bytes)).filter(([name]) => !name.endsWith('/')));
    const inner = Object.keys(files).find((k) => k.toLowerCase().endsWith('.fb2'));
    if ('META-INF/container.xml' in files) book = { ...epub(files, fallback), fileType: 'epub' };
    else if (inner) book = { ...fb2(files[inner], fallback), fileType: 'fb2' };
    else throw new Error('Este arquivo compactado não tem um EPUB nem um FB2.');
  } else if (head.includes('<FictionBook')) book = { ...fb2(bytes, fallback), fileType: 'fb2' };
  else if (/\.txt$/i.test(fileName)) book = { title: fallback, fileType: 'txt', language: 'en', blocks: txt(decodeText(bytes)), images: {}, toc: [] };
  else throw new Error('Formato não aceito: use EPUB, FB2 ou TXT.');

  // splitting long blocks shifts indices, so links and the table of contents are remapped through the same split
  const blocks: Block[] = [];
  const newIndex: number[] = [];
  book.blocks.forEach((b, i) => {
    newIndex[i] = blocks.length;
    for (const piece of splitLong(b)) blocks.push(piece);
  });
  const moved = (block: number) => newIndex[block] ?? blocks.length - 1;
  const linked = blocks.map((b) => (b.links ? { ...b, links: b.links.map((l) => ({ ...l, target: moved(l.target) })) } : b));
  if (!linked.length) throw new Error('Não encontrei texto neste livro.');
  const toc = book.toc.map((e) => ({ ...e, block: moved(e.block) }));
  // without a table of contents of its own, the headings stand in
  if (!toc.length) linked.forEach((b, i) => b.type === 'h' && b.text.length <= 120 && toc.push({ title: b.text, block: i }));
  return { ...book, blocks: linked, toc };
}
