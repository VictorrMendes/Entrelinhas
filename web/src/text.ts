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

/** Every sentence of [text] as [start, end), without trailing spaces: the lines of the interlinear translation. */
export function sentenceRanges(text: string, lang: string): [number, number][] {
  const out: [number, number][] = [];
  for (const s of new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text)) {
    const end = s.index + s.segment.trimEnd().length;
    if (end > s.index) out.push([s.index, end]);
  }
  return out;
}

const words = (text: string, lang: string) => [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].filter((s) => s.isWordLike);

/** The nearest word before [start], to grow a lookup into an expression ("gave up"). */
export function previousWord(text: string, start: number, lang: string): { start: number; end: number } | null {
  const w = words(text, lang).findLast((s) => s.index + s.segment.length <= start);
  return w ? { start: w.index, end: w.index + w.segment.length } : null;
}

/** The nearest word after [end]. */
export function nextWord(text: string, end: number, lang: string): { start: number; end: number } | null {
  const w = words(text, lang).find((s) => s.index >= end);
  return w ? { start: w.index, end: w.index + w.segment.length } : null;
}

/** Case- and accent-insensitive search text; keeps the length of precomposed text, so offsets still apply to the original. */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');

/** Days since 1970-01-01 in the device's time zone, like the Android app's localDay (review due dates sync between them). */
export function localDay(ms = Date.now()): number {
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);
}


/** What the backend reads to judge a book's CEFR level: three excerpts (at 20%, 50% and 80%), like the Android app's levelSample. */
export function levelSample(blocks: { type: string; text: string }[]): string {
  const paragraphs = blocks.some((b) => b.type === 'p') ? blocks.filter((b) => b.type === 'p') : blocks;
  return [0.2, 0.5, 0.8]
    .map((at) => {
      let s = '';
      for (let i = Math.floor(paragraphs.length * at); i < paragraphs.length && s.length < 1500; i++) s += (s ? ' ' : '') + paragraphs[i].text;
      return s.slice(0, 1500);
    })
    .join('\n\n[…]\n\n');
}

/** The device's first day of the week: 0 Sunday … 6 Saturday (Sunday where the browser can't tell, as in Brazil). */
export function firstDayOfWeek(): number {
  const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  return ((locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay ?? 7) % 7;
}
