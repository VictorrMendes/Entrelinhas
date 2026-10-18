/** The word under [offset] in [text] (also right after its last letter, where a tap often lands), or null on spaces. */
export function wordAt(text: string, offset: number, lang: string): { start: number; end: number } | null {
  const segments = new Intl.Segmenter(lang, { granularity: 'word' }).segment(text);
  const s = [offset, offset - 1].map((i) => segments.containing(i)).find((x) => x?.isWordLike);
  return s ? { start: s.index, end: s.index + s.segment.length } : null;
}

/** The sentence around [offset]: the context that makes the backend translate a word with the right sense. */
export function sentenceAt(text: string, offset: number, lang: string): string {
  return new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text).containing(offset)?.segment.trim() ?? text;
}

/** Days since 1970-01-01 in the device's time zone, like the Android app's localDay (review due dates sync between them). */
export function localDay(ms = Date.now()): number {
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);
}

/** A plain-text book: paragraphs are separated by blank lines; the hard line breaks inside one are just wrapping. */
export function txtBlocks(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
