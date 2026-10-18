/** Pure study rules, ported from the Android app's Rules.kt so both apps behave the same. */

/** What the rules need of a saved word (store.ts's Word has these and more). */
export interface StudyWord {
  key: string;
  original: string;
  translated: string;
  src: string;
  box: number;
}

/** Leitner boxes: "known" climbs a box and waits its interval, "repeat" drops to box 0; past the last box the word is mastered. */
export const Leitner = {
  INTERVAL_DAYS: [1, 3, 7, 14, 30, 90],
  MASTERED: 7,
  /** [box, due day] after an answer; the due day is null once mastered. */
  next(box: number, known: boolean, today: number): [number, number | null] {
    if (!known) return [0, today];
    const b = box + 1;
    return b >= Leitner.MASTERED ? [Leitner.MASTERED, null] : [b, today + Leitner.INTERVAL_DAYS[b - 1]];
  },
};

export const learned = (w: StudyWord) => w.box >= Leitner.MASTERED;

export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Up to [n] words for a round: due today first, then the least known, then the rest. */
export function practiceWords<W extends StudyWord>(all: W[], due: W[], n = 8, random = Math.random): W[] {
  const ordered = [
    ...shuffle(due, random),
    ...all.filter((w) => !learned(w)).sort((a, b) => a.box - b.box),
    ...shuffle(all.filter(learned), random),
  ];
  const seen = new Set<string>();
  const unique = ordered.filter((w) => !seen.has(w.key) && seen.add(w.key));
  return shuffle(unique.slice(0, n), random);
}

/** The meaning of [word] among three others from the same language, or nothing when the vocabulary is too small for that. */
export function practiceChoices(word: StudyWord, pool: StudyWord[], random = Math.random): string[] {
  const right = word.translated.trim();
  const seen = new Set<string>();
  const wrong = pool
    .filter((w) => w.key !== word.key && w.src === word.src)
    .map((w) => w.translated.trim())
    .filter((t) => t && t.toLowerCase() !== right.toLowerCase() && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  const picked = shuffle(wrong, random).slice(0, 3);
  return picked.length < 3 ? [] : shuffle([...picked, right], random);
}

const plain = (s: string) =>
  s
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A typed answer is right despite case, accents, punctuation, text in parentheses and one typo (two in long words);
 * any of the alternatives in "ojeada, vistazo" counts.
 */
export function closeEnough(expected: string, typed: string): boolean {
  const answer = plain(typed);
  if (!answer) return false;
  return expected
    .split(/[,;/]/)
    .map(plain)
    .filter(Boolean)
    .some((e) => e === answer || editDistance(e, answer) <= (e.length >= 9 ? 2 : e.length >= 4 ? 1 : 0));
}

export type Stage = 'choice' | 'written';

/** choice: pick the meaning of [word] among [options]. written: type the word itself from its meaning. */
export interface PracticeQuestion<W extends StudyWord> {
  word: W;
  stage: Stage;
  options: string[];
}

/**
 * A practice round: every word is first recognized (multiple choice), later recalled (written). A miss sends the question
 * to the back of the queue and marks the word, so it goes back to the review queue when the round ends.
 */
export class PracticeRound<W extends StudyWord> {
  private queue: PracticeQuestion<W>[];
  readonly words: W[];
  readonly missed = new Set<string>();
  readonly total: number;
  done = 0;

  constructor(words: W[], pool: W[], random = Math.random) {
    this.words = words;
    this.queue = words.map((word) => {
      const options = practiceChoices(word, pool, random);
      return { word, stage: options.length ? 'choice' : 'written', options };
    });
    this.total = this.queue.reduce((n, q) => n + (q.stage === 'choice' ? 2 : 1), 0);
  }

  get current(): PracticeQuestion<W> | undefined {
    return this.queue[0];
  }

  answer(correct: boolean) {
    const q = this.queue.shift();
    if (!q) return;
    if (!correct) {
      this.missed.add(q.word.key);
      this.queue.push(q);
      return;
    }
    this.done++;
    // recall comes after the other words, so it isn't answered from short-term memory
    if (q.stage === 'choice') this.queue.push({ word: q.word, stage: 'written', options: [] });
  }
}

export type Accolade = 'perfect' | 'fast' | 'comboRecord';

// one pace for every mode, like the Android app
export const FAST_SECONDS_PER_ANSWER = 6;

/** A combo counts from this many right answers in a row. */
export const COMBO_MIN = 3;

export function sessionAccolades(answers: number, misses: number, seconds: number, bestCombo: number, previousRecord: number): Accolade[] {
  const out: Accolade[] = [];
  if (answers > 0 && misses === 0) out.push('perfect');
  if (answers > 0 && seconds <= answers * FAST_SECONDS_PER_ANSWER) out.push('fast');
  if (bestCombo >= COMBO_MIN && bestCombo > previousRecord) out.push('comboRecord');
  return out;
}
