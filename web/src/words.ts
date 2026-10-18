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
export async function saveWord(original: string, translated: string, src: string, bookTitle: string, example: string) {
  const normalized = original.trim().toLowerCase();
  const key = `${normalized}|${src}|${TARGET}`;
  const now = Date.now();
  const old = await db.get<Word>('words', key);
  const word: Word = old
    ? { ...old, translated, example, updatedAt: now }
    : { key, normalized, original, translated, src, tgt: TARGET, bookTitle, example, box: 0, dueDay: localDay(now), savedAt: now, updatedAt: now };
  await db.put('words', word);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'LIMIT_EXCEEDED') return 'Você chegou ao limite de traduções de hoje.';
  if (e instanceof TypeError) return 'Sem conexão com o servidor.';
  return 'Não foi possível traduzir agora. Tente de novo.';
}
