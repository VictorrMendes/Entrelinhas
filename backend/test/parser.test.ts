// The Android app's BookParserTest, case for case: both apps must cut a book into the same blocks
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { htmlBlocks, parseBook, txt } from '../src/books/parser.ts';

/** Minimal EPUB: [chapters] (href, html) in spine order; the manifest lists them reversed so order must come from the spine. */
function epub(chapters: [string, string][], files: Record<string, Uint8Array> = {}, extraManifest = ''): Uint8Array {
  const manifest =
    chapters
      .map((_, i) => i)
      .reverse()
      .map((i) => `<item id="c${i}" href="${(chapters[i] as [string, string])[0]}"/>`)
      .join('') + extraManifest;
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  const zip: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(
      `<package><metadata><dc:title>Meu Livro</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
    ),
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

test('FB2 with a legacy encoding, emphasis and an image', async () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink">
    <description><title-info><book-title>Livro</book-title><coverpage><image l:href="#pic.png"/></coverpage></title-info></description><body><title><p>Parte 1</p></title>
    <section><p>Привет, <emphasis>мир</emphasis>.</p><image l:href="#pic.png"/>
    <poem><stanza><v>verso um</v><v>verso dois</v></stanza></poem></section>
    </body><binary id="pic.png" content-type="image/png">iVBORw0K
    Ggo=</binary></FictionBook>`;
  // Cyrillic in windows-1251: А (U+0410) is 0xC0 and the rest follow in order
  const bytes = Uint8Array.from(xml, (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 0xc0 + c.charCodeAt(0) - 0x410));
  const book = await parseBook('x.fb2', bytes);
  assert.equal(book.title, 'Livro');
  assert.equal(book.fileType, 'fb2');
  assert.deepEqual(book.blocks, [
    { type: 'h', text: 'Parte 1' },
    { type: 'p', text: 'Привет, мир.', spans: [{ start: 8, end: 11, italic: true }] },
    { type: 'img', text: '', image: '0.png' },
    { type: 'poem', text: 'verso um' },
    { type: 'poem', text: 'verso dois' },
  ]);
  assert.deepEqual([...(book.images['0.png'] as Uint8Array)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(book.cover, book.images['0.png'], 'coverpage image is the cover');
});

test('EPUB in spine order, with its images', async () => {
  const cover = Uint8Array.from([0xff, 0xd8, 1, 2, 3]);
  const book = await parseBook(
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
  assert.deepEqual(book.cover, cover, 'without a declared cover the first image is used');
});

test('a declared EPUB cover is not a regular image', async () => {
  const book = await parseBook(
    'x.epub',
    epub(
      [['text/ch.xhtml', '<p>texto</p>']],
      { 'OEBPS/img/c.jpg': Uint8Array.from([0xff, 0xd8, 9]) },
      '<item id="cv" href="img/c.jpg" media-type="image/jpeg" properties="cover-image"/>',
    ),
  );
  assert.deepEqual(book.cover, Uint8Array.from([0xff, 0xd8, 9]));
  assert.deepEqual(book.images, {});
});

test('long blocks split at sentences, keeping their styles', async () => {
  const html = `<html><body><p>${'Uma frase de teste bem comum. '.repeat(80)}<b>Negrito final.</b></p></body></html>`;
  const { blocks } = await parseBook('x.epub', epub([['text/ch.xhtml', html]]));
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

test('EPUB links and the table of contents follow anchors inside a file', async () => {
  const contents = `<html><body><h1>Contents</h1>
    <p><a href="book.xhtml#ch1">Chapter 1</a></p><p><a href="book.xhtml#ch2">Chapter 2</a></p>
    <p>See <a href="https://example.com">the site</a>.</p></body></html>`;
  const longIntro = 'A long sentence about the voyage. '.repeat(60).trim();
  const book = `<html><body><p>${longIntro}</p><h2 id="ch1">Chapter 1</h2><p>One.</p>
    <div id="ch2"></div><h2>Chapter 2</h2><p>Two, back to <a href="contents.xhtml">contents</a>.</p></body></html>`;
  const nav = `<html><body><nav epub:type="toc"><ol><li><a href="book.xhtml#ch1">One</a></li>
    <li><a href="book.xhtml#ch2">Two</a></li></ol></nav></body></html>`;
  const parsed = await parseBook(
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
  assert.deepEqual(parsed.blocks[1]?.links, [{ start: 0, end: 9, target: ch1 }]);
  assert.deepEqual(parsed.blocks[2]?.links, [{ start: 0, end: 9, target: ch2 }]);
  assert.equal(parsed.blocks[3]?.links, undefined, 'external links are not kept');
  assert.deepEqual(parsed.blocks.at(-1)?.links, [{ start: 13, end: 21, target: 0 }]);
  assert.deepEqual(parsed.toc, [
    { title: 'One', block: ch1 },
    { title: 'Two', block: ch2 },
  ]);
});

/** A PDF from its numbered objects (1 0 obj onwards), with a valid xref table. */
function pdfFile(objects: string[], trailer: string): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return strToU8(`${out}trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF`);
}

const stream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
const pdfPages = (...contents: string[]) => {
  const pages = contents.map((_, i) => 4 + i * 2);
  return pdfFile(
    [
      '<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R >>',
      `<< /Type /Pages /Kids [${pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      `<< /Type /Outlines /First ${4 + contents.length * 2} 0 R /Last ${4 + contents.length * 2} 0 R /Count 1 >>`,
      ...contents.flatMap((c, i) => [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 ${5 + contents.length * 2} 0 R >> >> >>`,
        stream(c),
      ]),
      `<< /Title (Chapter 2) /Parent 3 0 R /Dest [${pages.at(-1)} 0 R /XYZ 0 792 0] >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Title (Meu PDF) >>',
    ],
    `/Root 1 0 R /Info ${6 + contents.length * 2} 0 R`,
  );
};

test('PDF paragraphs as PDFTextStripper cuts them, with the outline', async () => {
  const book = await parseBook(
    'x.pdf',
    pdfPages(
      [
        'BT /F1 12 Tf 14 TL 72 700 Td',
        '(First line of the) Tj T*',
        '(first paragraph, exam-) Tj T*',
        '(ple.) Tj',
        // a gap of more than 2.5 glyph heights starts a paragraph
        '0 -40 Td (Second paragraph after a gap.) Tj T*',
        '(It goes on here.) Tj T*',
        // spaces are glyphs too: the line still starts at the margin
        '(    Indented with spaces stays.) Tj',
        // an indent wider than two spaces does start one
        '20 -14 Td (Indented by moving starts a new one.) Tj',
        // 16pt down is less than 2.5 times Helvetica's glyph height (half its AFM font box: 0.578 em)
        '0 -16 Td (Close below joins.) Tj',
        'ET',
      ].join('\n'),
      'BT /F1 12 Tf 72 700 Td (Chapter 2) Tj ET',
    ),
  );
  assert.equal(book.fileType, 'pdf');
  assert.equal(book.title, 'Meu PDF');
  assert.deepEqual(
    book.blocks.map((b) => [b.type, b.text]),
    [
      ['p', 'First line of the first paragraph, example.'],
      ['p', 'Second paragraph after a gap. It goes on here. Indented with spaces stays.'],
      ['p', 'Indented by moving starts a new one. Close below joins.'],
      ['h', 'Chapter 2'],
    ],
  );
  assert.deepEqual(book.toc, [{ title: 'Chapter 2', block: 3 }]);
});

test('a PDF without text (scanned pages) is refused', async () => {
  await assert.rejects(parseBook('scan.pdf', pdfPages('q Q')), /escaneadas/);
});
