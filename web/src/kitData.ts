/** Word kits A1–B2 (the Android app's Kits.kt): the same JSON files, built by backend/scripts/build-kit.ts. */
import { db, type Word } from './store';
import { localDay } from './text';
import { saveWord } from './words';

export interface KitWord {
  word: string;
  translation: string;
  example: string;
}

export interface KitPack {
  id: string;
  title: string;
  words: KitWord[];
}

interface Queued extends KitWord {
  id: number;
  kitTitle: string;
}

export const KIT_LEVELS = ['A1', 'A2', 'B1', 'B2'];
export const NEW_WORDS_OPTIONS = [10, 15, 20, 30];

export const perDay = () => Number(localStorage.getItem('newWordsPerDay') ?? 15);
export const addedKits = () => new Set((localStorage.getItem('addedKits') ?? '').split(',').filter(Boolean));

/** A level's packs; titles start with the level. */
export async function loadKits(level: string): Promise<KitPack[]> {
  const file = (await fetch(`/kits/en-${level.toLowerCase()}.json`).then((r) => r.json())) as { packs: KitPack[] };
  const seen = new Set<string>(); // the A1 file lists a few words twice (two parts of speech)
  return file.packs.map((p) => ({
    id: p.id,
    title: `${level} · ${p.title}`,
    words: p.words.filter((w) => !seen.has(w.word.toLowerCase()) && seen.add(w.word.toLowerCase())),
  }));
}

/** Queues the kit's words that aren't saved or queued yet; releaseKitWords brings them in a few a day. */
export async function addKit(pack: KitPack) {
  const known = new Set((await db.all<Word>('words')).filter((w) => w.src === 'en').map((w) => w.normalized));
  for (const q of await db.all<Queued>('kitQueue')) known.add(q.word.toLowerCase());
  const fresh = pack.words.filter((w) => !known.has(w.word.trim().toLowerCase()));
  await db.putAll(
    'kitQueue',
    fresh.map((w) => ({ kitTitle: pack.title, word: w.word, translation: w.translation, example: w.example })),
  );
  localStorage.setItem('addedKits', [...addedKits(), pack.id].join(','));
  await releaseKitWords();
}

let releasing: Promise<void> | null = null;

/** Today's share of the queued kit words: up to perDay() a day, counting what came in earlier today. */
export function releaseKitWords(): Promise<void> {
  releasing ??= (async () => {
    const today = localDay();
    if (Number(localStorage.getItem('kitDay')) !== today) {
      localStorage.setItem('kitDay', String(today));
      localStorage.setItem('kitReleased', '0');
    }
    const released = Number(localStorage.getItem('kitReleased') ?? 0);
    const due = (await db.all<Queued>('kitQueue')).sort((a, b) => a.id - b.id).slice(0, Math.max(0, perDay() - released));
    for (const q of due) {
      // kits are English with Brazilian Portuguese meanings, like on Android
      await saveWord(q.word, q.translation, 'en', `Kit ${q.kitTitle}`, q.example || null, 'pt');
      await db.del('kitQueue', q.id);
    }
    localStorage.setItem('kitReleased', String(released + due.length));
  })().finally(() => {
    releasing = null;
  });
  return releasing;
}
