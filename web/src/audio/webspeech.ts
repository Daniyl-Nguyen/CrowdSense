// Browser speech recognition as a low-latency pace signal / fallback transcript.
// Note: in Chrome this streams audio to the browser vendor's speech service; it's opt-in in the UI.
type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export const webSpeechSupported = () =>
  typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export function startWebSpeech(onFinal: (text: string) => void, onInterim?: (text: string) => void): () => void {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return () => {};
  let stopped = false;
  const rec: Rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onFinal(r[0].transcript);
      else interim += r[0].transcript;
    }
    onInterim?.(interim);
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true;
  };
  rec.onend = () => {
    if (!stopped) setTimeout(() => !stopped && rec.start(), 250);
  };
  rec.start();
  return () => {
    stopped = true;
    rec.stop();
  };
}
