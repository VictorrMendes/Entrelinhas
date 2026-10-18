// The Android app's BookParserTest, case for case: both apps must cut a book into the same blocks
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { htmlBlocks, parseBook, txt } from './book.ts';

/** Minimal EPUB: [chapters] (href, html) in spine order; the manifest lists them reversed so order must come from the spine. */
function epub(chapters: [string, string][], files: Record<string, Uint8Array> = {}, extraManifest = ''): Uint8Array {
  const manifest = chapters.map((_, i) => i).reverse().map((i) => `<item id="c${i}" href="${chapters[i][0]}"/>`).join('') + extraManifest;
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  const zip: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<package><metadata><dc:title>Meu Livro</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`),
  };
  for (const [href, html] of chapters) zip[`OEBPS/${decodeURIComponent(href)}`] = strToU8(html);
  return zipSync({ ...zip, ...files });
}

test('HTML blocks and inline styles', () => {
  const src = `<html><head><title>X</title><style>p{}</style></head><body>
    <h1>Capítulo 1</h1><p>Ol&#225; &amp; <b>mundo</b>&nbsp;!</p>
    <blockquote><p>cita</p></blockquote><ul><li>um</li></ul><p><em>a</em><br/>b</p><script>x()</script></body></html>`;
  assert.deepEqual(htmlBlocks(src), [
    { type: 'h', text: 'Capítulo 1' },
    { type: 'p', text: 'Olá & mundo !', spans: [{ start: 6, end: 11, bold: true }] },
    { type: 'q', text: 'cita' },
    { type: 'li', text: 'um' },
    { type: 'p', text: 'a', spans: [{ start: 0, end: 1, italic: true }] },
    { type: 'p', text: 'b' },
  ]);
});

test('FB2 with a legacy encoding, emphasis and an image', () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink">
    <description><title-info><book-title>Livro</book-title><coverpage><image l:href="#pic.png"/></coverpage></title-info></description><body><title><p>Parte 1</p></title>
    <section><p>Привет, <emphasis>мир</emphasis>.</p><image l:href="#pic.png"/>
    <poem><stanza><v>verso um</v><v>verso dois</v></stanza></poem></section>
    </body><binary id="pic.png" content-type="image/png">iVBORw0K
    Ggo=</binary></FictionBook>`;
  // Cyrillic in windows-1251: А (U+0410) is 0xC0 and the rest follow in order
  const bytes = Uint8Array.from(xml, (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 0xc0 + c.charCodeAt(0) - 0x410));
  const book = parseBook('x.fb2', bytes);
  assert.equal(book.title, 'Livro');
  assert.equal(book.fileType, 'fb2');
  assert.deepEqual(book.blocks, [
    { type: 'h', text: 'Parte 1' },
    { type: 'p', text: 'Привет, мир.', spans: [{ start: 8, end: 11, italic: true }] },
    { type: 'img', text: '', image: '0.png' },
    { type: 'poem', text: 'verso um' },
    { type: 'poem', text: 'verso dois' },
  ]);
  assert.deepEqual([...book.images['0.png']], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('EPUB in spine order, with its images', () => {
  const cover = Uint8Array.from([0xff, 0xd8, 1, 2, 3]);
  const book = parseBook(
    'livro.epub',
    epub(
      [
        ['text/ch2.xhtml', '<html><body><p>segundo</p><img src="../images/cover.jpg" alt="Capa"/></body></html>'],
        ['text/ch%201.xhtml', '<html><body><p>primeiro</p></body></html>'],
      ],
      { 'OEBPS/images/cover.jpg': cover },
    ),
  );
  assert.equal(book.title, 'Meu Livro');
  assert.deepEqual(book.blocks, [
    { type: 'p', text: 'segundo' },
    { type: 'img', text: 'Capa', image: '0.jpg' },
    { type: 'p', text: 'primeiro' },
  ]);
  assert.deepEqual(book.images['0.jpg'], cover);
});

test('a declared EPUB cover is not a regular image', () => {
  const book = parseBook(
    'x.epub',
    epub([['text/ch.xhtml', '<p>texto</p>']], { 'OEBPS/img/c.jpg': Uint8Array.from([0xff, 0xd8, 9]) }, '<item id="cv" href="img/c.jpg" media-type="image/jpeg" properties="cover-image"/>'),
  );
  assert.deepEqual(book.images, {});
});

test('long blocks split at sentences, keeping their styles', () => {
  const html = `<html><body><p>${'Uma frase de teste bem comum. '.repeat(80)}<b>Negrito final.</b></p></body></html>`;
  const blocks = parseBook('x.epub', epub([['text/ch.xhtml', html]])).blocks;
  assert.ok(blocks.length > 1);
  assert.ok(blocks.every((b) => b.text.length <= 1500));
  const last = blocks.at(-1) as (typeof blocks)[number];
  assert.deepEqual(
    last.spans?.map((s) => last.text.slice(s.start, s.end)),
    ['Negrito final.'],
  );
  assert.ok(blocks.slice(0, -1).every((b) => !b.spans));
});

test('TXT paragraphs', () => {
  assert.deepEqual(
    txt('linha um\nlinha dois\n\noutro\n').map((b) => b.text),
    ['linha um linha dois', 'outro'],
  );
  assert.deepEqual(
    txt('a\nb\nc').map((b) => b.text),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    txt('Capítulo 3\n\nEra uma vez.').map((b) => b.type),
    ['h', 'p'],
  );
});

test('EPUB links and the table of contents follow anchors inside a file', () => {
  const contents = `<html><body><h1>Contents</h1>
    <p><a href="book.xhtml#ch1">Chapter 1</a></p><p><a href="book.xhtml#ch2">Chapter 2</a></p>
    <p>See <a href="https://example.com">the site</a>.</p></body></html>`;
  const longIntro = 'A long sentence about the voyage. '.repeat(60).trim();
  const book = `<html><body><p>${longIntro}</p><h2 id="ch1">Chapter 1</h2><p>One.</p>
    <div id="ch2"></div><h2>Chapter 2</h2><p>Two, back to <a href="contents.xhtml">contents</a>.</p></body></html>`;
  const nav = `<html><body><nav epub:type="toc"><ol><li><a href="book.xhtml#ch1">One</a></li>
    <li><a href="book.xhtml#ch2">Two</a></li></ol></nav></body></html>`;
  const parsed = parseBook(
    'x.epub',
    epub(
      [
        ['contents.xhtml', contents],
        ['book.xhtml', book],
      ],
      { 'OEBPS/nav.xhtml': strToU8(nav) },
      '<item id="nav" href="nav.xhtml" properties="nav"/>',
    ),
  );
  const text = parsed.blocks.map((b) => b.text);
  // the 2000-character intro is split in two, so every target after it moves one block down
  const ch1 = text.lastIndexOf('Chapter 1');
  const ch2 = text.lastIndexOf('Chapter 2');
  assert.deepEqual([ch1, ch2], [6, 8]);
  assert.deepEqual(parsed.blocks[1].links, [{ start: 0, end: 9, target: ch1 }]);
  assert.deepEqual(parsed.blocks[2].links, [{ start: 0, end: 9, target: ch2 }]);
  assert.equal(parsed.blocks[3].links, undefined, 'external links are not kept');
  assert.deepEqual(parsed.blocks.at(-1)?.links, [{ start: 13, end: 21, target: 0 }]);
  assert.deepEqual(parsed.toc, [
    { title: 'One', block: ch1 },
    { title: 'Two', block: ch2 },
  ]);
});
