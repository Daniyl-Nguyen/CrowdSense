// Every threshold the product uses, in one place, so nudges stay explainable and tunable.
// Durations are seconds of the condition holding continuously (evaluated at 1 Hz).

export const AUDIENCE = {
  /** |yaw| below this counts as facing the presenter/stage. */
  attentiveYawDeg: 32,
  /** pitch (relative to the room's calibrated median) below this = looking down at phone/notes. */
  downPitchDeg: -18,
  /** pitch above this = looking up/away. */
  upPitchDeg: 28,
  /** eyeBlink blendshape average above this = eyes closed. */
  eyesClosed: 0.55,
  /** eyes closed this long (seconds) = drowsy. */
  drowsySec: 1.5,
  /** brow-down average above this = confusion-like expression. */
  confusionBrowDown: 0.5,
  smile: 0.4,
  /** tracker: drop a track after this long unseen (ms). */
  trackTtlMs: 1500,
  /** room pitch calibration window (seconds of faces). */
  calibrateSec: 8,
};

export const PRESENTER = {
  calibrationSec: 15,
  slouch: 0.14, // 14 % shorter neck-to-shoulder ratio than baseline
  tiltDeg: 8,
  forwardHead: 0.18,
  screenPitchDeg: -13, // head pitched down this much vs baseline = looking at screen/notes
  awayYawDeg: 50, // head turned this much vs baseline = looking away (e.g. at slides behind you)
  speakingAboveNoiseDb: 9,
  swayHigh: 0.55,
  pacingHigh: 3.5, // shoulder-widths per 10 s
  fidgetHigh: 0.55,
};

export const SPEECH = {
  wpmFast: 172,
  wpmSlow: 105,
  wpmIdealLow: 120,
  wpmIdealHigh: 160,
  fillersPerMinHigh: 6,
  minSpeechSecForPace: 8,
  longPauseSec: 3,
};

export const NUDGE = {
  perKindCooldownSec: 30,
  globalGapSec: 10,
  displaySec: 8,
  hold: {
    zoneDown: 45,
    sideDrift: 12,
    speakUp: 5,
    slowDown: 12,
    speedUp: 20,
    fillers: 1, // already a rolling 60 s rate
    screenGaze: 40, // uses screenGazeSec directly
    oneSided: 45,
    slouch: 8,
    tilt: 10,
    forwardHead: 10,
    sway: 15,
    pacing: 20,
    fidget: 15,
    smile: 90,
    praise: 60,
  },
};

export const SPIKE = {
  dropPoints: 0.25, // attention fell ≥25 percentage points…
  dropWindowSec: 12, // …within this window
  minFaces: 3,
  confusionFrac: 0.3,
  confusionHoldSec: 3,
  lostTapsWindowSec: 20,
  lostTapsMin: 2,
  cooldownSec: 20,
};

export const REACTION_RATE_LIMIT_MS = 10_000;

/** Demo speed: halves every hold duration so a 2-minute demo shows nudges. */
export function scaledHold(key: keyof typeof NUDGE.hold, demo: boolean): number {
  const v = NUDGE.hold[key];
  return demo ? Math.max(1, Math.round(v / 2)) : v;
}
