import { Bookmark, ChevronRight, GraduationCap, Layers, Search, Volume2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { BookLine } from './Cards';
import { learned } from './rules';
import { speak } from './speech';
import { deleteWord, dueWords, setLearned, useDb, type Word, words } from './store';
import { TopBar } from './study';
import { localDay } from './text';

export type StudyMode = 'cards' | 'learn' | 'words';

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

/** Like a study set page: a few cards to flip, your progress, then the study modes and the word list as rows. */
export function Vocabulary({ onStudy }: { onStudy: (mode: StudyMode) => void }) {
  const data = useDb(async () => ({ all: await words(), due: await dueWords() }));
  if (!data) return null;
  const { all, due } = data;
  if (all.length === 0) {
    return (
      <main className="page">
        <h1 className="page-title">Vocabulário</h1>
        <div className="empty">
          <img src="/apple-touch-icon.png" alt="" />
          <h2>Nenhuma palavra salva ainda</h2>
          <p>Traduza uma palavra durante a leitura e toque em Salvar para adicioná-la aqui.</p>
        </div>
      </main>
    );
  }
  const preview = [...due, ...all].filter((w, i, list) => list.findIndex((x) => x.key === w.key) === i).slice(0, 10);
  return (
    <main className="page">
      <h1 className="page-title">Vocabulário</h1>
      <WordsPreview words={preview} />
      <Mastery words={all} due={due.length} />
      <h2 className="section">Estudar</h2>
      <div className="modes">
        <ModeRow
          icon={<Layers />}
          tint="primary"
          title="Cartões"
          subtitle={due.length ? `${due.length} para revisar hoje` : 'Nada para hoje · treino livre com todas'}
          onClick={() => onStudy('cards')}
        />
        <ModeRow icon={<GraduationCap />} tint="success" title="Aprender" subtitle="Escolha o significado e depois escreva a palavra" onClick={() => onStudy('learn')} />
        <ModeRow
          icon={<Bookmark />}
          tint="primary"
          title="Suas palavras"
          subtitle={`${plural(all.length, 'salva', 'salvas')} · busque, ouça e organize`}
          onClick={() => onStudy('words')}
        />
      </div>
    </main>
  );
}

/** A few words to flip through at the top (due ones first), like the card strip of a study set. */
function WordsPreview({ words: list }: { words: Word[] }) {
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  return (
    <>
      <div className="preview" onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
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
                  <Volume2 />
                </span>
              )}
              {back ? w.translated : w.original}
            </button>
          );
        })}
      </div>
      <div className="dots">
        {list.map((w, i) => (
          <span key={w.key} className={i === page ? 'on' : ''} />
        ))}
      </div>
    </>
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
        <strong>{plural(list.length, 'palavra', 'palavras')}</strong>
        {due > 0 && <span className="chip">{due} para hoje</span>}
      </div>
      <div className="mastery-bar">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <span key={p.cls} className={p.cls} style={{ flex: p.n }} />
          ))}
      </div>
      <div className="mastery-legend">
        {parts.map((p) => (
          <span key={p.cls}>
            <i className={p.cls} /> {p.label} {p.n}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModeRow(props: { icon: ReactNode; tint: 'primary' | 'success' | 'flame'; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button type="button" className="card mode" onClick={props.onClick}>
      <span className={`mode-icon ${props.tint}`}>{props.icon}</span>
      <span className="mode-text">
        <strong>{props.title}</strong>
        <span className="muted">{props.subtitle}</span>
      </span>
      <ChevronRight className="muted" />
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
  const q = query.trim().toLowerCase();
  const found = all.filter((w) => !q || w.original.toLowerCase().includes(q) || w.translated.toLowerCase().includes(q));
  if (sort === 1) found.sort((a, b) => a.original.toLowerCase().localeCompare(b.original.toLowerCase()));
  if (sort === 2) found.sort((a, b) => (a.bookTitle ?? '').localeCompare(b.bookTitle ?? ''));

  return (
    <main className="study">
      <TopBar title="Suas palavras" onClose={onClose} />
      <div className="search-row">
        <label className="search">
          <Search size={20} />
          <input placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select className="sort" aria-label="Ordenar por" value={sort} onChange={(e) => setSort(Number(e.target.value))}>
          {SORTS.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {found.length === 0 && <p className="muted center">Nenhuma palavra encontrada.</p>}
      <ul className="word-list">
        {found.map((w) => (
          <li key={w.key} className="card word">
            <button type="button" className="word-main" onClick={() => setOpen(open === w.key ? null : w.key)}>
              <span className="word-head">
                <strong>{w.original}</strong>
                <span className={`chip${learned(w) ? ' success' : ''}`}>{learned(w) ? 'Memorizada' : reviewLabel(w.dueDay)}</span>
              </span>
              <span className="muted">{w.translated}</span>
              {w.bookTitle && <BookLine title={w.bookTitle} />}
            </button>
            {open === w.key && (
              <span className="word-actions">
                <button type="button" className="text" onClick={() => speak(w.original, w.src)}>
                  Ouvir pronúncia
                </button>
                <button type="button" className="text" onClick={() => setLearned(w, !learned(w))}>
                  {learned(w) ? 'Revisar de novo' : 'Marcar como memorizada'}
                </button>
                <button type="button" className="text danger" onClick={() => deleteWord(w)}>
                  Excluir
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
