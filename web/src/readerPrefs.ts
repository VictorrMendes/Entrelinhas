import { useState } from 'react';

/** The reader's page colors, independent of the app theme; the first follows it (ReadingTheme in the Android app). */
export const READING_THEMES: { label: string; page: string | null; text: string | null }[] = [
  { label: 'Do app', page: null, text: null },
  { label: 'Claro', page: '#faf7f2', text: '#1f1d2e' },
  { label: 'Sépia', page: '#f4ecd8', text: '#5b4636' },
  { label: 'Escuro', page: '#12111f', text: '#edebf7' },
  { label: 'Noite', page: '#000000', text: '#b8b5c8' },
];
export const LINE_SPACINGS = [1.35, 1.55, 1.8];
export const MARGINS = [12, 20, 32];
export const MIN_FONT = 14;
export const MAX_FONT = 28;

export interface ReaderPrefs {
  theme: number;
  fontSize: number;
  spacing: number;
  margins: number;
  serif: boolean;
  /** Paragraph translations sentence by sentence, between the lines; otherwise in one box below the paragraph. */
  interlinear: boolean;
}

const DEFAULTS: ReaderPrefs = { theme: 0, fontSize: 18, spacing: 1, margins: 1, serif: true, interlinear: true };

function load(): ReaderPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('readerPrefs') ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function useReaderPrefs(): [ReaderPrefs, (change: Partial<ReaderPrefs>) => void] {
  const [prefs, setPrefs] = useState(load);
  return [
    prefs,
    (change) =>
      setPrefs((p) => {
        const next = { ...p, ...change };
        localStorage.setItem('readerPrefs', JSON.stringify(next));
        return next;
      }),
  ];
}

const light = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
};

/** CSS variables for the page: cards tinted from the page color; the indigo accent on paper-like pages, lavender on dark ones. */
export function themeVars(theme: number): Record<string, string> {
  const { page, text } = READING_THEMES[theme] ?? READING_THEMES[0];
  if (!page || !text) return {};
  const accent = light(page) ? '#3b3a98' : '#a9a6ff';
  return {
    '--bg': page,
    '--text': text,
    '--card': `color-mix(in srgb, ${page} 93%, ${text})`,
    '--muted': `color-mix(in srgb, ${text} 70%, transparent)`,
    '--line': `color-mix(in srgb, ${text} 14%, transparent)`,
    '--primary': accent,
    '--on-primary': page,
    '--mark': `color-mix(in srgb, ${accent} 30%, transparent)`,
    '--secondary-container': `color-mix(in srgb, ${page} 84%, ${accent})`,
    '--sheet': `color-mix(in srgb, ${page} 95%, ${text})`,
    '--card-border': `color-mix(in srgb, ${text} 8%, transparent)`,
  };
}
