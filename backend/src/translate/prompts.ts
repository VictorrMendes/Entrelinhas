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
