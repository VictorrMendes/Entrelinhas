/**
 * The Android app's BookParser.kt, rule for rule: reading positions and highlights sync by block index and text offset,
 * so both apps must cut a book into exactly the same blocks. The server reads the books the web app shows; book markup
 * is only tokenized, never rendered. PDFs: the app reads them with PDFBox, this with pdf.js, glyph by glyph as PDFBox.
 */
import { strFromU8, unzipSync } from 'fflate';
import { encode } from 'jpeg-js';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

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
  fileType: 'epub' | 'fb2' | 'txt' | 'pdf';
  /** Primary language subtag from the book's metadata, e.g. "en" (the Android app guesses it from the text instead). */
  language: string;
  blocks: Block[];
  /** Image file name -> its bytes. */
  images: Record<string, Uint8Array>;
  /** The declared cover, else the first image (a PDF's first page). */
  cover?: Uint8Array;
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
  if (!re) {
    re = new RegExp(`${S}(?:[\\w-]+:)?${name}${S}*=${S}*(["'])(.*?)\\1`, 'u');
    attrs.set(name, re);
  }
  return re.exec(tag)?.[2] ?? null;
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolve(dir: string, href: string): string {
  const raw = href.split('#')[0] as string;
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
  breaks: new Set([
    'p',
    'div',
    'section',
    'article',
    'pre',
    'td',
    'th',
    'tr',
    'dd',
    'dt',
    'figcaption',
    'ul',
    'ol',
    'table',
    'hr',
    'br',
    'body',
    'header',
    'footer',
    'aside',
    'nav',
  ]),
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
      if (linkHref !== null && sb.length > linkStart)
        links.push({ block: out.length - 1, start: linkStart, end: sb.length, href: linkHref });
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
  return paras
    .map((p) => trim(p.replace(WS, ' ')))
    .filter(Boolean)
    .map((text) => ({ type: classify(text), text }));
}

/** [from, to) of a block, with its styles and links moved along. */
function slice(b: Block, from: number, to: number): Block {
  const text = b.text.slice(from, to).replace(KT_TRIM_END, '');
  const end = from + text.length;
  const cut = <T extends { start: number; end: number }>(list: T[] | undefined) =>
    (list ?? []).flatMap((x) =>
      x.end <= from || x.start >= end ? [] : [{ ...x, start: Math.max(x.start, from) - from, end: Math.min(x.end, end) - from }],
    );
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
const languageOf = (code: string | null) => ((code || 'en').split('-')[0] as string).toLowerCase();

function epub(files: Record<string, Uint8Array>, fallback: string): Omit<ParsedBook, 'fileType'> {
  const container = xmlText(files['META-INF/container.xml'] as Uint8Array);
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
    const at = anchors.get(key) ?? anchors.get(key.split('#')[0] as string);
    return at === undefined ? null : Math.min(at, blocks.length - 1);
  };
  for (const [i, group] of groupBy(links, ([l]) => l.block)) {
    const inBlock = group.flatMap(([l, key]) => {
      const t = target(key);
      return t === null ? [] : [{ start: l.start, end: Math.min(l.end, (blocks[i] as Block).text.length), target: t }];
    });
    if (inBlock.length) blocks[i] = { ...(blocks[i] as Block), links: inBlock };
  }
  return {
    title: metaText(opf, 'dc:title') || fallback,
    language: languageOf(metaText(opf, 'dc:language')),
    blocks,
    images: images.bytes,
    toc: epubToc(files, items, opfDir, target),
    cover: epubCover(files, opf, items, manifest, opfDir) ?? Object.values(images.bytes)[0],
  };
}

// EPUB 3 marks the cover with properties="cover-image", EPUB 2 with <meta name="cover" content="id">
function epubCover(
  files: Record<string, Uint8Array>,
  opf: string,
  items: string[],
  manifest: Map<string | null, string | null>,
  opfDir: string,
) {
  const meta = [...opf.matchAll(/<(?:\w+:)?meta\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'name') === 'cover');
  const declared = items.find((it) => attr(it, 'properties')?.split(' ').includes('cover-image'));
  const href = (declared ? attr(declared, 'href') : null) ?? manifest.get(meta ? attr(meta, 'content') : null) ?? null;
  return href === null ? undefined : files[resolve(opfDir, href)];
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
      return href === null ? [] : entry(m[2] as string, dir, href);
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
    return src === null ? [] : entry(m[1] as string, dir, src);
  });
}

function fb2(bytes: Uint8Array, fallback: string): Omit<ParsedBook, 'fileType'> {
  const xml = xmlText(bytes);
  const binaries = new Map<string, string>();
  for (const m of xml.matchAll(/<binary\b([^>]*)>([\s\S]*?)<\/binary>/g)) {
    const id = attr(m[1] as string, 'id');
    if (id !== null) binaries.set(id, m[2] as string);
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
      return t === undefined
        ? []
        : [{ start: l.start, end: Math.min(l.end, (blocks[i] as Block).text.length), target: Math.min(t, blocks.length - 1) }];
    });
    if (inBlock.length) blocks[i] = { ...(blocks[i] as Block), links: inBlock };
  }
  const title = /<book-title>([\s\S]*?)<\/book-title>/.exec(xml)?.[1];
  const coverpage = /<coverpage>[\s\S]*?<\/coverpage>/.exec(xml)?.[0];
  const coverTag = coverpage && /<(?:\w+:)?image\b[^>]*>/.exec(coverpage)?.[0];
  const coverData = coverTag ? binaries.get(attr(coverTag, 'href')?.replace(/^#/, '') ?? '') : undefined;
  return {
    title: (title && decode(title)) || fallback,
    language: languageOf(metaText(xml, 'lang')),
    blocks,
    images: images.bytes,
    cover: coverData === undefined ? undefined : base64(coverData),
    toc: [],
  };
}

/** A decoded PDF image as pdf.js hands it over (kind is its ImageKind: 1 = 1-bit gray, 2 = RGB, 3 = RGBA). */
export interface PdfImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** What a PDF needs pixels for; without it (tests) its images are left out. */
export interface Draw {
  image(img: PdfImage): Promise<Uint8Array | null>;
}

function rgba({ width, height, kind, data }: PdfImage): Uint8ClampedArray<ArrayBuffer> | null {
  const n = width * height;
  if (kind === 3) return data.length === n * 4 ? new Uint8ClampedArray(data) : null;
  const out = new Uint8ClampedArray(n * 4).fill(255);
  if (kind === 2) {
    for (let i = 0; i < n; i++) out.set(data.subarray(i * 3, i * 3 + 3), i * 4);
  } else if (kind === 1) {
    const row = (width + 7) >> 3;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (!(((data[y * row + (x >> 3)] as number) >> (7 - (x & 7))) & 1)) out.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  } else return null;
  return out;
}

/** JPEG in plain JavaScript (jpeg-js), so the server needs no native image library. */
export const SERVER: Draw = {
  // the app copies a PDF's JPEGs as they are and saves the rest as PNG; pdf.js only hands out pixels, so all become JPEG
  async image(img) {
    const pixels = rgba(img);
    if (!pixels) return null;
    // see-through pixels over white, as on the page (JPEG has no transparency)
    for (let i = 3; i < pixels.length; i += 4) {
      const a = pixels[i] as number;
      if (a === 255) continue;
      for (let c = i - 3; c < i; c++) pixels[c] = Math.round(((pixels[c] as number) * a + 255 * (255 - a)) / 255);
    }
    return new Uint8Array(encode({ data: pixels, width: img.width, height: img.height }, 90).data);
  },
};

/** One glyph as PDFBox's TextPosition sees it. pdf.js's own text runs drop the space glyphs (an indent made of spaces
 *  would move the line start), so glyphs are laid out from the drawing operators the way PDFStreamEngine does. */
interface Glyph {
  text: string;
  x: number;
  /** Baseline, from the top of the page (yDirAdj). */
  y: number;
  width: number;
  /** As LegacyPDFStreamEngine measures it. */
  height: number;
  space: number;
  font: string;
  size: number;
  paragraphStart?: boolean;
  hanging?: boolean;
}

const HYPHEN_BREAK = /-\r?\n(?=\p{Ll})/gu;
// PDFTextStripper.normalizeWord: presentation forms (ligatures and the like) are spelled out; then Java's trim()
const PRESENTATION = /[ﬀ-﷿ﹰ-﻿]/g;
const normalizeWord = (s: string) => s.replace(PRESENTATION, (c) => c.normalize('NFKC').replace(/^[\0- ]+|[\0- ]+$/g, ''));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const within = (a: number, b: number, v: number) => b < a + v && b > a - v;
const overlap = (y1: number, h1: number, y2: number, h2: number) =>
  within(y1, y2, 0.1) || (y2 <= y1 && y2 >= y1 - h1) || (y1 <= y2 && y1 >= y2 - h2);

// TextPositionComparator: on the same line (by baseline and height), left to right; otherwise top to bottom
const byPosition = (p: Glyph, q: Glyph) =>
  Math.abs(p.y - q.y) < 0.1 || (q.y >= p.y - p.height && q.y <= p.y) || (p.y >= q.y - q.height && p.y <= q.y) ? p.x - q.x : p.y - q.y;

// PDFTextStripper.isParagraphSeparation (its list-item patterns only ever match a line starting with ".", so they're left out)
function paragraphStart(p: Glyph, last: Glyph, lineStart: Glyph, maxHeight: number) {
  const xGap = p.x - lineStart.x;
  if (Math.abs(p.y - last.y) > round3(2.5 * maxHeight)) p.paragraphStart = true;
  else if (xGap > round3(2 * p.space)) {
    if (lineStart.paragraphStart) p.hanging = true;
    else p.paragraphStart = true;
  } else if (xGap < -p.space) p.paragraphStart = !lineStart.paragraphStart;
  else if (Math.abs(xGap) < round3(0.25 * p.width) && lineStart.hanging) p.hanging = true;
  return !!p.paragraphStart;
}

/** A page's paragraphs and where each starts, as PDFTextStripper.writePage cuts them (the app's PageText). */
function pageParagraphs(glyphs: Glyph[]): [number, string][] {
  const out: [number, string][] = [];
  let sb = '';
  let y = 0;
  const flush = () => {
    const t = trim(sb.replace(HYPHEN_BREAK, '').replace(WS, ' '));
    if (t) out.push([y, t]);
    sb = '';
  };
  let line = '';
  let lineY = 0;
  const endLine = (separator: string) => {
    if (!sb) y = lineY;
    sb += normalizeWord(line) + separator;
    line = '';
  };
  let maxY = -Infinity;
  let maxHeight = -1;
  let endX = -1;
  let lastSpacing = -1;
  let prevAverage = -1;
  let last: Glyph | null = null;
  let lineStart: Glyph | null = null;
  for (const g of glyphs.sort(byPosition)) {
    if (last && (g.font !== last.font || g.size !== last.size)) prevAverage = -1;
    const deltaSpace = !g.space ? Infinity : lastSpacing < 0 ? g.space * 0.5 : ((g.space + lastSpacing) / 2) * 0.5;
    const average = prevAverage < 0 ? g.width : (prevAverage + g.width) / 2;
    let nextWordX = endX === -1 ? null : endX + Math.min(deltaSpace, average * 0.3);
    if (last && lineStart) {
      if (!overlap(g.y, g.height, maxY, maxHeight)) {
        endLine('\n');
        if (paragraphStart(g, last, lineStart, maxHeight)) flush();
        lineStart = g;
        nextWordX = null;
        maxY = -Infinity;
        maxHeight = -1;
      }
      if (nextWordX !== null && nextWordX < g.x && !last.text.endsWith(' ')) line += ' ';
      // at least a space away from the last glyph: the line height starts over
      if (Math.abs(g.x - last.x) > g.space + deltaSpace) {
        maxY = -Infinity;
        maxHeight = -1;
      }
    }
    if (g.y >= maxY) maxY = g.y;
    endX = g.x + g.width;
    if (!line) lineY = g.y;
    line += g.text;
    maxHeight = Math.max(maxHeight, g.height);
    if (!lineStart) {
      g.paragraphStart = true;
      lineStart = g;
    }
    last = g;
    lastSpacing = g.space;
    prevAverage = average;
  }
  if (line) endLine('');
  flush();
  return out;
}

// Height of the font box of the standard 14 fonts, which pdf.js leaves out when they aren't embedded; PDFBox reads the AFM files
const STANDARD_BOX: Record<string, number> = {
  Courier: 1055,
  'Courier-Bold': 1051,
  'Courier-Oblique': 1055,
  'Courier-BoldOblique': 1051,
  Helvetica: 1156,
  'Helvetica-Bold': 1190,
  'Helvetica-Oblique': 1156,
  'Helvetica-BoldOblique': 1190,
  'Times-Roman': 1116,
  'Times-Bold': 1153,
  'Times-Italic': 1100,
  'Times-BoldItalic': 1139,
  Symbol: 1303,
  ZapfDingbats: 963,
};

interface FontMetrics {
  /** Glyph space to text space. */
  scale: number;
  height: number;
  space: number;
}

/** LegacyPDFStreamEngine's glyph height (half the font's bounding box; PDFBox lowers it to CapHeight, which pdf.js keeps
 *  to itself) and PDFont.getSpaceWidth (the glyph ToUnicode maps to a space, else code 32, else 80% of the average width),
 *  both per unit of font size. */
function fontMetrics(
  f: {
    name?: string;
    fontMatrix?: number[];
    bbox?: number[];
    widths?: Record<number, number>;
    toUnicode?: { _map?: unknown };
    defaultWidth?: number;
  } | null,
): FontMetrics {
  const [sx = 0.001, , , sy = 0.001] = f?.fontMatrix ?? [];
  const [, bottom = 0, , top = 0] = f?.bbox ?? [];
  const glyphHeight = (f?.bbox ? top - bottom : (STANDARD_BOX[f?.name ?? ''] ?? 0)) / 2;
  const widths = f?.widths ?? {};
  const map = f?.toUnicode?._map;
  const code = Array.isArray(map) ? map.indexOf(' ') : -1;
  let space = (code >= 0 ? widths[code] : widths[32]) ?? f?.defaultWidth ?? 0;
  if (!(space > 0)) {
    const all = Object.values(widths).filter((w) => w > 0);
    space = all.length ? (all.reduce((a, b) => a + b, 0) / all.length) * 0.8 : 0;
  }
  return { scale: sx, height: glyphHeight ? glyphHeight * Math.abs(sy) : 0.5, space: space ? space * Math.abs(sx) : 1 };
}

async function digest(data: Uint8Array | Uint8ClampedArray) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pdfOutline(doc: PDFDocumentProxy, pageStart: number[]): Promise<TocEntry[]> {
  const out: TocEntry[] = [];
  const pageOf = async (dest: unknown): Promise<number> => {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const ref = Array.isArray(d) ? d[0] : null;
    return typeof ref === 'number' ? ref : ref ? doc.getPageIndex(ref) : -1;
  };
  const walk = async (items: { title: string; dest: unknown; items: unknown[] }[], depth: number) => {
    for (const item of items) {
      const index = await pageOf(item.dest).catch(() => -1);
      if (index >= 0 && index < pageStart.length && trim(item.title ?? ''))
        out.push({ title: trim(item.title), block: pageStart[index] as number });
      if (depth < 1) await walk(item.items as typeof items, depth + 1);
    }
  };
  await walk((await doc.getOutline()) ?? [], 0);
  return out;
}

/** Text state, saved and restored with the graphics state (the text matrix isn't). */
interface TextState {
  font: string;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
  rise: number;
}

/** Paragraphs and images are ordered by their position on the page, so a figure lands where it was printed. */
async function pdf(bytes: Uint8Array, fallback: string, draw: Draw | null): Promise<ParsedBook> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { OPS, Util } = pdfjs;
  // a copy, since pdf.js hands the bytes over to its worker; raw pixels (no ImageBitmap) so images can be compared
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    fontExtraProperties: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise.catch((e: unknown) => {
    throw new Error((e as Error)?.name === 'PasswordException' ? 'Este PDF é protegido por senha.' : 'Não consegui abrir este PDF.');
  });
  try {
    const images = new ImageStore();
    const seen = new Set<string>();
    const blocks: Block[] = [];
    const pageStart: number[] = [];
    const metrics = new Map<string, FontMetrics>();
    for (let i = 1; i <= doc.numPages; i++) {
      pageStart.push(blocks.length);
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
      const [left, bottom, , top] = page.view as [number, number, number, number];
      const glyphs: Glyph[] = [];
      const drawn = new Map<string, [number, number][]>();
      const pictures: [number, string][] = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      let state: TextState = { font: '', size: 0, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0, rise: 0 };
      const saved: [number[], TextState][] = [];
      let tm = [1, 0, 0, 1, 0, 0];
      let x = 0;
      let y = 0;
      let lineX = 0;
      let lineY = 0;
      const moveText = (dx: number, dy: number) => {
        x = lineX += dx;
        y = lineY += dy;
      };
      for (let k = 0; k < ops.fnArray.length; k++) {
        const fn = ops.fnArray[k];
        const args = ops.argsArray[k];
        if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) {
          saved.push([ctm, state]);
          if (fn === OPS.paintFormXObjectBegin && args[0]) ctm = Util.transform(ctm, args[0]);
        } else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) [ctm, state] = saved.pop() ?? [ctm, state];
        else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
        else if (fn === OPS.beginText) {
          tm = [1, 0, 0, 1, 0, 0];
          x = lineX = y = lineY = 0;
        } else if (fn === OPS.setTextMatrix) {
          tm = Array.from(args[0] as ArrayLike<number>);
          x = lineX = y = lineY = 0;
        } else if (fn === OPS.moveText) moveText(args[0], args[1]);
        else if (fn === OPS.setLeadingMoveText) {
          state = { ...state, leading: args[1] };
          moveText(args[0], args[1]);
        } else if (fn === OPS.nextLine) moveText(0, state.leading);
        else if (fn === OPS.setLeading) state = { ...state, leading: -args[0] };
        else if (fn === OPS.setCharSpacing) state = { ...state, charSpacing: args[0] };
        else if (fn === OPS.setWordSpacing) state = { ...state, wordSpacing: args[0] };
        else if (fn === OPS.setHScale) state = { ...state, hScale: args[0] / 100 };
        else if (fn === OPS.setTextRise) state = { ...state, rise: args[0] };
        else if (fn === OPS.setFont) state = { ...state, font: args[0], size: args[1] };
        else if (fn === OPS.showText) {
          let font = metrics.get(state.font);
          if (!font) {
            font = fontMetrics(page.commonObjs.has(state.font) ? page.commonObjs.get(state.font) : null);
            metrics.set(state.font, font);
          }
          const size = Math.abs(state.size);
          const hScale = state.hScale * Math.sign(state.size || 1);
          const m = Util.transform(ctm, tm);
          // Trm = [size·hScale 0 0 size 0 rise] × Tm × CTM: its scaling sizes the glyph height and the space
          const scaleX = Math.abs(size * hScale) * Math.hypot(m[0], m[1]);
          const scaleY = size * Math.hypot(m[2], m[3]);
          const fl = Math.fround; // PDFBox measures in 32-bit floats
          let advance = 0;
          for (const g of args[0] as ({ unicode: string; width: number; isSpace: boolean } | number)[]) {
            if (typeof g === 'number') {
              advance -= (g * size) / 1000;
              continue;
            }
            const width = g.width * font.scale * size;
            if (g.unicode) {
              const px = x + advance * hScale;
              const py = y + state.rise;
              const ox = m[0] * px + m[2] * py + m[4];
              const oy = m[1] * px + m[3] * py + m[5];
              const glyph: Glyph = {
                text: g.unicode,
                x: fl(ox - left),
                y: fl(top - oy),
                width: fl(width * hScale * m[0]),
                height: fl(font.height * scaleY),
                space: fl(font.space * scaleX),
                font: state.font,
                size: state.size,
              };
              // processTextPosition: the same character drawn again on top of itself (fake bold) counts once
              const tolerance = glyph.width / glyph.text.length / 3;
              const same = drawn.get(glyph.text) ?? [];
              if (
                !same.some(
                  ([sx, sy]) =>
                    sx >= glyph.x - tolerance && sx < glyph.x + tolerance && sy >= glyph.y - tolerance && sy < glyph.y + tolerance,
                )
              ) {
                same.push([glyph.x, glyph.y]);
                drawn.set(glyph.text, same);
                glyphs.push(glyph);
              }
            }
            advance += width + (g.isSpace ? state.wordSpacing : 0) + state.charSpacing;
          }
          x += advance * hScale;
        } else if (fn === OPS.paintImageXObject && draw) {
          // PageImages: PDF space grows upward, so an image's top is pageHeight - (y + height)
          const objs = String(args[0]).startsWith('g_') ? page.commonObjs : page.objs;
          const img: PdfImage | null = objs.has(args[0]) ? objs.get(args[0]) : null;
          if (!img?.data) continue;
          // first use only: logos and ornaments repeated on every page appear once; tiny images are skipped
          const key = `${img.width}x${img.height}:${await digest(img.data)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (img.width < 64 || img.height < 64) continue;
          const data = await draw.image(img).catch(() => null);
          const name = data && images.add(`pdf-${seen.size}`, data);
          if (name) pictures.push([top - bottom - ((ctm[5] as number) + (ctm[3] as number)), name]);
        }
      }
      const placed: [number, Block][] = pageParagraphs(glyphs).map(([py, text]) => [py, { type: classify(text), text }]);
      for (const [py, image] of pictures) placed.push([py, { type: 'img', text: '', image }]);
      blocks.push(...placed.sort((p, q) => p[0] - q[0]).map(([, b]) => b));
      page.cleanup();
    }
    // the app reads scanned pages with OCR; here there's nothing to read
    if (!blocks.some((b) => b.text)) throw new Error('Este PDF só tem páginas escaneadas; o texto dele só é reconhecido no app Android.');
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined;
    const title = typeof info?.Title === 'string' && trim(info.Title) ? info.Title : fallback;
    // the app draws the first page as the cover; with no canvas here, the first picture stands in
    const cover = Object.values(images.bytes)[0];
    return {
      title,
      fileType: 'pdf',
      language: 'en',
      blocks,
      images: images.bytes,
      cover,
      toc: await pdfOutline(doc, pageStart).catch(() => []),
    };
  } finally {
    await task.destroy();
  }
}

/** Past this much unpacked, a zip is refused before anything is unpacked: a zip bomb is a few MB that unpack to gigabytes. */
const MAX_UNZIPPED = 400 * 1024 * 1024;

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_UNZIPPED) throw new Error('Este livro é grande demais para abrir.');
      return !f.name.endsWith('/');
    },
  });
}

/** EPUB, FB2 (also zipped), TXT or PDF. */
export async function parseBook(fileName: string, bytes: Uint8Array, draw: Draw | null = SERVER): Promise<ParsedBook> {
  const dot = fileName.lastIndexOf('.');
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
  const fallback = trim(stem) ? stem : fileName;
  const head = strFromU8(bytes.subarray(0, 1024), true);
  let book: ParsedBook;
  if (head.startsWith('%PDF')) book = await pdf(bytes, fallback, draw);
  else if (head.startsWith('PK')) {
    const files = unzip(bytes);
    const inner = Object.keys(files).find((k) => k.toLowerCase().endsWith('.fb2'));
    if ('META-INF/container.xml' in files) book = { ...epub(files, fallback), fileType: 'epub' };
    else if (inner) book = { ...fb2(files[inner] as Uint8Array, fallback), fileType: 'fb2' };
    else throw new Error('Este arquivo compactado não tem um EPUB nem um FB2.');
  } else if (head.includes('<FictionBook')) book = { ...fb2(bytes, fallback), fileType: 'fb2' };
  else if (/\.txt$/i.test(fileName))
    book = { title: fallback, fileType: 'txt', language: 'en', blocks: txt(decodeText(bytes)), images: {}, toc: [] };
  else throw new Error('Formato não aceito: use EPUB, FB2, TXT ou PDF.');

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
  if (!toc.length) {
    linked.forEach((b, i) => {
      if (b.type === 'h' && b.text.length <= 120) toc.push({ title: b.text, block: i });
    });
  }
  return { ...book, blocks: linked, toc };
}
