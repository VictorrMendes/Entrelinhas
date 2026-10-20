import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opdsPage } from './gutenberg.ts';

test('an OPDS page: its books, without the author and subject headings, and the next page', () => {
  const xml = `<feed>
<link rel="next" title="Next Page" type="application/atom+xml;profile=opds-catalog" href="/ebooks/search.opds/?query=alice&amp;sort_order=downloads&amp;start_index=26"/>
<entry><title>Authors</title><content type="text">146 author names match your search.</content>
<link rel="subsection" href="/ebooks/authors/search.opds/?query=alice"/></entry>
<entry><updated>2026-10-19T18:38:27Z</updated><title>Alice&#39;s Adventures in
 Wonderland</title><content type="text">Lewis Carroll</content>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/11.opds"/></entry>
<entry><title>Pride &amp; Prejudice</title><content type="text">Jane Austen</content><link href="/ebooks/1342.opds"/></entry>
<entry><title>Chambers's Twentieth Century Dictionary</title><content type="text">96605 downloads</content><link href="/ebooks/37683.opds"/></entry>
</feed>`;
  assert.deepEqual(opdsPage(xml), {
    books: [
      { id: 11, title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
      { id: 1342, title: 'Pride & Prejudice', author: 'Jane Austen' },
      { id: 37683, title: "Chambers's Twentieth Century Dictionary", author: '' },
    ],
    next: '/gutenberg/ebooks/search.opds/?query=alice&sort_order=downloads&start_index=26',
  });
  assert.equal(opdsPage('<feed><link rel="next" href="https://elsewhere.example/x"/></feed>').next, null, 'only Gutenberg search pages');
});
