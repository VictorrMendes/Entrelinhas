import { strFromU8, unzipSync } from 'fflate';
import { txtBlocks } from './text';

export interface ParsedBook {
  title: string;
  /** Primary language subtag, e.g. "en". */
  language: string;
  blocks: string[];
}

/** EPUB (spine order, one block per paragraph or heading) or TXT. Only text is read: book HTML never reaches the page. */
export function parseBook(fileName: string, data: Uint8Array): ParsedBook {
  const name = fileName.replace(/\.[^.]+$/, '');
  if (/\.txt$/i.test(fileName)) return { title: name, language: 'en', blocks: txtBlocks(new TextDecoder().decode(data)) };

  const files = unzipSync(data);
  const read = (path: string) => {
    const file = files[path];
    if (!file) throw new Error(`EPUB sem o arquivo ${path}`);
    return strFromU8(file);
  };
  const xml = (path: string) => new DOMParser().parseFromString(read(path), 'application/xml');

  const opfPath = xml('META-INF/container.xml').querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB sem container.xml válido');
  const opf = xml(opfPath);
  const meta = (tag: string) => opf.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim();
  const items = new Map([...opf.querySelectorAll('manifest > item')].map((i) => [i.getAttribute('id'), i.getAttribute('href')]));

  const blocks: string[] = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = items.get(ref.getAttribute('idref'));
    if (!href) continue;
    // hrefs are relative to the OPF and may climb with ../
    const path = decodeURIComponent(new URL(href, `http://book/${opfPath}`).pathname.slice(1));
    const source = read(path);
    let doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(source, 'text/html');
    for (const el of doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre')) {
      if (el.querySelector('p, li, blockquote')) continue; // a wrapper: its children are blocks of their own
      const text = el.textContent?.replace(/\s+/g, ' ').trim();
      if (text) blocks.push(text);
    }
  }
  if (!blocks.length) throw new Error('Não encontrei texto neste EPUB');
  return { title: meta('title') || name, language: (meta('language') || 'en').split('-')[0].toLowerCase(), blocks };
}
