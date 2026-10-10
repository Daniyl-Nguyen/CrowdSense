// "Lost moment" detection: sharp attention drop, confusion-like expressions, or a burst of "Lost me" taps.
import type { AudienceSample, Spike, SpikeKind } from './types.ts';
import { SPIKE } from './thresholds.ts';

export class SpikeDetector {
  private history: { t: number; att: number }[] = [];
  private confusionHeld = 0;
  private lastByKind = new Map<SpikeKind, number>();
  private seq = 0;

  /** Returns spikes that fired at this tick (usually zero or one). */
  update(t: number, a: AudienceSample | null, lostTaps: number[]): Spike[] {
    const out: Spike[] = [];
    if (a && a.attention != null && a.count >= SPIKE.minFaces) {
      this.history.push({ t, att: a.attention });
      this.history = this.history.filter((h) => t - h.t <= SPIKE.dropWindowSec * 1000);
      const peak = Math.max(...this.history.map((h) => h.att));
      const drop = peak - a.attention;
      if (drop >= SPIKE.dropPoints)
        this.push(out, t, 'attention-drop', Math.min(1, drop / 0.6), `${Math.round(drop * 100)}% of the room just drifted`);
      this.confusionHeld = a.confusion >= SPIKE.confusionFrac ? this.confusionHeld + 1 : 0;
      if (this.confusionHeld >= SPIKE.confusionHoldSec)
        this.push(out, t, 'confusion', Math.min(1, a.confusion), `${Math.round(a.confusion * 100)}% of faces show confusion-like expressions`);
    } else {
      this.history = [];
      this.confusionHeld = 0;
    }
    const lost = lostTaps.filter((x) => t - x <= SPIKE.lostTapsWindowSec * 1000).length;
    if (lost >= SPIKE.lostTapsMin) this.push(out, t, 'lost-taps', Math.min(1, lost / 6), `${lost} "Lost me" taps in ${SPIKE.lostTapsWindowSec}s`);
    return out;
  }

  private push(out: Spike[], t: number, kind: SpikeKind, severity: number, text: string) {
    const last = this.lastByKind.get(kind) ?? -Infinity;
    if (t - last < SPIKE.cooldownSec * 1000) return;
    this.lastByKind.set(kind, t);
    if (kind === 'attention-drop') this.history = [];
    out.push({ id: `s${t}-${++this.seq}`, t, kind, severity, text });
  }
}
