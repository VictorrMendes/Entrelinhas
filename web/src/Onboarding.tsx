/** The first run, page for page like the Android app's Onboarding.kt (texts adapted where the web app can't do the same). */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { addedKits, addKit, KIT_LEVELS, type KitPack, loadKits, NEW_WORDS_OPTIONS, perDay } from './kitData';
import { langName } from './Learn';
import { LANGUAGES } from './ReaderSheets';
import { dailyGoalMinutes } from './store';
import { Pills } from './ui';
import { defaultTarget } from './words';

const GOAL_OPTIONS = [3, 5, 10, 15, 20, 30];

const PAGES: { symbol: string; title: string; text: string }[] = [
  { symbol: '📚', title: 'Leia qualquer livro.\nEntenda cada palavra.', text: 'Leitura sem esforço, com traduções instantâneas enquanto você lê.' },
  { symbol: '📥', title: 'Traga seus livros.\nComece a ler na hora.', text: 'Importe EPUB, FB2, PDF ou TXT do aparelho ou da nuvem (Arquivos, iCloud, Google Drive).' },
  { symbol: '👆', title: 'Toque numa palavra.\nVeja a tradução.', text: 'Toque em qualquer palavra desconhecida para ver o significado e salvá-la no vocabulário.' },
  { symbol: '文A', title: 'Traduza parágrafos inteiros com um toque.', text: 'Use o botão “traduzir” para converter qualquer parágrafo com IA.' },
  { symbol: '📶', title: 'Tradução inteligente com IA.', text: 'As traduções que você já viu ficam guardadas no aparelho e voltam mesmo sem internet.' },
];

export const onboarded = () => localStorage.getItem('onboarded') === '1';

/** Before the first sign-in; [onDone] leads to the login. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const pageCount = PAGES.length + 2;
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const last = page === pageCount - 1;
  const goTo = (i: number) => pager.current?.scrollTo({ left: i * pager.current.clientWidth, behavior: 'smooth' });

  return (
    <main className="onboarding">
      <div className="onboarding-top">
        {!last && (
          <button type="button" className="text-button" onClick={() => goTo(pageCount - 1)}>
            Pular
          </button>
        )}
      </div>
      <div className="onboarding-pages" ref={pager} onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {PAGES.map((p) => (
          <Page key={p.symbol}>
            <span className="onboarding-symbol">{p.symbol}</span>
            <h2 className="headline-small semibold onboarding-title">{p.title}</h2>
            <p className="body-large variant">{p.text}</p>
          </Page>
        ))}
        <KitPage />
        <SetupPage />
      </div>
      <div className="onboarding-dots">
        {Array.from({ length: pageCount }, (_, i) => (
          <span key={i} className={i === page ? 'on' : ''} />
        ))}
      </div>
      <button type="button" className="button primary wide tall" onClick={() => (last ? onDone() : goTo(page + 1))}>
        {last ? 'Entrar ou criar conta' : 'Próximo'}
      </button>
    </main>
  );
}

const Page = ({ children }: { children: ReactNode }) => <section className="onboarding-page">{children}</section>;

/** Optional: someone with no books yet starts with the level's first kit, a few words a day. */
function KitPage() {
  const [level, setLevel] = useState(KIT_LEVELS[0]);
  const [first, setFirst] = useState<KitPack | null>(null);
  const [daily, setDaily] = useState(perDay);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    loadKits(level).then((kits) => {
      setFirst(kits[0] ?? null);
      setAdded(!!kits[0] && addedKits().has(kits[0].id));
    });
  }, [level]);
  return (
    <Page>
      <span className="onboarding-emoji">🗂️</span>
      <h2 className="headline-small semibold">Ainda sem livros?</h2>
      <p className="variant onboarding-hint">
        Comece com palavras prontas do seu nível: algumas novas por dia, com tradução e exemplo. É opcional — há mais kits em Vocabulário.
      </p>
      <Pills options={KIT_LEVELS} selected={KIT_LEVELS.indexOf(level)} onSelect={(i) => setLevel(KIT_LEVELS[i])} />
      <h3 className="title-medium onboarding-label">Palavras novas por dia</h3>
      <Pills
        options={NEW_WORDS_OPTIONS.map(String)}
        selected={NEW_WORDS_OPTIONS.indexOf(daily)}
        onSelect={(i) => {
          localStorage.setItem('newWordsPerDay', String(NEW_WORDS_OPTIONS[i]));
          setDaily(NEW_WORDS_OPTIONS[i]);
        }}
      />
      <button
        type="button"
        className="button primary onboarding-action"
        disabled={!first || added}
        onClick={async () => {
          if (!first) return;
          await addKit(first);
          setAdded(true);
        }}
      >
        {added ? 'Kit adicionado' : `Adicionar ${first?.title ?? ''}`}
      </button>
    </Page>
  );
}

function SetupPage() {
  const [, redraw] = useState(0);
  const set = (key: string, value: string | number) => {
    localStorage.setItem(key, String(value));
    redraw((v) => v + 1);
  };
  return (
    <Page>
      <img src="/art/mascot.png" alt="" width={132} height={132} />
      <h2 className="headline-small semibold onboarding-setup-title">Sua meta diária</h2>
      <p className="variant onboarding-hint">Ler um pouco todo dia mantém sua ofensiva 🔥</p>
      <Pills options={GOAL_OPTIONS.map((m) => `${m} min`)} selected={GOAL_OPTIONS.indexOf(dailyGoalMinutes())} onSelect={(i) => set('dailyGoalMinutes', GOAL_OPTIONS[i])} />
      <div className="onboarding-language">
        <span>Traduzir para</span>
        <select className="language-picker label-large" aria-label="Traduzir para" value={defaultTarget()} onChange={(e) => set('defaultTarget', e.target.value)}>
          {[...new Set([defaultTarget(), ...LANGUAGES])]
            .sort((a, b) => langName(a).localeCompare(langName(b)))
            .map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
        </select>
      </div>
    </Page>
  );
}
