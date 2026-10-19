import arrowRightSvg from '@material-design-icons/svg/filled/keyboard_arrow_right.svg?raw';
import bookmarksSvg from '@material-design-icons/svg/outlined/bookmarks.svg?raw';
import collectionsSvg from '@material-design-icons/svg/outlined/collections_bookmark.svg?raw';
import extensionSvg from '@material-design-icons/svg/outlined/extension.svg?raw';
import downloadSvg from '@material-design-icons/svg/outlined/file_download.svg?raw';
import headphonesSvg from '@material-design-icons/svg/outlined/headphones.svg?raw';
import hearingSvg from '@material-design-icons/svg/outlined/hearing.svg?raw';
import quizSvg from '@material-design-icons/svg/outlined/quiz.svg?raw';
import schoolSvg from '@material-design-icons/svg/outlined/school.svg?raw';
import styleSvg from '@material-design-icons/svg/outlined/style.svg?raw';
import volumeSvg from '@material-design-icons/svg/outlined/volume_up.svg?raw';
import arrowDownSvg from '@material-design-icons/svg/filled/keyboard_arrow_down.svg?raw';
import { Search, VolumeUp } from './icons';
import { useEffect, useState } from 'react';
import { BookLine } from './Cards';
import { DictationSheet, dictationSentences } from './Dictation';
import { releaseKitWords } from './kitData';
import { matchBest, seconds } from './Match';
import { learned, vocabularyCsv } from './rules';
import { speak } from './speech';
import { deleteWord, dueWords, setLearned, useDb, type Word, words } from './store';
import { TopBar } from './study';
import { localDay } from './text';
import { Icon, Menu, ScreenTitle } from './ui';

export type StudyMode = 'cards' | 'learn' | 'test' | 'match' | 'listen' | 'words' | 'kits';

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

/** The vocabulary as an Anki-ready CSV file; on the iPhone the download opens the share sheet (Files, Mail, AirDrop…). */
function exportCsv(all: Word[]) {
  const url = URL.createObjectURL(new Blob([vocabularyCsv(all)], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vocabulario.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Like a study set page: a few cards to flip, your progress, then the study modes and the word list as rows (Vocabulary.kt). */
export function Vocabulary({ onStudy }: { onStudy: (mode: StudyMode) => void }) {
  const data = useDb(async () => ({ all: await words(), due: await dueWords() }));
  // the dictation opens over this page, as a sheet, like on Android
  const [dictation, setDictation] = useState<[string, string][] | null>(null);
  // queued kit words come in a few a day
  useEffect(() => {
    releaseKitWords();
  }, []);
  if (!data) return null;
  const { all, due } = data;
  if (all.length === 0) {
    return (
      <main className="tab-page">
        <ScreenTitle>Vocabulário</ScreenTitle>
        <div className="empty-state">
          <img src="/art/empty_vocabulary.png" alt="" width={128} height={128} />
          <span className="title-medium">Nenhuma palavra salva ainda</span>
          <span className="body-medium variant">Traduza uma palavra durante a leitura e toque em Salvar para adicioná-la aqui.</span>
        </div>
        <div className="center-row">
          <button type="button" className="filled-button" onClick={() => onStudy('kits')}>
            Começar com um kit de palavras
          </button>
        </div>
      </main>
    );
  }
  const preview = [...due, ...all].filter((w, i, list) => list.findIndex((x) => x.key === w.key) === i).slice(0, 10);
  const best = matchBest();
  return (
    <main className="tab-page">
      <ScreenTitle
        end={
          <button type="button" className="icon" aria-label="Exportar para Anki ou planilha" onClick={() => exportCsv(all)}>
            <Icon svg={downloadSvg} />
          </button>
        }
      >
        Vocabulário
      </ScreenTitle>
      <div className="vocab">
        <WordsPreview words={preview} />
        <Mastery words={all} due={due.length} />
        <h2 className="section-title title-medium">Estudar</h2>
        <ModeRow
          icon={styleSvg}
          tint="var(--primary)"
          title="Cartões"
          subtitle={due.length ? `${due.length} para revisar hoje` : 'Nada para hoje · treino livre com todas'}
          onClick={() => onStudy('cards')}
        />
        <ModeRow icon={schoolSvg} tint="var(--success)" title="Aprender" subtitle="Escolha o significado e depois escreva a palavra" onClick={() => onStudy('learn')} />
        <ModeRow icon={quizSvg} tint="var(--flame)" title="Avaliar" subtitle="Monte um teste e veja a sua nota" onClick={() => onStudy('test')} />
        <ModeRow
          icon={extensionSvg}
          tint="var(--primary)"
          title="Combinar"
          subtitle={best > 0 ? `Seu recorde: ${seconds(best)} s` : 'Junte os pares contra o relógio'}
          disabled={all.length < 2}
          onClick={() => onStudy('match')}
        />
        <ModeRow icon={headphonesSvg} tint="var(--flame)" title="Ouvir" subtitle="Palavras e traduções em voz alta" onClick={() => onStudy('listen')} />
        {all.some((w) => (w.example?.split(' ').length ?? 0) >= 3) && (
          <ModeRow icon={hearingSvg} tint="var(--success)" title="Ditado" subtitle="Ouça frases dos seus livros e escreva" onClick={() => setDictation(dictationSentences(all))} />
        )}
        <ModeRow
          icon={bookmarksSvg}
          tint="var(--primary)"
          title="Suas palavras"
          subtitle={`${plural(all.length, 'salva', 'salvas')} · busque, ouça e organize`}
          onClick={() => onStudy('words')}
        />
        <ModeRow icon={collectionsSvg} tint="var(--success)" title="Kits de palavras" subtitle="Pacotes prontos do A1 ao B2 para estudar sem livros" onClick={() => onStudy('kits')} />
      </div>
      {dictation && dictation.length > 0 && <DictationSheet sentences={dictation} onClose={() => setDictation(null)} />}
    </main>
  );
}

/** A few words to flip through at the top (due ones first), like the card strip of a study set. */
function WordsPreview({ words: list }: { words: Word[] }) {
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  return (
    <div>
      <div className="preview" onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / (e.currentTarget.clientWidth - 4)))}>
        {list.map((w) => {
          const back = flipped.has(w.key);
          return (
            <button
              type="button"
              key={w.key}
              className={`card preview-card${back ? ' back' : ''}`}
              onClick={() => setFlipped((f) => (f.delete(w.key) ? new Set(f) : new Set(f).add(w.key)))}
            >
              {!back && (
                <span
                  className="icon corner"
                  role="img"
                  aria-label="Ouvir pronúncia"
                  onClick={(e) => {
                    e.stopPropagation();
                    speak(w.original, w.src);
                  }}
                >
                  <Icon svg={volumeSvg} />
                </span>
              )}
              <span className="headline-small">{back ? w.translated : w.original}</span>
            </button>
          );
        })}
      </div>
      <div className="dots">
        {list.map((w, i) => (
          <span key={w.key} className={i === page ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}

/** New (never got right), still learning (climbing the Leitner boxes) and mastered words, as one bar. */
function Mastery({ words: list, due }: { words: Word[]; due: number }) {
  const mastered = list.filter(learned).length;
  const fresh = list.filter((w) => w.box === 0).length;
  const parts = [
    { n: fresh, cls: 'new', label: 'Novas' },
    { n: list.length - fresh - mastered, cls: 'learning', label: 'Aprendendo' },
    { n: mastered, cls: 'mastered', label: 'Dominadas' },
  ];
  return (
    <div className="card mastery">
      <div className="mastery-head">
        <span className="title-medium grow">{plural(list.length, 'palavra', 'palavras')}</span>
        {due > 0 && <span className="due-chip label-medium">{due} para hoje</span>}
      </div>
      <div className="mastery-bar">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <span key={p.cls} className={p.cls} style={{ flex: p.n }} />
          ))}
      </div>
      <div className="mastery-legend body-small variant">
        {parts.map((p) => (
          <span key={p.cls}>
            <i className={p.cls} /> {p.label} {p.n}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModeRow(props: { icon: string; tint: string; title: string; subtitle: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="card mode" disabled={props.disabled} onClick={props.onClick}>
      <span className="mode-icon" style={{ color: props.tint }}>
        <Icon svg={props.icon} />
      </span>
      <span className="mode-text">
        <span className="title-medium">{props.title}</span>
        <span className="body-small variant">{props.subtitle}</span>
      </span>
      <Icon svg={arrowRightSvg} className="variant" />
    </button>
  );
}

const SORTS = ['Recentes', 'Ordem alfabética', 'Por livro'];

function reviewLabel(dueDay: number | null): string {
  const days = (dueDay ?? localDay()) - localDay();
  return days <= 0 ? 'Revisar hoje' : days === 1 ? 'Revisar amanhã' : `Revisar em ${days} dias`;
}

/** "Suas palavras": every saved word, searchable and sortable, each with its review date and actions. */
export function WordsScreen({ onClose }: { onClose: () => void }) {
  const all = useDb(words) ?? [];
  const [sort, setSort] = useState(0);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const q = query.trim().toLowerCase();
  const found = all.filter((w) => !q || w.original.toLowerCase().includes(q) || w.translated.toLowerCase().includes(q));
  if (sort === 1) found.sort((a, b) => a.original.toLowerCase().localeCompare(b.original.toLowerCase()));
  if (sort === 2) found.sort((a, b) => (a.bookTitle ?? '').localeCompare(b.bookTitle ?? ''));

  return (
    <main className="study">
      <TopBar title="Suas palavras" onClose={onClose} />
      <div className="search-row">
        <label className="search">
          <Search />
          <input placeholder="Buscar" aria-label="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="menu-anchor">
          <button type="button" className="sort-pill body-medium" onClick={() => setSorting(true)}>
            Ordenar por <Icon svg={arrowDownSvg} size={20} />
          </button>
          {sorting && (
            <Menu
              items={SORTS.map((label, i) => ({ label: i === sort ? `${label} ✓` : label, onClick: () => setSort(i) }))}
              onDismiss={() => setSorting(false)}
            />
          )}
        </span>
      </div>
      {found.length === 0 && <p className="variant center sheet-empty">Nenhuma palavra encontrada.</p>}
      <ul className="word-list">
        {found.map((w) => (
          <li key={w.key} className="menu-anchor">
            <button type="button" className="card word-card" onClick={() => setOpen(w.key)}>
              <span className="word-head">
                <span className="title-medium grow">{w.original}</span>
                <span className={`due-chip label-medium${learned(w) ? ' success' : ''}`}>{learned(w) ? 'Memorizada' : reviewLabel(w.dueDay)}</span>
              </span>
              <span className="body-medium variant">{w.translated}</span>
              {w.bookTitle && <BookLine title={w.bookTitle} />}
            </button>
            {open === w.key && (
              <Menu
                items={[
                  { label: 'Ouvir pronúncia', onClick: () => speak(w.original, w.src) },
                  { label: learned(w) ? 'Revisar de novo' : 'Marcar como memorizada', onClick: () => setLearned(w, !learned(w)) },
                  { label: 'Excluir', onClick: () => deleteWord(w) },
                ]}
                onDismiss={() => setOpen(null)}
                start
              />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
