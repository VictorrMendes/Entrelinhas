// Builds a word kit for the app from the CEFR-J Vocabulary Profile (free with citation: © Tono Lab, TUFS).
// Translations and examples are made once by the translation models and shipped in the app.
//   node --env-file=../.env scripts/build-kit.ts <cefrj.csv> <A1|A2|B1|B2> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { createGemini, modelPool } from '../src/translate/gemini.ts';
import { createNvidia } from '../src/translate/nvidia.ts';

const [csvPath, level, outPath] = process.argv.slice(2);
if (!csvPath || !level || !outPath) throw new Error('usage: build-kit.ts <cefrj.csv> <level> <out.json>');

// CEFR-J themes merged into the packs the app shows
const THEMES: Record<string, string> = {
  'Objects and rooms': 'Casa e objetos',
  'Food and drink': 'Comida e bebida',
  'Things in the town, shops and shopping': 'Cidade e compras',
  Shopping: 'Cidade e compras',
  'Hobbies and pastimes': 'Hobbies e lazer',
  'Leisure activities': 'Hobbies e lazer',
  'Hobbies and lifestyles': 'Hobbies e lazer',
  'Family life': 'Família e você',
  'Personal information': 'Família e você',
  'Work and Jobs': 'Trabalho e escola',
  Education: 'Trabalho e escola',
  Clothes: 'Roupas e cores',
  Colours: 'Roupas e cores',
  'Nationalities and countries': 'Viagem e países',
  'Ways of travelling': 'Viagem e países',
  'Travel and services vocab': 'Viagem e países',
  Holidays: 'Viagem e países',
  'News, lifestyles and current affairs': 'Mídia e cultura',
  Media: 'Mídia e cultura',
  'Books and literature': 'Mídia e cultura',
  Arts: 'Mídia e cultura',
  Film: 'Mídia e cultura',
};
const BY_POS: Record<string, string> = { verb: 'Verbos', adjective: 'Adjetivos', noun: 'Substantivos', adverb: 'Advérbios' };
const MAX_PACK = 45;

// minimal CSV: CEFR-J quotes fields that contain commas
function parseCsv(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]).slice(0, 6));
}

const [header, ...rows] = parseCsv(readFileSync(csvPath, 'utf8'));
const col = (name: string) => header.indexOf(name);
const themed = new Map<string, { word: string; pos: string }[]>();
const untagged = new Map<string, { word: string; pos: string }[]>();
const seen = new Set<string>(); // a word listed under two parts of speech is one card
for (const r of rows) {
  if (r[col('CEFR')] !== level) continue;
  const word = r[col('headword')].split('/')[0].trim();
  if (seen.has(word.toLowerCase())) continue;
  seen.add(word.toLowerCase());
  const pos = r[col('pos')];
  const theme = THEMES[r[col('CoreInventory 1')]];
  const [map, title] = theme ? [themed, theme] : [untagged, BY_POS[pos] ?? 'Palavras básicas'];
  map.set(title, [...(map.get(title) ?? []), { word, pos }]);
}
// themed packs (food, home, family…) first: they're the friendliest start
const groups = new Map([...themed, ...untagged]);

const config = loadConfig();
const gemini = (model: string) => createGemini(config.geminiApiKey, model);
const model = modelPool([gemini(config.geminiModel), createNvidia(config.nvidiaApiKey, config.nvidiaModel), ...config.geminiFallbackModels.map(gemini)].filter((m) => m !== null));
const schema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { word: { type: 'STRING' }, translation: { type: 'STRING' }, example: { type: 'STRING' } },
    required: ['word', 'translation', 'example'],
  },
};
const system =
  `You build a vocabulary kit for Brazilian learners of English at CEFR ${level}. For each item (an English word and its part of speech) ` +
  'give "translation": its most common Brazilian Portuguese meaning for that part of speech, in 1 to 3 words; and "example": one short, ' +
  `natural English sentence (at most 10 words, ${level} level) that uses the word. Keep "word" exactly as given. Answer only with the JSON array.`;

const packs = [];
for (const [title, words] of groups) {
  const n = Math.ceil(words.length / MAX_PACK);
  const size = Math.ceil(words.length / n);
  for (let i = 0; i < n; i++) {
    const chunk = words.slice(i * size, (i + 1) * size);
    const r = await model(system, JSON.stringify(chunk), schema);
    const made = new Map((JSON.parse(r.text) as { word: string; translation: string; example: string }[]).map((w) => [w.word, w]));
    const missing = chunk.filter((w) => !made.get(w.word)?.translation);
    if (missing.length) console.warn(`${title}: no translation for ${missing.map((w) => w.word).join(', ')}`);
    packs.push({
      id: `${level.toLowerCase()}-${packs.length + 1}`,
      title: n > 1 ? `${title} ${i + 1}` : title,
      words: chunk.flatMap((w) => {
        const m = made.get(w.word);
        return m?.translation ? [{ word: w.word, pos: w.pos, translation: m.translation.trim(), example: m.example.trim() }] : [];
      }),
    });
    console.log(`${packs.at(-1)?.title}: ${packs.at(-1)?.words.length} words`);
  }
}
writeFileSync(outPath, `${JSON.stringify({ level, source: 'CEFR-J Vocabulary Profile 1.5 (© Tono Lab, TUFS)', packs }, null, 1)}\n`);
