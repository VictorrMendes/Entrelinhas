/** The Android app's FreeBooks (Explore.kt): the same four collections. The app opens them in its own browser and catches the
 *  download; a web app can't, so the site opens in a new tab and the downloaded file comes in through "Adicionar livro". */
import arrowBackSvg from '@material-design-icons/svg/filled/arrow_back.svg?raw';
import { Icon } from './ui';

const SITES = [
  { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks/', text: 'Mais de 75 mil clássicos em domínio público, em dezenas de idiomas.', formats: 'EPUB · TXT' },
  { name: 'Standard Ebooks', url: 'https://standardebooks.org/ebooks', text: 'Clássicos em inglês revisados, com capa e tipografia caprichadas.', formats: 'EPUB' },
  { name: 'Wikisource', url: 'https://wikisource.org/wiki/Main_Page', text: 'Biblioteca livre e multilíngue; cada obra tem o botão de baixar em EPUB.', formats: 'EPUB · PDF' },
  { name: 'Internet Archive', url: 'https://archive.org/details/texts', text: 'Milhões de livros digitalizados. Prefira os de domínio público.', formats: 'EPUB · PDF · TXT' },
];

export function FreeBooks({ onClose }: { onClose: () => void }) {
  return (
    <main className="free-books">
      <header className="app-bar">
        <button type="button" className="icon" aria-label="Voltar" onClick={onClose}>
          <Icon svg={arrowBackSvg} />
        </button>
        <h1 className="title-large">Livros grátis</h1>
      </header>
      <div className="free-list">
        <div className="free-hint">
          <img src="/art/empty_explore.png" alt="" width={140} height={140} />
          <p className="body-medium variant">Escolha um acervo e baixe um livro. Depois toque em “Adicionar livro” e escolha o arquivo.</p>
        </div>
        {SITES.map((s) => (
          <a key={s.name} className="card site-card" href={s.url} target="_blank" rel="noopener noreferrer">
            <span className="title-medium semibold">{s.name}</span>
            <span className="body-medium variant">{s.text}</span>
            <span className="label-medium primary-text">{s.formats}</span>
          </a>
        ))}
      </div>
    </main>
  );
}
