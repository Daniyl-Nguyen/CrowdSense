// Turns transcript segments into live speech stats (pace, fillers).
import type { SpeechStats, TranscriptSegment } from '../shared/types.ts';
import { countWords, findFillers } from '../shared/fillers.ts';
import { SPEECH } from '../shared/thresholds.ts';

interface Seg extends TranscriptSegment {
  speechSec: number;
  fillerWords: string[];
}

export class SpeechTracker {
  private segs: Seg[] = [];
  private webspeech: { t: number; words: number }[] = [];
  private speakingSecs: number[] = []; // session-ms of seconds the presenter was speaking
  private seq = 0;
  fillerTotal = 0;
  wordTotal = 0;
  lastFiller: string | null = null;
  fillerCounts: Record<string, number> = {};

  constructor(private primary: 'whisper' | 'webspeech') {}

  setPrimary(p: 'whisper' | 'webspeech') {
    this.primary = p;
  }

  markSpeaking(t: number) {
    this.speakingSecs.push(t);
    this.speakingSecs = this.speakingSecs.filter((x) => t - x < 60_000);
  }

  /** Add a transcribed chunk. Returns the stored segment if it is from the primary source. */
  add(source: 'whisper' | 'webspeech', t0: number, t1: number, text: string, speechSec?: number): TranscriptSegment | null {
    text = text.trim();
    if (!text) return null;
    const words = countWords(text);
    if (source === 'webspeech') this.webspeech.push({ t: t1, words });
    if (source !== this.primary) return null;
    const fillers = findFillers(text).map((f) => f.word);
    for (const f of fillers) this.fillerCounts[f] = (this.fillerCounts[f] ?? 0) + 1;
    if (fillers.length) this.lastFiller = fillers[fillers.length - 1];
    this.fillerTotal += fillers.length;
    this.wordTotal += words;
    const seg: Seg = {
      id: `tr${++this.seq}`,
      t0,
      t1,
      text,
      words,
      fillers: fillers.length,
      source,
      speechSec: speechSec ?? Math.max(0.5, (t1 - t0) / 1000),
      fillerWords: fillers,
    };
    this.segs.push(seg);
    if (this.segs.length > 400) this.segs.shift();
    return seg;
  }

  stats(now: number): SpeechStats {
    let wpm: number | null = null;
    let paceSource: SpeechStats['paceSource'] = 'none';
    const speaking30 = this.speakingSecs.filter((x) => now - x < 30_000).length;
    const recentWeb = this.webspeech.filter((w) => now - w.t < 30_000);
    if (recentWeb.length && now - recentWeb[recentWeb.length - 1].t < 20_000 && speaking30 >= SPEECH.minSpeechSecForPace) {
      wpm = (recentWeb.reduce((a, w) => a + w.words, 0) / speaking30) * 60;
      paceSource = 'webspeech';
    } else {
      // Whisper lags a few seconds, so look at segments that ended in the last 35 s.
      const recent = this.segs.filter((s) => s.source === 'whisper' && now - s.t1 < 35_000);
      const secs = recent.reduce((a, s) => a + s.speechSec, 0);
      if (secs >= SPEECH.minSpeechSecForPace) {
        wpm = (recent.reduce((a, s) => a + s.words, 0) / secs) * 60;
        paceSource = 'whisper';
      }
    }
    const last60 = this.segs.filter((s) => now - s.t1 < 60_000);
    const spoken60 = Math.max(this.speakingSecs.filter((x) => now - x < 60_000).length, 20);
    const fillersPerMin = (last60.reduce((a, s) => a + s.fillers, 0) / spoken60) * 60;
    return {
      wpm: wpm == null ? null : Math.round(wpm),
      fillersPerMin: Math.round(fillersPerMin * 10) / 10,
      fillerTotal: this.fillerTotal,
      wordTotal: this.wordTotal,
      paceSource,
      lastFiller: this.lastFiller,
    };
  }

  around(t: number, beforeMs = 15_000, afterMs = 5_000): string {
    return this.segs
      .filter((s) => s.t1 >= t - beforeMs && s.t0 <= t + afterMs)
      .map((s) => s.text)
      .join(' ');
  }
}
