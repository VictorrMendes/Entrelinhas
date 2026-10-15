const names = new Intl.DisplayNames(['en'], { type: 'language' });

/** The app's audience reads Brazilian Portuguese; plain "Portuguese" drifts to European forms. */
export function langName(tag: string): string {
  if (tag === 'pt') return 'Brazilian Portuguese';
  try {
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export const singlePrompt = (s: string, t: string) =>
  `You are a literary translator. Translate the user's text from ${langName(s)} to natural, grammatically correct ${langName(t)}. ` +
  'Preserve meaning, tone, names and punctuation. If the text is a single word or short phrase, give its most fitting translation. ' +
  'Output only the translation, without quotes, notes or explanations.';

// Naming the word and forbidding the rest of the sentence stops the model from translating neighbours
// (measured: "bright" in "a bright cold day" came back as "frio e claro" with a looser prompt).
export const wordInContextPrompt = (s: string, t: string, sentence: string, word: string) =>
  `You are a bilingual dictionary from ${langName(s)} to ${langName(t)}. The user sends one word or expression taken from this sentence: «${sentence}». ` +
  `Translate ONLY «${word}» with the meaning it has in the sentence. Never translate the other words of the sentence. ` +
  'Answer with that translation only (one to three words), without quotes or explanations.';

export const explainPrompt = (s: string, t: string, sentence: string) =>
  `You are a friendly ${langName(s)} teacher for learners who speak ${langName(t)}. The user sends a word, expression or sentence ` +
  `taken from this sentence of a book: «${sentence}». Explain in ${langName(t)}, in at most four short sentences, what it means there ` +
  'and any grammar, idiom or nuance worth knowing, then give one short new example in the original language with its translation. ' +
  'Do not describe pronunciation (the app plays the audio). Plain text, no markdown.';

export const levelPrompt = (s: string) =>
  `You assess reading difficulty. The user sends excerpts of a book in ${langName(s)}. Answer only with the CEFR level ` +
  '(A1, A2, B1, B2, C1 or C2) a learner needs to read this book comfortably.';

export const batchPrompt = (s: string | undefined, t: string) =>
  'You are a literary translator. The user sends a JSON array of consecutive book paragraphs (blockId, text). ' +
  `Translate every text ${s ? `from ${langName(s)} ` : ''}to natural, grammatically correct ${langName(t)}, keeping tone and consistency across paragraphs. ` +
  'Return a JSON array with one object per input item: the same blockId and its translatedText.';

export const batchSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { blockId: { type: 'STRING' }, translatedText: { type: 'STRING' } },
    required: ['blockId', 'translatedText'],
  },
};
