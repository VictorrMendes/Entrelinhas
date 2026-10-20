/**
 * Project Gutenberg inside "Livros grátis": its OPDS catalog, which gutenberg.org doesn't let pages from other sites
 * fetch, so it goes through this app's web server (/gutenberg/, in nginx.conf and vite.config.ts). The API server itself
 * downloads the books (remote.ts addGutenberg).
 */
export interface FreeBook {
  id: number;
  title: string;
  author: string;
}

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = (s = '') =>
  s
    .replace(ENTITY, (_, e: string) => (e[0] !== '#' ? NAMED[e.toLowerCase()] : String.fromCodePoint(/x/i.test(e[1]) ? parseInt(e.slice(2), 16) : Number(e.slice(1)))))
    .replace(/\s+/g, ' ')
    .trim();

/** A page of OPDS results: its books (the author and subject headings above them left out) and the next page, if any. */
export function opdsPage(xml: string): { books: FreeBook[]; next: string | null } {
  const books = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
    const id = /href="\/ebooks\/(\d+)\.opds"/.exec(entry)?.[1];
    if (!id) return [];
    // a book without an author gets its download count there instead
    const author = xmlText(/<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1]).replace(/^\d+ downloads?$/, '');
    return [{ id: Number(id), title: xmlText(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1]), author }];
  });
  const link = /<link\b[^>]*\brel="next"[^>]*>/.exec(xml)?.[0];
  const href = xmlText(link && /\bhref="([^"]*)"/.exec(link)?.[1]);
  return { books, next: href.startsWith('/ebooks/search.opds') ? `/gutenberg${href}` : null };
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url).catch(() => null);
  if (!res) throw new Error('Sem conexão com a internet.');
  if (!res.ok) throw new Error('O Project Gutenberg não respondeu. Tente de novo em instantes.');
  return res;
}

/** The most downloaded books first; [page] is a `next` from the previous page. */
export async function searchBooks(query: string, page: string | null = null) {
  const q = query.trim();
  return opdsPage(await (await get(page ?? `/gutenberg/ebooks/search.opds/?sort_order=downloads${q ? `&query=${encodeURIComponent(q)}` : ''}`)).text());
}

export const coverUrl = (id: number) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
