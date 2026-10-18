/**
 * The phone's own voices (Web Speech API), like the Android app's TextToSpeech: free and on the device. Resolves when the
 * text has been said (true) or failed (false); [onWord] gets each word as it is spoken, where the browser reports it.
 */
export function speak(text: string, lang: string, rate = 1, onWord?: (start: number, end: number) => void): Promise<boolean> {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  if (onWord) {
    u.onboundary = (e) => {
      if (e.name !== 'word') return;
      // some engines leave charLength at 0: the word then runs to the next space
      const end = e.charLength ? e.charIndex + e.charLength : text.slice(e.charIndex).search(/\s|$/) + e.charIndex;
      onWord(e.charIndex, end);
    };
  }
  return new Promise((resolve) => {
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}

type Recognition = {
  lang: string;
  maxAlternatives: number;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

/** Whether "Falar junto" can listen here (Safari and Chrome have the prefixed webkitSpeechRecognition). */
export const canListen = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

/** What the microphone heard, up to five guesses (empty when nothing was understood or the user refused the microphone). */
export function listen(lang: string): Promise<string[]> {
  const w = window as unknown as Record<string, new () => Recognition>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve([]);
  speechSynthesis.cancel();
  const r = new Ctor();
  r.lang = lang;
  r.maxAlternatives = 5;
  r.interimResults = false;
  return new Promise((resolve) => {
    let heard: string[] = [];
    r.onresult = (e) => {
      heard = Array.from(e.results[0] ?? [], (a) => a.transcript);
    };
    r.onerror = () => resolve([]);
    r.onend = () => resolve(heard);
    r.start();
  });
}
