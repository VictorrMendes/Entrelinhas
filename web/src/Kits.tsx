import { CheckCircle2, ChevronRight, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addedKits, addKit, KIT_LEVELS, type KitPack, loadKits, NEW_WORDS_OPTIONS, perDay } from './kitData';
import { speak } from './speech';
import { TopBar } from './study';

export function Pills({ options, selected, onSelect }: { options: string[]; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="pills">
      {options.map((o, i) => (
        <button type="button" key={o} className={`pill${i === selected ? ' on' : ''}`} onClick={() => onSelect(i)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** "Kits de palavras": ready-made packs (A1–B2) for someone with no books yet; an added kit comes in a few words a day. */
export function Kits({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState(KIT_LEVELS[0]);
  const [kits, setKits] = useState<KitPack[]>([]);
  const [open, setOpen] = useState<KitPack | null>(null);
  const [added, setAdded] = useState(addedKits);
  const [daily, setDaily] = useState(perDay);

  useEffect(() => {
    loadKits(level).then(setKits);
  }, [level]);

  if (open) {
    const isAdded = added.has(open.id);
    return (
      <main className="study">
        <TopBar title={open.title} onClose={() => setOpen(null)} />
        <div className="study-body">
          <button
            type="button"
            className="button primary wide"
            disabled={isAdded}
            onClick={async () => {
              await addKit(open);
              setAdded(addedKits());
            }}
          >
            {isAdded ? `Adicionado · ${daily} palavras novas por dia` : 'Adicionar kit'}
          </button>
          <ul className="kit-words">
            {open.words.map((w) => (
              <li key={w.word}>
                <span>
                  <strong>{w.word}</strong>
                  <span className="primary-text">{w.translation}</span>
                  <em className="muted small">{w.example}</em>
                </span>
                <button type="button" className="icon" aria-label="Ouvir pronúncia" onClick={() => speak(w.word, 'en')}>
                  <Volume2 />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  return (
    <main className="study">
      <TopBar title="Kits de palavras" onClose={onClose} />
      <div className="study-body">
        <Pills options={KIT_LEVELS} selected={KIT_LEVELS.indexOf(level)} onSelect={(i) => setLevel(KIT_LEVELS[i])} />
        <h3 className="label">Palavras novas por dia</h3>
        <Pills
          options={NEW_WORDS_OPTIONS.map(String)}
          selected={NEW_WORDS_OPTIONS.indexOf(daily)}
          onSelect={(i) => {
            localStorage.setItem('newWordsPerDay', String(NEW_WORDS_OPTIONS[i]));
            setDaily(NEW_WORDS_OPTIONS[i]);
          }}
        />
        {kits.map((k) => (
          <button type="button" key={k.id} className="card mode" onClick={() => setOpen(k)}>
            <span className="mode-text">
              <strong>{k.title}</strong>
              <span className="muted">{k.words.length} palavras</span>
            </span>
            {added.has(k.id) ? <CheckCircle2 className="success-text" aria-label="Kit adicionado" /> : <ChevronRight className="muted" />}
          </button>
        ))}
      </div>
    </main>
  );
}
