import { ApiError, post } from './api';
import { db, type Word } from './store';
import { localDay } from './text';

/** The reader's language: what words are translated into. */
export const TARGET = navigator.language.split('-')[0] || 'pt';

/** [text] in [tgt], or with the sense it has in [context] when it is a word; the same question is never asked twice. */
export async function translate(text: string, src: string, tgt = TARGET, context?: string): Promise<string> {
  if (src === tgt) return text;
  const key = `${src}|${tgt}|${text}|${context ?? ''}`;
  const cached = await db.get<string>('cache', key);
  if (cached) return cached;
  const { translatedText } = await post<{ translatedText: string }>('/translate', {
    text: text.slice(0, 4000), // the backend's limits
    sourceLang: src,
    targetLang: tgt,
    ...(context && { context: context.slice(0, 1000) }),
  });
  await db.put('cache', translatedText, key);
  return translatedText;
}

export const translateWord = (word: string, sentence: string, src: string, tgt = TARGET) => translate(word, src, tgt, sentence);

const MAX_BATCH_ITEMS = 20;
const MAX_BATCH_CHARS = 12_000;

/**
 * One translation per sentence, in order: the lines of the interlinear layout. Cached ones aren't asked again; a sentence the
 * model skipped falls back to the original, so lines never shift.
 */
export async function translateSentences(sentences: string[], src: string, tgt = TARGET): Promise<string[]> {
  if (src === tgt) return sentences;
  const keys = sentences.map((s) => `${src}|${tgt}|${s}|`);
  const out = await Promise.all(keys.map((k) => db.get<string>('cache', k)));
  const missing = sentences.map((_, i) => i).filter((i) => out[i] === undefined);
  // batches within the backend's limits
  const batches: number[][] = [];
  for (const i of missing) {
    const last = batches.at(-1);
    const chars = last?.reduce((n, j) => n + sentences[j].length, 0) ?? 0;
    if (!last || last.length >= MAX_BATCH_ITEMS || chars + sentences[i].length > MAX_BATCH_CHARS) batches.push([i]);
    else last.push(i);
  }
  for (const batch of batches) {
    const { items } = await post<{ items: { blockId: string; translatedText: string }[] }>('/translate/batch', {
      sourceLanguage: src,
      targetLanguage: tgt,
      items: batch.map((i) => ({ blockId: String(i), text: sentences[i].slice(0, 4000) })),
    });
    for (const item of items) {
      const i = Number(item.blockId);
      out[i] = item.translatedText.replace(/\n/g, ' ');
      await db.put('cache', out[i], keys[i]);
    }
  }
  return sentences.map((s, i) => out[i] ?? s);
}

/** What a word, expression or sentence means there, its grammar and a new example, explained by AI in [tgt]. */
export async function explain(text: string, sentence: string, src: string, tgt = TARGET): Promise<string> {
  const { explanation } = await post<{ explanation: string }>('/explain', {
    text: text.slice(0, 1000),
    sentence: sentence.slice(0, 1000),
    sourceLang: src,
    targetLang: tgt,
  });
  return explanation;
}

/** Due for review today; saving it again refreshes the translation and example but keeps its Leitner box. */
export async function saveWord(original: string, translated: string, src: string, bookTitle: string, example: string | null, tgt = TARGET) {
  const normalized = original.trim().toLowerCase();
  const key = `${normalized}|${src}|${tgt}`;
  const now = Date.now();
  const old = await db.get<Word>('words', key);
  const word: Word = old
    ? { ...old, translated, example: example ?? old.example, updatedAt: now }
    : { key, normalized, original, translated, src, tgt, bookTitle, example, box: 0, dueDay: localDay(now), savedAt: now, updatedAt: now };
  await db.del('deletions', `word|${key}`); // saved again after a delete: the sync must not drop it
  await db.put('words', word);
}

/** A written answer the strict check refused, graded by AI (synonyms and other forms count); null when it can't be reached. */
export async function grade(expected: string, meaning: string, answer: string, src: string): Promise<{ correct: boolean; note: string } | null> {
  try {
    return await post('/grade', {
      expected: expected.slice(0, 200),
      meaning: meaning.slice(0, 200),
      answer: answer.trim().slice(0, 200),
      sourceLang: src,
      targetLang: TARGET,
    });
  } catch {
    return null;
  }
}

/** The Android app's messages for translation failures. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'LIMIT_EXCEEDED') return 'Limite diário de traduções online atingido.';
  if (e instanceof ApiError && (e.code === 'RATE_LIMIT' || e.status === 429)) return 'Muitas traduções seguidas. Tente de novo em instantes.';
  if (e instanceof ApiError && e.code === 'NO_CONNECTION') return 'Sem conexão com o servidor de tradução. Verifique a internet.';
  return 'Falha na tradução online.';
}
