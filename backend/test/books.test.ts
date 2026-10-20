import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { bearer, deviceToken, makeApp } from './helpers.ts';

type App = Awaited<ReturnType<typeof makeApp>>;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

function epub(body = '<h1>Chapter 1</h1><p>First paragraph.</p><p>Second paragraph.</p><img src="pic.png"/><p>Third.</p>'): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(
      '<package><metadata><dc:title>Meu Livro</dc:title></metadata>' +
        '<manifest><item id="c" href="ch.xhtml"/><item id="p" href="pic.png" media-type="image/png"/></manifest><spine><itemref idref="c"/></spine></package>',
    ),
    'OEBPS/ch.xhtml': strToU8(`<html><body>${body}</body></html>`),
    'OEBPS/pic.png': PNG,
  });
}

async function account(app: App, email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password 1', name: 'Ana' } });
  return res.json().data.token;
}

const upload = (app: App, token: string, bytes: Uint8Array) =>
  app.inject({
    method: 'PUT',
    url: `/sync/files/${sha256(bytes)}`,
    headers: { ...bearer(token), 'content-type': 'application/octet-stream' },
    payload: Buffer.from(bytes),
  });

test('a synced book is read once and then served a few blocks at a time, with its pictures', async () => {
  const app = await makeApp();
  const token = await account(app, 'ana@example.com');
  const book = epub();
  const hash = sha256(book);
  assert.equal((await upload(app, token, book)).statusCode, 200);

  const early = await app.inject({ url: `/books/${hash}/blocks?from=0&count=2`, headers: bearer(token) });
  assert.equal(early.json().error.code, 'BOOK_NOT_OPEN');

  const opened = await app.inject({ url: `/books/${hash}?name=meu.epub`, headers: bearer(token) });
  assert.equal(opened.statusCode, 200);
  assert.deepEqual(opened.json().data, {
    title: 'Meu Livro',
    language: 'en',
    fileType: 'epub',
    toc: [{ title: 'Chapter 1', block: 0 }],
    cover: true,
    blockCount: 5,
  });

  const page = await app.inject({ url: `/books/${hash}/blocks?from=1&count=3`, headers: bearer(token) });
  const blocks = page.json().data.blocks as { type: string; text: string; image?: string }[];
  assert.deepEqual(
    blocks.map((b) => b.text || b.type),
    ['First paragraph.', 'Second paragraph.', 'img'],
  );

  const image = await app.inject({ url: `/books/${hash}/images/${blocks[2]?.image}`, headers: bearer(token) });
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual([...image.rawPayload], [...PNG]);
  const cover = await app.inject({ url: `/books/${hash}/cover`, headers: bearer(token) });
  assert.equal(cover.headers['content-type'], 'image/png');

  const tooMany = await app.inject({ url: `/books/${hash}/blocks?from=0&count=500`, headers: bearer(token) });
  assert.equal(tooMany.statusCode, 400);
});

test('another account reads nothing of a book it did not sync', async () => {
  const app = await makeApp();
  const owner = await account(app, 'ana@example.com');
  const other = await account(app, 'bia@example.com');
  const book = epub();
  const hash = sha256(book);
  await upload(app, owner, book);
  await app.inject({ url: `/books/${hash}`, headers: bearer(owner) });
  for (const url of [`/books/${hash}`, `/books/${hash}/blocks?from=0&count=1`, `/books/${hash}/images/0.png`, `/books/${hash}/cover`]) {
    assert.equal((await app.inject({ url, headers: bearer(other) })).statusCode, 404, url);
  }
  assert.equal((await app.inject({ url: `/books/${hash}` })).statusCode, 401, 'and nothing without a token');
});

test('a book is searched on the server without case or accents, up to 200 places, only by its owner', async () => {
  const app = await makeApp();
  const token = await account(app, 'ana@example.com');
  const long = `${'x'.repeat(60)} Um CAFÉ com ação ${'y'.repeat(60)}`;
  const book = epub(`<h1>Capítulo</h1><p>${long}</p><p>Nada aqui.</p>${'<p>Mais um cafe.</p>'.repeat(250)}`);
  const hash = sha256(book);
  await upload(app, token, book);
  await app.inject({ url: `/books/${hash}`, headers: bearer(token) });
  const search = (q: string, as = token) => app.inject({ url: `/books/${hash}/search?q=${encodeURIComponent(q)}`, headers: bearer(as) });

  const one = (await search('cafe com AÇÃO')).json().data.results;
  assert.deepEqual(one, [{ block: 1, snippet: `…${long.slice(24, 117)}…` }]);
  assert.match(one[0]?.snippet ?? '', /Um CAFÉ com ação/, 'the text as written, accents and all');

  const many = (await search('Café')).json().data.results;
  assert.equal(many.length, 200);
  assert.deepEqual(
    many.slice(0, 2).map((r: { block: number }) => r.block),
    [1, 3],
  );
  assert.equal(many[1].snippet, 'Mais um cafe.');

  assert.deepEqual((await search(' a ')).json().data.results, [], 'a letter alone finds nothing');
  assert.equal((await search('a')).statusCode, 400);
  assert.equal((await search('cafe', await account(app, 'bia@example.com'))).statusCode, 404);
});

test('a file that is no book is refused with the reason, without reading it again', async () => {
  const app = await makeApp();
  const token = await account(app, 'ana@example.com');
  const junk = strToU8('not a book at all');
  await upload(app, token, junk);
  for (let i = 0; i < 2; i++) {
    const res = await app.inject({ url: `/books/${sha256(junk)}?name=junk.bin`, headers: bearer(token) });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error.code, 'BOOK_UNREADABLE');
    assert.match(res.json().error.message, /Formato não aceito/);
  }
});

test('deleting the synced file takes the book with it', async () => {
  const app = await makeApp();
  const token = await account(app, 'ana@example.com');
  const book = epub();
  const hash = sha256(book);
  await upload(app, token, book);
  assert.equal((await app.inject({ url: `/books/${hash}`, headers: bearer(token) })).statusCode, 200);
  await app.inject({ method: 'DELETE', url: `/sync/files/${hash}`, headers: bearer(token) });
  assert.equal((await app.inject({ url: `/books/${hash}`, headers: bearer(token) })).statusCode, 404);
});

test('a Project Gutenberg book is downloaded by the server and opened', async (t) => {
  const app = await makeApp();
  const token = await account(app, 'ana@example.com');
  const book = epub();
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    asked.push(url);
    return url.includes('/ebooks/11.')
      ? new Response(new Uint8Array(book), { headers: { 'content-length': String(book.length) } })
      : new Response('', { status: 404 });
  });
  const added = await app.inject({ method: 'POST', url: '/books/gutenberg/11', headers: bearer(token) });
  assert.equal(added.statusCode, 200);
  assert.equal(added.json().data.sha, sha256(book));
  assert.equal(added.json().data.title, 'Meu Livro');
  assert.deepEqual(asked, ['https://www.gutenberg.org/ebooks/11.epub3.images']);
  assert.deepEqual(
    (await app.inject({ url: '/sync/files', headers: bearer(token) })).json().data.files,
    [sha256(book)],
    "the file is the account's now",
  );
  const page = await app.inject({ url: `/books/${sha256(book)}/blocks?from=0&count=1`, headers: bearer(token) });
  assert.equal(page.json().data.blocks[0].text, 'Chapter 1');

  const missing = await app.inject({ method: 'POST', url: '/books/gutenberg/999', headers: bearer(token) });
  assert.equal(missing.statusCode, 404);
  const anonymous = await app.inject({ method: 'POST', url: '/books/gutenberg/11', headers: bearer(await deviceToken(app, 'device-7')) });
  assert.equal(anonymous.json().error.code, 'ACCOUNT_REQUIRED');
});
