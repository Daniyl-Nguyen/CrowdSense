// Delivery score: the single scoring engine used by live sessions, the report, and Practice Mode.
import type { DeliveryScore, PresenterSample, ScoreParts, SpeechStats } from './types.ts';
import { PRESENTER, SPEECH } from './thresholds.ts';

export const SCORE_WEIGHTS: ScoreParts = {
  eyeContact: 25,
  pace: 20,
  fillers: 15,
  volume: 15,
  posture: 15,
  movement: 10,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 1 inside [lo, hi], falling linearly to 0 at `zeroLo` / `zeroHi`. */
function band(v: number, zeroLo: number, lo: number, hi: number, zeroHi: number): number {
  if (v < lo) return clamp01((v - zeroLo) / (lo - zeroLo));
  if (v > hi) return clamp01((zeroHi - v) / (zeroHi - hi));
  return 1;
}

export function scoreParts(p: PresenterSample, s: SpeechStats): ScoreParts {
  return {
    eyeContact: clamp01(p.eyeContact / 0.7),
    pace: s.wpm == null ? 0.8 : band(s.wpm, 70, SPEECH.wpmIdealLow, SPEECH.wpmIdealHigh, 215),
    fillers: clamp01(1 - (s.fillersPerMin - 2) / 8),
    volume: p.speaking ? band(p.volumeRel, -14, -4, 12, 24) : 0.85,
    posture: clamp01(
      1 -
        Math.max(0, p.slouch - 0.05) / (PRESENTER.slouch * 2) -
        Math.max(0, p.shoulderTilt - 3) / (PRESENTER.tiltDeg * 3) -
        Math.max(0, p.forwardHead - 0.06) / (PRESENTER.forwardHead * 3),
    ),
    movement: clamp01(
      1 -
        Math.max(0, p.sway - 0.25) / 0.6 -
        Math.max(0, p.fidget - 0.25) / 0.6 -
        Math.max(0, p.pacing - 2) / 4,
    ),
  };
}

export function deliveryScore(p: PresenterSample | null, s: SpeechStats): DeliveryScore | null {
  if (!p || !p.present) return null;
  const parts = scoreParts(p, s);
  let total = 0;
  for (const k of Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]) total += parts[k] * SCORE_WEIGHTS[k];
  return { score: Math.round(total), parts };
}
