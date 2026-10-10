// Presenter analysis: MediaPipe Pose + Face Landmarker per frame, summarized once per second
// into a PresenterSample judged relative to the calibrated baseline.
import type { FaceLandmarker, PoseLandmarker } from './mediapipe.ts';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PresenterBaseline, PresenterGaze, PresenterSample } from '@shared/types.ts';
import { PRESENTER } from '@shared/thresholds.ts';
import { blend, clamp01, headPose, median, std } from './geometry.ts';
import type { AudioSecond } from '../audio/mic.ts';

export interface FrameObs {
  ts: number; // performance.now()
  pose: boolean;
  face: boolean;
  torsoRatio: number;
  shoulderAngle: number;
  faceToShoulder: number;
  swPx: number; // shoulder width in px
  bodyX: number; // shoulder-mid x in px
  wrists: { x: number; y: number }[]; // relative to shoulder mid, in shoulder widths
  yaw: number;
  pitch: number;
  smile: number;
  expr: number[];
}

export interface DrawData {
  pose: NormalizedLandmark[] | null;
  face: NormalizedLandmark[] | null;
}

const EXPR_KEYS = ['mouthSmileLeft', 'browInnerUp', 'browOuterUpLeft', 'jawOpen', 'eyeWideLeft', 'mouthFunnel'];

export class PresenterAnalyzer {
  frames: FrameObs[] = [];
  baseline: PresenterBaseline | null = null;
  lastDraw: DrawData = { pose: null, face: null };
  private lastVideoTs = -1;
  private screenSec = 0;
  private audienceRun = 0;

  constructor(
    private face: FaceLandmarker,
    private pose: PoseLandmarker,
  ) {}

  /** Run both models on the current video frame. Call from requestVideoFrameCallback/rAF. */
  process(video: HTMLVideoElement, now: number): FrameObs | null {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    const ts = Math.max(now, this.lastVideoTs + 1);
    this.lastVideoTs = ts;
    const W = video.videoWidth,
      H = video.videoHeight;
    const pr = this.pose.detectForVideo(video, ts);
    const fr = this.face.detectForVideo(video, ts);
    const pl = pr.landmarks[0] ?? null;
    const fl = fr.faceLandmarks[0] ?? null;
    this.lastDraw = { pose: pl, face: fl };

    const obs: FrameObs = {
      ts: now,
      pose: false,
      face: false,
      torsoRatio: NaN,
      shoulderAngle: NaN,
      faceToShoulder: NaN,
      swPx: NaN,
      bodyX: NaN,
      wrists: [],
      yaw: NaN,
      pitch: NaN,
      smile: 0,
      expr: [],
    };
    const vis = (i: number) => (pl?.[i]?.visibility ?? 0) > 0.5;
    if (pl && vis(11) && vis(12) && vis(0)) {
      const ls = pl[11],
        rs = pl[12],
        nose = pl[0];
      const dx = (ls.x - rs.x) * W,
        dy = (ls.y - rs.y) * H;
      const sw = Math.hypot(dx, dy);
      if (sw > 20) {
        const midX = ((ls.x + rs.x) / 2) * W,
          midY = ((ls.y + rs.y) / 2) * H;
        obs.pose = true;
        obs.swPx = sw;
        obs.bodyX = midX;
        obs.torsoRatio = (midY - nose.y * H) / sw;
        // Shoulder line angle: image-left shoulder is the presenter's right (pl[12]).
        obs.shoulderAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        for (const i of [15, 16])
          if ((pl[i]?.visibility ?? 0) > 0.75) obs.wrists.push({ x: (pl[i].x * W - midX) / sw, y: (pl[i].y * H - midY) / sw });
      }
    }
    if (fl) {
      obs.face = true;
      const hp = headPose(fl, W, H);
      obs.yaw = hp.yaw;
      obs.pitch = hp.pitch;
      const faceW = Math.hypot((fl[454].x - fl[234].x) * W, (fl[454].y - fl[234].y) * H);
      if (obs.pose) obs.faceToShoulder = faceW / obs.swPx;
      const b = blend(fr.faceBlendshapes?.[0]?.categories);
      obs.smile = ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2;
      obs.expr = EXPR_KEYS.map((k) => b[k] ?? 0);
    }
    this.frames.push(obs);
    const cutoff = now - 12_000;
    while (this.frames.length && this.frames[0].ts < cutoff) this.frames.shift();
    return obs;
  }

  /** Baseline from the calibration window (frames newer than `since`). */
  computeBaseline(since: number, audio: { volumeDb: number; noiseDb: number }): PresenterBaseline | null {
    const f = this.frames.filter((o) => o.ts >= since);
    const pose = f.filter((o) => o.pose);
    const face = f.filter((o) => o.face);
    if (pose.length < 10 || face.length < 10) return null;
    return {
      torsoRatio: median(pose.map((o) => o.torsoRatio)),
      shoulderAngle: median(pose.map((o) => o.shoulderAngle)),
      faceToShoulder: median(pose.filter((o) => o.face).map((o) => o.faceToShoulder)) || 0.5,
      headYaw: median(face.map((o) => o.yaw)),
      headPitch: median(face.map((o) => o.pitch)),
      volumeDb: audio.volumeDb,
      noiseDb: audio.noiseDb,
      capturedAt: Date.now(),
    };
  }

  private gazeOf(o: FrameObs): PresenterGaze {
    const b = this.baseline;
    if (!o.face) return o.pose ? 'away' : 'unknown'; // body visible but no face: turned to the slides
    const relPitch = o.pitch - (b?.headPitch ?? 0);
    const relYaw = o.yaw - (b?.headYaw ?? 0);
    if (relPitch < PRESENTER.screenPitchDeg) return 'screen';
    if (Math.abs(relYaw) > PRESENTER.awayYawDeg) return 'away';
    return 'audience';
  }

  /** Summarize the last second (plus movement windows) into a sample. */
  summarize(t: number, now: number, audio: AudioSecond): PresenterSample {
    const b = this.baseline;
    // Slow devices may process < 2 frames/s; widen the window rather than report "not present".
    let sec = this.frames.filter((o) => o.ts > now - 1000);
    if (sec.length < 2) sec = this.frames.filter((o) => o.ts > now - 2500);
    const pose = sec.filter((o) => o.pose);
    const face = sec.filter((o) => o.face);
    const present = pose.length > 0 || face.length > 0;

    const torso = median(pose.map((o) => o.torsoRatio));
    const angle = median(pose.map((o) => o.shoulderAngle));
    const f2s = median(pose.filter((o) => o.face && Number.isFinite(o.faceToShoulder)).map((o) => o.faceToShoulder));
    const slouch = b && pose.length ? Math.max(0, 1 - torso / b.torsoRatio) : 0;
    const shoulderTilt = b && pose.length ? Math.abs(angleDiff(angle, b.shoulderAngle)) : 0;
    const forwardHead = b && f2s ? Math.max(0, f2s / b.faceToShoulder - 1) : 0;

    // Gaze: majority vote over the second, with a run counter for "looking at screen".
    const gazes = sec.map((o) => this.gazeOf(o));
    const count = (g: PresenterGaze) => gazes.filter((x) => x === g).length;
    const gaze: PresenterGaze = !gazes.length
      ? 'unknown'
      : (['audience', 'screen', 'away', 'unknown'] as PresenterGaze[]).reduce((a, g) => (count(g) > count(a) ? g : a));
    const eyeContact = gazes.length ? count('audience') / gazes.length : 0;
    if (gaze === 'screen') {
      this.screenSec += 1;
      this.audienceRun = 0;
    } else if (gaze === 'audience') {
      // One-second glances up don't reset the counter; two seconds do.
      if (++this.audienceRun >= 2) this.screenSec = 0;
    } else this.screenSec = 0;
    const relYaw = median(face.map((o) => o.yaw)) - (b?.headYaw ?? 0);
    // Camera faces the presenter: their left appears on image right, i.e. positive yaw.
    const gazeSide = face.length ? Math.max(-1, Math.min(1, -relYaw / 45)) : 0;

    const { sway, pacing, fidget } = this.movement(now);
    const smile = face.length ? face.reduce((a, o) => a + o.smile, 0) / face.length : 0;
    const exprWin = this.frames.filter((o) => o.face && o.ts > now - 5000);
    const expressiveness = exprWin.length > 5
      ? clamp01((EXPR_KEYS.map((_, k) => std(exprWin.map((o) => o.expr[k]))).reduce((a, v) => a + v, 0) / EXPR_KEYS.length) / 0.1)
      : 0;

    return {
      t,
      present,
      slouch: round(slouch),
      shoulderTilt: round(shoulderTilt, 1),
      forwardHead: round(forwardHead),
      sway: round(sway),
      pacing: round(pacing, 1),
      fidget: round(fidget),
      gaze,
      gazeSide: round(gazeSide),
      eyeContact: round(eyeContact),
      screenGazeSec: this.screenSec,
      smile: round(smile),
      expressiveness: round(expressiveness),
      volumeDb: round(audio.volumeDb, 1),
      volumeRel: audio.speaking && b ? round(audio.volumeDb - b.volumeDb, 1) : 0,
      speaking: audio.speaking,
      silenceSec: audio.silenceSec,
    };
  }

  private movement(now: number) {
    const win = this.frames.filter((o) => o.pose && o.ts > now - 10_000);
    if (win.length < 15) return { sway: 0, pacing: 0, fidget: 0 };
    const sw = median(win.map((o) => o.swPx));
    const xs = win.map((o) => o.bodyX / sw);
    const span = (win[win.length - 1].ts - win[0].ts) / 1000 || 1;
    // Pacing: travel of a 0.5 s-smoothed body position, per 10 s.
    const smooth = movingAvg(xs, win, 500);
    let travel = 0;
    for (let i = 4; i < smooth.length; i += 4) travel += Math.abs(smooth[i] - smooth[i - 4]);
    const pacing = (travel * 10) / span;
    // Sway: oscillation around a 3 s trend; amplitude × rhythmic zero-crossings.
    const trend = movingAvg(xs, win, 3000);
    const resid = smooth.map((v, i) => v - trend[i]);
    let crossings = 0;
    let sign = 0;
    for (const r of resid) {
      if (Math.abs(r) < 0.03) continue;
      const s = Math.sign(r);
      if (sign && s !== sign) crossings++;
      sign = s;
    }
    const sway = clamp01(std(resid) / 0.1) * clamp01(((crossings * 10) / span) / 5);
    // Fidget: high-frequency wrist jitter relative to the body (not big, smooth gestures).
    const wf = this.frames.filter((o) => o.pose && o.wrists.length && o.ts > now - 5000);
    let fidget = 0;
    if (wf.length > 10) {
      const wx = wf.map((o) => o.wrists[0].x),
        wy = wf.map((o) => o.wrists[0].y);
      const ax = movingAvg(wx, wf, 400),
        ay = movingAvg(wy, wf, 400);
      const jitter = wx.reduce((a, v, i) => a + Math.hypot(v - ax[i], wy[i] - ay[i]), 0) / wx.length;
      const handsLow = median(wy) > 0.6; // around the waist, where fidgeting happens
      // Landmark jitter alone is ~0.02 shoulder-widths; only count motion above that noise floor.
      fidget = clamp01((jitter - 0.025) / 0.06) * (handsLow ? 1 : 0.5);
    }
    return { sway, pacing, fidget };
  }
}

function movingAvg(vals: number[], frames: { ts: number }[], windowMs: number): number[] {
  const out: number[] = [];
  let lo = 0,
    sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    while (frames[i].ts - frames[lo].ts > windowMs) sum -= vals[lo++];
    out.push(sum / (i - lo + 1));
  }
  return out;
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);
