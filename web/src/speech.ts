/** The phone's own voices (Web Speech API), like the Android app's TextToSpeech: free and on the device. */
export function speak(text: string, lang: string, rate = 1): Promise<boolean> {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  return new Promise((resolve) => {
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}
