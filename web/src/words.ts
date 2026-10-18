import { ApiError, post } from './api';
import { db, type Word } from './store';
import { localDay } from './text';

/** The reader's language: what words are translated into. */
export const TARGET = navigator.language.split('-')[0] || 'pt';

/** [word] with the sense it has in [sentence]; the same pair is never asked twice. */
export async function translateWord(word: string, sentence: string, src: string): Promise<string> {
  if (src === TARGET) return word;
  const key = `${src}|${TARGET}|${word}|${sentence}`;
  const cached = await db.get<string>('cache', key);
  if (cached) return cached;
  const { translatedText } = await post<{ translatedText: string }>('/translate', {
    text: word,
    sourceLang: src,
    targetLang: TARGET,
    context: sentence.slice(0, 1000), // the backend's limit
  });
  await db.put('cache', translatedText, key);
  return translatedText;
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

export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'LIMIT_EXCEEDED') return 'Você chegou ao limite de traduções de hoje.';
  if (e instanceof TypeError) return 'Sem conexão com o servidor.';
  return 'Não foi possível traduzir agora. Tente de novo.';
}
