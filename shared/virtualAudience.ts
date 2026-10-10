// Practice Mode's virtual audience. Twelve simulated listeners whose engagement responds to the
// presenter's measured delivery through the same scoring engine used live. Deterministic per seed.
import type { AudienceFace, AudienceSample, DeliveryScore, FaceState, PresenterSample, SpeechStats } from './types.ts';
import { aggregateAudience } from './audience.ts';
import { SPEECH } from './thresholds.ts';

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Listener {
  id: number;
  x: number;
  y: number;
  row: number;
  e: number; // engagement 0..1
  state: FaceState;
  phoneProne: number;
  sens: { eye: number; pace: number; fillers: number; volume: number; posture: number };
  confused: boolean;
  smiling: boolean;
  glanceUntil: number;
}

export const LISTENER_ROWS = 3;
export const LISTENER_COLS = 4;

export class VirtualAudience {
  listeners: Listener[] = [];
  private rand: () => number;

  constructor(seed: string) {
    this.rand = rng(seed);
    let id = 1;
    for (let row = 0; row < LISTENER_ROWS; row++)
      for (let col = 0; col < LISTENER_COLS; col++) {
        const r = this.rand;
        this.listeners.push({
          id: id++,
          row,
          x: (col + 0.5) / LISTENER_COLS + (r() - 0.5) * 0.06,
          y: [0.18, 0.42, 0.78][row] + (r() - 0.5) * 0.05,
          e: 0.7 + r() * 0.2,
          state: 'attentive',
          phoneProne: r(),
          sens: {
            eye: 0.6 + r() * 0.8,
            pace: 0.5 + r() * 1,
            fillers: 0.4 + r() * 1,
            // Back rows can't hear a quiet speaker.
            volume: row === 0 ? 1.4 + r() * 0.4 : 0.4 + r() * 0.5,
            posture: 0.3 + r() * 0.5,
          },
          confused: false,
          smiling: false,
          glanceUntil: 0,
        });
      }
  }

  step(t: number, p: PresenterSample | null, s: SpeechStats, score: DeliveryScore | null): AudienceSample {
    const r = this.rand;
    for (const l of this.listeners) {
      let target: number;
      if (!p || !p.present || !score) target = 0.3;
      else {
        const parts = score.parts;
        const w = l.sens;
        const sum = w.eye + w.pace + w.fillers + w.volume + w.posture;
        target =
          0.15 +
          (0.85 *
            (parts.eyeContact * w.eye +
              parts.pace * w.pace +
              parts.fillers * w.fillers +
              parts.volume * w.volume +
              parts.posture * w.posture)) /
            sum;
        if (p.screenGazeSec > 10) target -= Math.min(0.35, (p.screenGazeSec - 10) / 60) * w.eye;
        if (!p.speaking && p.silenceSec > 6) target -= 0.15;
        if (p.smile > 0.35 || p.expressiveness > 0.4) target += 0.08;
        // Presenter looking toward this listener's side holds attention.
        if (p.gaze === 'audience' && Math.abs(p.gazeSide - (l.x * 2 - 1)) < 0.6) target += 0.06;
      }
      target = Math.max(0, Math.min(1, target));
      l.e += (target - l.e) * 0.09 + (r() - 0.5) * 0.04;
      l.e = Math.max(0, Math.min(1, l.e));

      const prev = l.state;
      let state: FaceState;
      if (l.e > (prev === 'attentive' ? 0.5 : 0.6)) state = 'attentive';
      else if (l.e < 0.2 && l.row === 0) state = 'drowsy';
      else if (l.e < (prev === 'attentive' ? 0.4 : 0.5)) state = l.phoneProne > 0.45 ? 'down' : 'away';
      else state = prev;
      if (state === 'attentive' && t > l.glanceUntil && r() < 0.01) l.glanceUntil = t + 2000 + r() * 2000;
      if (t < l.glanceUntil && state === 'attentive') state = 'away';
      l.state = state;
      const tooFast = s.wpm != null && s.wpm > SPEECH.wpmFast;
      l.confused = l.e > 0.25 && ((tooFast && l.sens.pace > 1) || (s.fillersPerMin > 8 && l.sens.fillers > 1.1));
      l.smiling = !!p && p.smile > 0.35 && l.e > 0.65;
    }
    const faces: AudienceFace[] = this.listeners.map((l) => ({
      id: l.id,
      x: l.x,
      y: l.y,
      size: 0.4 + l.row * 0.2,
      state: l.state,
      confusion: l.confused,
      smile: l.smiling,
    }));
    return aggregateAudience(t, faces, 'virtual');
  }
}
