import { CheckCircle, VolumeUp } from './icons';
import { useEffect, useState } from 'react';
import { addedKits, addKit, KIT_LEVELS, type KitPack, loadKits, NEW_WORDS_OPTIONS, perDay } from './kitData';
import { speak } from './speech';
import { TopBar } from './study';
import { Pills } from './ui';

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
        <div className="kits-list kit-detail">
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
                  <span className="title-medium">{w.word}</span>
                  <span className="body-medium primary-text">{w.translation}</span>
                  <span className="body-small italic variant">{w.example}</span>
                </span>
                <button type="button" className="icon" aria-label="Ouvir pronúncia" onClick={() => speak(w.word, 'en')}>
                  <VolumeUp />
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
      <div className="kits-list">
        <Pills options={KIT_LEVELS} selected={KIT_LEVELS.indexOf(level)} onSelect={(i) => setLevel(KIT_LEVELS[i])} />
        <div>
          <h3 className="title-small per-day">Palavras novas por dia</h3>
          <Pills
            options={NEW_WORDS_OPTIONS.map(String)}
            selected={NEW_WORDS_OPTIONS.indexOf(daily)}
            onSelect={(i) => {
              localStorage.setItem('newWordsPerDay', String(NEW_WORDS_OPTIONS[i]));
              setDaily(NEW_WORDS_OPTIONS[i]);
            }}
          />
        </div>
        {kits.map((k) => (
          <button type="button" key={k.id} className="kit-card" onClick={() => setOpen(k)}>
            <span className="grow">
              <span className="title-medium">{k.title}</span>
              <span className="body-medium variant">{k.words.length} palavras</span>
            </span>
            {added.has(k.id) && (
              <span className="success-text" role="img" aria-label="Kit adicionado">
                <CheckCircle />
              </span>
            )}
          </button>
        ))}
      </div>
    </main>
  );
}
