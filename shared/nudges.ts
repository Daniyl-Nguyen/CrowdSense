// Rule-based, explainable live coaching. Each rule names the metric that fired it.
// Evaluated once per second. Per-kind cooldown and a global gap keep it to ONE nudge at a time.
import type { AudienceSample, Nudge, NudgeCategory, NudgeKind, PresenterSample, SpeechStats } from './types.ts';
import { NUDGE, PRESENTER, SPEECH, scaledHold } from './thresholds.ts';
import { ZONE_LABEL, sideAttention } from './audience.ts';

export interface NudgeInput {
  t: number; // session ms
  presenter: PresenterSample | null;
  speech: SpeechStats;
  audience: AudienceSample | null;
  /** session-ms timestamps of recent reactions */
  lostTaps: number[];
  fastTaps: number[];
  /** did a spike fire this tick? */
  attentionDrop: { points: number } | null;
}

interface Candidate {
  kind: NudgeKind;
  category: NudgeCategory;
  priority: number;
  text: string;
  why: string;
  cooldownSec?: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export class NudgeEngine {
  private held = new Map<string, number>(); // condition key → seconds held
  private lastByKind = new Map<NudgeKind, number>();
  private lastAny = -Infinity;
  private lastT: number | null = null;
  private gazeSides: { t: number; side: number }[] = [];
  private seq = 0;

  constructor(private demo = false) {}

  /** Seconds a condition has held continuously, updated with this tick's dt. */
  private hold(key: string, cond: boolean, dt: number): number {
    const v = cond ? (this.held.get(key) ?? 0) + dt : 0;
    this.held.set(key, v);
    return v;
  }

  private h(key: keyof typeof NUDGE.hold) {
    return scaledHold(key, this.demo);
  }

  evaluate(input: NudgeInput): Nudge | null {
    const dt = this.lastT == null ? 1 : Math.min(3, Math.max(0, (input.t - this.lastT) / 1000));
    this.lastT = input.t;
    const cands = this.candidates(input, dt);
    const tSec = input.t / 1000;
    if (tSec - this.lastAny < NUDGE.globalGapSec) return null;
    cands.sort((a, b) => b.priority - a.priority);
    for (const c of cands) {
      const last = this.lastByKind.get(c.kind) ?? -Infinity;
      if (tSec - last < (c.cooldownSec ?? NUDGE.perKindCooldownSec)) continue;
      this.lastByKind.set(c.kind, tSec);
      this.lastAny = tSec;
      return {
        id: `n${input.t}-${++this.seq}`,
        t: input.t,
        kind: c.kind,
        category: c.category,
        text: c.text,
        why: c.why,
        priority: c.priority,
      };
    }
    return null;
  }

  private candidates(i: NudgeInput, dt: number): Candidate[] {
    const out: Candidate[] = [];
    const { presenter: p, speech: s, audience: a } = i;

    // ---- Audience signals (highest priority: the room tells you what's wrong) ----
    const lost = i.lostTaps.filter((x) => i.t - x < 20_000).length;
    if (lost >= 2)
      out.push({
        kind: 'lost-taps',
        category: 'audience',
        priority: 95,
        text: 'People are lost. Recap that last point.',
        why: `${lost} "Lost me" taps in the last 20s`,
      });
    const fast = i.fastTaps.filter((x) => i.t - x < 30_000).length;
    if (fast >= 2)
      out.push({
        kind: 'fast-taps',
        category: 'audience',
        priority: 88,
        text: 'Slow down. The room says too fast.',
        why: `${fast} "Too fast" taps in the last 30s`,
      });
    if (i.attentionDrop)
      out.push({
        kind: 'attention-drop',
        category: 'audience',
        priority: 90,
        text: 'The room just drifted. Ask a question or tell a story.',
        why: `Attention fell ${Math.round(i.attentionDrop.points * 100)} points in seconds`,
      });

    if (a && a.count >= 2) {
      const L = sideAttention(a, 'left');
      const R = sideAttention(a, 'right');
      for (const [side, me, other] of [
        ['left', L, R],
        ['right', R, L],
      ] as const) {
        const drift =
          me.count >= 1 &&
          me.attention != null &&
          me.attention < 0.45 &&
          (other.attention == null || other.attention - me.attention > 0.2);
        const held = this.hold(`side-${side}`, drift, dt);
        if (held >= this.h('sideDrift'))
          out.push({
            kind: 'side-drift',
            category: 'audience',
            priority: 80,
            text: `The ${side} side is drifting. Look over there.`,
            why: `${side[0].toUpperCase() + side.slice(1)} side attention ${pct(me.attention ?? 0)} for ${Math.round(held)}s`,
          });
      }
      let worst: Candidate | null = null;
      let worstHeld = 0;
      for (const z of a.zones) {
        const frac = z.count ? z.down / z.count : 0;
        const held = this.hold(`zone-${z.id}`, z.count >= 1 && frac >= 0.5, dt);
        if (held >= this.h('zoneDown') && held > worstHeld) {
          worstHeld = held;
          worst = {
            kind: 'zone-down',
            category: 'audience',
            priority: 75,
            text: `${ZONE_LABEL[z.id]} has been looking down for ${Math.round(held)}s. Engage them.`,
            why: `${pct(frac)} of ${ZONE_LABEL[z.id].toLowerCase()} looking down for ${Math.round(held)}s`,
          };
        }
      }
      if (worst) out.push(worst);
      const good = this.hold('praise', (a.attention ?? 0) >= 0.8, dt);
      if (good >= this.h('praise'))
        out.push({
          kind: 'praise',
          category: 'praise',
          priority: 10,
          text: 'The room is with you. Keep going.',
          why: `Attention ≥80% for ${Math.round(good)}s`,
          cooldownSec: 120,
        });
    }

    if (!p || !p.present) return out;

    // ---- Voice ----
    const quiet = this.hold('quiet', p.speaking && p.volumeRel < -6, dt);
    if (quiet >= this.h('speakUp'))
      out.push({
        kind: 'speak-up',
        category: 'delivery',
        priority: 70,
        text: 'Speak up.',
        why: `Volume ${p.volumeRel.toFixed(0)} dB below your baseline for ${Math.round(quiet)}s`,
      });
    if (s.wpm != null) {
      const fastHeld = this.hold('fast', s.wpm > SPEECH.wpmFast, dt);
      if (fastHeld >= this.h('slowDown'))
        out.push({
          kind: 'slow-down',
          category: 'delivery',
          priority: 65,
          text: 'Slow down.',
          why: `Pace ${Math.round(s.wpm)} wpm (target ${SPEECH.wpmIdealLow}–${SPEECH.wpmIdealHigh})`,
        });
      const slowHeld = this.hold('slow', s.wpm < SPEECH.wpmSlow, dt);
      if (slowHeld >= this.h('speedUp'))
        out.push({
          kind: 'speed-up',
          category: 'delivery',
          priority: 40,
          text: 'Pick up the pace a little.',
          why: `Pace ${Math.round(s.wpm)} wpm for ${Math.round(slowHeld)}s`,
        });
    }
    if (s.fillersPerMin > SPEECH.fillersPerMinHigh)
      out.push({
        kind: 'fillers',
        category: 'delivery',
        priority: 55,
        text: 'Pause instead of filling.',
        why: `${s.fillersPerMin.toFixed(0)} filler words/min${s.lastFiller ? ` (last: "${s.lastFiller}")` : ''}`,
      });

    // ---- Eyes ----
    if (p.screenGazeSec >= this.h('screenGaze'))
      out.push({
        kind: 'screen-gaze',
        category: 'delivery',
        priority: 60,
        text: `You've been looking at your screen for ${Math.round(p.screenGazeSec)}s.`,
        why: `Head pitched ${Math.abs(PRESENTER.screenPitchDeg)}°+ below your baseline toward the screen`,
      });
    if (p.gaze === 'audience') this.gazeSides.push({ t: i.t, side: p.gazeSide });
    this.gazeSides = this.gazeSides.filter((g) => i.t - g.t < this.h('oneSided') * 1000);
    if (this.gazeSides.length >= this.h('oneSided') * 0.7) {
      const left = this.gazeSides.filter((g) => g.side < -0.15).length / this.gazeSides.length;
      const right = this.gazeSides.filter((g) => g.side > 0.15).length / this.gazeSides.length;
      const neglected = left < 0.08 ? 'left' : right < 0.08 ? 'right' : null;
      if (neglected && Math.max(left, right) > 0.35)
        out.push({
          kind: 'one-sided',
          category: 'delivery',
          priority: 50,
          text: `Include the ${neglected} side of the room.`,
          why: `Under 8% of your gaze went ${neglected} in the last ${this.h('oneSided')}s`,
        });
    }

    // ---- Posture & movement ----
    const posture: [NudgeKind, string, keyof typeof NUDGE.hold, boolean, string, number][] = [
      ['slouch', 'slouch', 'slouch', p.slouch > PRESENTER.slouch, `Torso ${pct(p.slouch)} shorter than your baseline`, 48],
      ['tilt', 'tilt', 'tilt', p.shoulderTilt > PRESENTER.tiltDeg, `Shoulders tilted ${p.shoulderTilt.toFixed(0)}° from baseline`, 42],
      ['forward-head', 'fwd', 'forwardHead', p.forwardHead > PRESENTER.forwardHead, `Head ${pct(p.forwardHead)} forward of baseline`, 44],
      ['sway', 'sway', 'sway', p.sway > PRESENTER.swayHigh, `Side-to-side sway index ${p.sway.toFixed(2)}`, 46],
      ['pacing', 'pacing', 'pacing', p.pacing > PRESENTER.pacingHigh, `Moving ${p.pacing.toFixed(1)} shoulder-widths per 10s`, 38],
      ['fidget', 'fidget', 'fidget', p.fidget > PRESENTER.fidgetHigh, `Hand fidget index ${p.fidget.toFixed(2)}`, 36],
    ];
    const text: Partial<Record<NudgeKind, string>> = {
      slouch: 'Straighten up.',
      tilt: 'Level your shoulders.',
      'forward-head': 'Chin back, stand tall.',
      sway: 'Plant your feet.',
      pacing: 'Stop pacing. Land the point.',
      fidget: 'Still your hands.',
    };
    for (const [kind, key, holdKey, cond, why, priority] of posture) {
      const held = this.hold(key, cond, dt);
      if (held >= this.h(holdKey))
        out.push({
          kind,
          category: kind === 'sway' || kind === 'pacing' || kind === 'fidget' ? 'delivery' : 'posture',
          priority,
          text: text[kind]!,
          why: `${why}, ${Math.round(held)}s`,
        });
    }
    const flat = this.hold('flat', p.speaking ? p.expressiveness < 0.12 && p.smile < 0.1 : false, dt);
    if (flat >= this.h('smile'))
      out.push({
        kind: 'smile',
        category: 'delivery',
        priority: 20,
        text: 'Let your face in on it. Smile.',
        why: `Low facial expressiveness for ${Math.round(flat)}s`,
        cooldownSec: 90,
      });
    return out;
  }
}
