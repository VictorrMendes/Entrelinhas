/**
 * The phone's own voices (Web Speech API), like the Android app's TextToSpeech: free and on the device. Resolves when the
 * text has been said (true) or failed (false); [onWord] gets each word as it is spoken, where the browser reports it.
 */
export function speak(text: string, lang: string, rate = 1, onWord?: (start: number, end: number) => void, voiceURI = chosenVoice(lang)): Promise<boolean> {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voices = voicesFor(lang);
  const voice = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0];
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

/** The device's voices for [lang] (the list can come late: browsers fill it after a voiceschanged event). */
export const voicesFor = (lang: string) =>
  'speechSynthesis' in window ? speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang.toLowerCase())) : [];

/** The voice picked for [lang] in "Voz da leitura"; null lets the browser choose. */
export const chosenVoice = (lang: string) => localStorage.getItem(`voice.${lang}`);

export function setVoice(lang: string, voiceURI: string | null) {
  if (voiceURI) localStorage.setItem(`voice.${lang}`, voiceURI);
  else localStorage.removeItem(`voice.${lang}`);
}

type Recognition = {
  lang: string;
  maxAlternatives: number;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

/** Whether "Falar junto" can listen here (Safari and Chrome have the prefixed webkitSpeechRecognition). */
export const canListen = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

/**
 * What the microphone heard, up to five guesses (empty when nothing was understood). Fails with the recognizer's error code
 * ('no-speech', 'not-allowed', 'network'…).
 */
export function listen(lang: string): Promise<string[]> {
  const w = window as unknown as Record<string, new () => Recognition>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve([]);
  speechSynthesis.cancel();
  const r = new Ctor();
  r.lang = lang;
  r.maxAlternatives = 5;
  r.interimResults = false;
  return new Promise((resolve, reject) => {
    let heard: string[] = [];
    r.onresult = (e) => {
      heard = Array.from(e.results[0] ?? [], (a) => a.transcript);
    };
    r.onerror = (e) => reject(e.error);
    r.onend = () => resolve(heard);
    r.start();
  });
}
