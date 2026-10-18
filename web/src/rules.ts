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

export type TestKind = 'choice' | 'written' | 'trueFalse';

/** A test question about [word]. trueFalse asks whether [shown] is its meaning. Answers are text; true/false ones "true" or "false". */
export interface TestQuestion<W extends StudyWord> {
  word: W;
  kind: TestKind;
  options: string[];
  shown: string;
}

export function isRight(q: TestQuestion<StudyWord>, answer: string): boolean {
  if (q.kind === 'choice') return answer.trim() === q.word.translated.trim();
  if (q.kind === 'written') return closeEnough(q.word.original, answer);
  return answer === String(q.shown === q.word.translated.trim());
}

/**
 * [count] questions over [words], taking turns through [kinds]. Choice and true/false need three other meanings in the same
 * language; without them a question is written.
 */
export function buildTest<W extends StudyWord>(words: W[], pool: W[], count: number, kinds: Set<TestKind>, random = Math.random): TestQuestion<W>[] {
  const order = (['choice', 'written', 'trueFalse'] as const).filter((k) => kinds.has(k));
  const turns: TestKind[] = order.length ? order : ['written'];
  return shuffle(words, random)
    .slice(0, count)
    .map((word, i) => {
      const options = practiceChoices(word, pool, random);
      const wanted = turns[i % turns.length];
      const kind = wanted === 'written' || options.length ? wanted : 'written';
      const right = word.translated.trim();
      // half the time the meaning shown is someone else's
      const shown = kind === 'trueFalse' ? (random() < 0.5 ? right : (options.find((o) => o !== right) as string)) : '';
      return { word, kind, options: kind === 'choice' ? options : [], shown };
    });
}

/** A Combinar tile: a word or a meaning; the two tiles with the same [pair] go together. */
export interface MatchTile {
  pair: string;
  text: string;
}

/** Up to [pairs] words and their meanings, shuffled. Twin words or meanings would make two right answers, so one of each stays out. */
export function matchTiles(words: StudyWord[], pairs = 6, random = Math.random): MatchTile[] {
  const originals = new Set<string>();
  const meanings = new Set<string>();
  const picked = shuffle(words, random)
    .filter((w) => {
      const o = w.original.trim().toLowerCase();
      const t = w.translated.trim().toLowerCase();
      if (originals.has(o) || meanings.has(t)) return false;
      originals.add(o);
      meanings.add(t);
      return true;
    })
    .slice(0, pairs);
  return shuffle(
    picked.flatMap((w) => [
      { pair: w.key, text: w.original.trim() },
      { pair: w.key, text: w.translated.trim() },
    ]),
    random,
  );
}

export type Mark = 'ok' | 'missing' | 'wrong';

/**
 * Word-by-word comparison of what was heard with what was typed or said (dictation and shadowing). Case, accents and
 * punctuation don't count; the longest common subsequence decides which words match, the rest are missing (expected) or
 * wrong (typed). [score] is the share of the expected words heard right, 0 to 100.
 */
export function checkDictation(expected: string, typed: string): { words: { text: string; mark: Mark }[]; score: number } {
  const key = (w: string) =>
    w
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Mn}/gu, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const split = (s: string) => s.split(/\s+/).filter((w) => key(w));
  const e = split(expected);
  const t = split(typed);
  const ek = e.map(key);
  const tk = t.map(key);
  const lcs = Array.from({ length: e.length + 1 }, () => new Array<number>(t.length + 1).fill(0));
  for (let i = e.length - 1; i >= 0; i--)
    for (let j = t.length - 1; j >= 0; j--) lcs[i][j] = ek[i] === tk[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { text: string; mark: Mark }[] = [];
  let i = 0;
  let j = 0;
  while (i < e.length || j < t.length) {
    if (i < e.length && j < t.length && ek[i] === tk[j]) {
      out.push({ text: e[i++], mark: 'ok' });
      j++;
    } else if (j < t.length && (i === e.length || lcs[i][j + 1] >= lcs[i + 1][j])) out.push({ text: t[j++], mark: 'wrong' });
    else out.push({ text: e[i++], mark: 'missing' });
  }
  const ok = out.filter((w) => w.mark === 'ok').length;
  return { words: out, score: e.length ? Math.floor((ok * 100) / e.length) : 100 };
}

const csvField = (s: string) => (/[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Anki-ready CSV: Anki reads the `#` header lines; spreadsheets just show them as text rows. */
export function vocabularyCsv(words: { original: string; translated: string; example: string | null; bookTitle: string | null }[]): string {
  const rows = words.map((w) => [w.original, w.translated, w.example ?? '', w.bookTitle ?? ''].map(csvField).join(','));
  return `#separator:Comma\n#html:false\n#columns:Palavra,Tradução,Exemplo,Livro\n${rows.map((r) => `${r}\n`).join('')}`;
}

/** The broken streak of [lost] days being earned back; [done] of the RECOVER_DAYS days in a row are met. */
export interface Recovery {
  lost: number;
  done: number;
}

export interface StreakState {
  current: number;
  longest: number;
  shields: number;
  metToday: boolean;
  recovery: Recovery | null;
}

/** A blank day spends a shield, otherwise the streak restarts; every 7 days of streak a shield comes back, up to 2. */
export const Streak = {
  MAX_SHIELDS: 2,
  SHIELD_EVERY: 7,
  /** A broken streak comes back after this many met days in a row... */
  RECOVER_DAYS: 5,
  /** ...started at most this many days after it broke. */
  RECOVER_WITHIN: 7,

  /** [metDays] are ascending local days. */
  compute(metDays: number[], today: number): StreakState {
    let current = 0;
    let longest = 0;
    let shields = 0;
    let lost = 0;
    let last: number | null = null;
    for (const day of metDays) {
      if (day === last) continue;
      const missed = last === null ? null : day - last - 1;
      if (current > 0 && missed !== null && missed <= shields) {
        current++;
        shields -= missed;
        if (lost > 0 && missed > 0) lost = 0; // earning back needs every day, shields don't count
        if (lost > 0 && current === Streak.RECOVER_DAYS) {
          current += lost;
          lost = 0;
        }
      } else {
        lost = current >= 2 && missed !== null && missed <= Streak.RECOVER_WITHIN ? current : 0;
        current = 1;
        shields = Streak.MAX_SHIELDS;
      }
      if (current % Streak.SHIELD_EVERY === 0) shields = Math.min(Streak.MAX_SHIELDS, shields + 1);
      longest = Math.max(longest, current);
      last = day;
    }
    if (last === null) return { current: 0, longest: 0, shields: 0, metToday: false, recovery: null };
    // blank days up to yesterday already spent their shields; today isn't over yet
    const missedNow = Math.max(0, today - last - 1);
    // broken now: meeting the goal again soon starts the earn-back
    if (missedNow > shields) {
      const recovery = current >= 2 && missedNow <= Streak.RECOVER_WITHIN ? { lost: current, done: 0 } : null;
      return { current: 0, longest, shields: 0, metToday: false, recovery };
    }
    return {
      current,
      longest,
      shields: shields - missedNow,
      metToday: last === today,
      recovery: lost > 0 && missedNow === 0 ? { lost, done: current } : null,
    };
  },
};

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
