// Audience analysis, two stages:
//   1. YuNet finds every face (small/distant ones too) each frame.
//   2. MediaPipe Face Landmarker refines a rotating subset of faces from tight crops (accurate
//      head pose, eye closure, blendshapes); the rest use YuNet keypoint pose until their turn.
// Faces become anonymous tracks: IDs are counters assigned by position continuity. No recognition,
// no embeddings. Everything is discarded when the page closes.
import type { FaceLandmarker } from './mediapipe.ts';
import type { AudienceFace, AudienceSample, FaceState } from '@shared/types.ts';
import { AUDIENCE } from '@shared/thresholds.ts';
import { aggregateAudience } from '@shared/audience.ts';
import { blend, headPose, median } from './geometry.ts';
import { YuNet, kpsPose, nms, type FaceDet } from './yunet.ts';

interface LmObs {
  ts: number;
  yaw: number;
  pitch: number;
  closed: number;
  browDown: number;
  smile: number;
}

interface FrameObs {
  ts: number;
  cls: Exclude<FaceState, 'drowsy'>;
  browDown: number;
  smile: number;
}

interface Track {
  id: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  lastSeen: number;
  firstSeen: number;
  lastLandmarked: number;
  lm: LmObs | null;
  obs: FrameObs[];
  closedSince: number | null;
  state: FaceState;
}

export interface TrackBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  state: FaceState;
}

/** Detector tiles (cols×rows). One 640 px pass finds most faces; tiles double resolution for far rooms. */
export type Grid = '1x1' | '2x1' | '2x2';
export const GRIDS: { id: Grid; label: string }[] = [
  { id: '1x1', label: 'Whole frame (fastest)' },
  { id: '2x1', label: '2 tiles (bigger rooms)' },
  { id: '2x2', label: '4 tiles (distant faces, slowest)' },
];

const CROP = 256;

export class AudienceAnalyzer {
  private tracks: Track[] = [];
  private nextId = 1;
  private crop = document.createElement('canvas');
  private cropCtx: CanvasRenderingContext2D;
  private pitchSamples: number[] = [];
  private calibrateStart: number | null = null;
  private extents: { ts: number; x: number; y: number }[] = [];
  private lmMs = 15;
  roomPitch: number | null = null;
  grid: Grid = '1x1';
  flipX = false;
  fps = 0;
  detectMs = 0;
  private frameTimes: number[] = [];

  constructor(
    private yunet: YuNet,
    private landmarker: FaceLandmarker,
  ) {
    this.crop.width = CROP;
    this.crop.height = CROP;
    this.cropCtx = this.crop.getContext('2d')!;
  }

  recalibrate() {
    this.roomPitch = null;
    this.pitchSamples = [];
    this.calibrateStart = null;
  }

  private regions(W: number, H: number) {
    const [cols, rows] = this.grid.split('x').map(Number);
    if (cols === 1 && rows === 1) return [{ x: 0, y: 0, w: W, h: H }];
    const ov = 0.15;
    const tw = W / cols,
      th = H / rows;
    const out = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = Math.max(0, c * tw - tw * ov),
          y = Math.max(0, r * th - th * ov);
        out.push({ x, y, w: Math.min(W - x, tw * (1 + 2 * ov)), h: Math.min(H - y, th * (1 + 2 * ov)) });
      }
    return out;
  }

  /** One analysis step on the current frame. */
  async process(video: HTMLVideoElement, now: number): Promise<TrackBox[]> {
    const W = video.videoWidth,
      H = video.videoHeight;
    if (!W || video.readyState < 2) return this.boxes(now);
    const t0 = performance.now();
    let dets: FaceDet[] = [];
    for (const r of this.regions(W, H)) dets.push(...(await this.yunet.detect(video, W, H, r)));
    if (this.grid !== '1x1') dets = nms(dets, 0.3);
    this.detectMs = performance.now() - t0;

    const matched = this.associate(dets, now);
    this.refine(video, W, H, matched, now);
    const base = this.calibratePitch(matched, now, W, H);
    for (const [t, d] of matched) this.observe(t, d, now, base, W, H);
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < AUDIENCE.trackTtlMs);

    this.frameTimes.push(now);
    this.frameTimes = this.frameTimes.filter((t) => now - t < 2000);
    this.fps = this.frameTimes.length / 2;
    return this.boxes(now);
  }

  /** Greedy nearest-neighbour association gated by face size; unmatched detections start tracks. */
  private associate(dets: FaceDet[], now: number): [Track, FaceDet][] {
    const pairs: { ti: number; di: number; d: number }[] = [];
    this.tracks.forEach((t, ti) =>
      dets.forEach((d, di) => {
        const cx = d.x + d.w / 2,
          cy = d.y + d.h / 2;
        const dist = Math.hypot(t.cx - cx, (t.cy - cy) * 0.75);
        if (dist < 0.9 * Math.max(t.w, d.w)) pairs.push({ ti, di, d: dist });
      }),
    );
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set<number>(),
      usedD = new Set<number>();
    const out: [Track, FaceDet][] = [];
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue;
      usedT.add(p.ti);
      usedD.add(p.di);
      out.push([this.tracks[p.ti], dets[p.di]]);
    }
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      const t: Track = {
        id: this.nextId++,
        cx: d.x + d.w / 2,
        cy: d.y + d.h / 2,
        w: d.w,
        h: d.h,
        lastSeen: now,
        firstSeen: now,
        lastLandmarked: 0,
        lm: null,
        obs: [],
        closedSince: null,
        state: 'attentive',
      };
      this.tracks.push(t);
      out.push([t, d]);
    });
    return out;
  }

  /** Landmark the least-recently-refined faces within a per-frame time budget. */
  private refine(video: HTMLVideoElement, W: number, H: number, matched: [Track, FaceDet][], now: number) {
    const budgetMs = 90;
    const k = Math.max(2, Math.min(12, Math.floor(budgetMs / Math.max(4, this.lmMs))));
    const order = [...matched].sort((a, b) => a[0].lastLandmarked - b[0].lastLandmarked).slice(0, k);
    for (const [t, d] of order) {
      const side = 1.9 * Math.max(d.w * W, d.h * H);
      const sx = (d.x + d.w / 2) * W - side / 2,
        sy = (d.y + d.h / 2) * H - side / 2;
      this.cropCtx.fillStyle = '#000';
      this.cropCtx.fillRect(0, 0, CROP, CROP);
      this.cropCtx.drawImage(video, sx, sy, side, side, 0, 0, CROP, CROP);
      const s = performance.now();
      const res = this.landmarker.detect(this.crop);
      this.lmMs = this.lmMs * 0.8 + (performance.now() - s) * 0.2;
      t.lastLandmarked = now;
      const lm = res.faceLandmarks[0];
      if (!lm) continue;
      const hp = headPose(lm, CROP, CROP);
      const b = blend(res.faceBlendshapes?.[0]?.categories);
      t.lm = {
        ts: now,
        yaw: hp.yaw,
        pitch: hp.pitch,
        closed: ((b.eyeBlinkLeft ?? 0) + (b.eyeBlinkRight ?? 0)) / 2,
        browDown: ((b.browDownLeft ?? 0) + (b.browDownRight ?? 0)) / 2,
        smile: ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2,
      };
    }
  }

  private pose(t: Track, d: FaceDet, now: number, W: number, H: number) {
    // Fresh landmarks win; otherwise fall back to keypoint pose (coarser, but every frame).
    if (t.lm && now - t.lm.ts < 900) return { yaw: t.lm.yaw, pitch: t.lm.pitch, lm: t.lm };
    const kp = kpsPose(d.kps, W, H);
    return { yaw: kp.yaw, pitch: kp.pitch, lm: null };
  }

  /** The room's typical head pitch over the first few seconds = "attentive" for this camera. */
  private calibratePitch(matched: [Track, FaceDet][], now: number, W: number, H: number): number {
    if (this.roomPitch == null && matched.length) {
      this.calibrateStart ??= now;
      for (const [t, d] of matched) this.pitchSamples.push(this.pose(t, d, now, W, H).pitch);
      if (now - this.calibrateStart > AUDIENCE.calibrateSec * 1000 && this.pitchSamples.length >= 10) this.roomPitch = median(this.pitchSamples);
    }
    return this.roomPitch ?? (this.pitchSamples.length ? median(this.pitchSamples) : 0);
  }

  private observe(t: Track, d: FaceDet, now: number, basePitch: number, W: number, H: number) {
    const a = 0.5;
    t.cx += (d.x + d.w / 2 - t.cx) * a;
    t.cy += (d.y + d.h / 2 - t.cy) * a;
    t.w += (d.w - t.w) * a;
    t.h += (d.h - t.h) * a;
    t.lastSeen = now;
    const { yaw, pitch, lm } = this.pose(t, d, now, W, H);
    const rel = pitch - basePitch;
    let cls: FrameObs['cls'];
    // Looking down also lowers the eyelids, so "down" wins over "eyes closed".
    if (rel < AUDIENCE.downPitchDeg && Math.abs(yaw) < 55) cls = 'down';
    else if (Math.abs(yaw) > AUDIENCE.attentiveYawDeg || rel > AUDIENCE.upPitchDeg) cls = 'away';
    else cls = 'attentive';
    if (lm && lm.ts === now) {
      if (lm.closed > AUDIENCE.eyesClosed && cls !== 'down') t.closedSince ??= now;
      else t.closedSince = null;
    }
    t.obs.push({ ts: now, cls, browDown: t.lm?.browDown ?? 0, smile: t.lm?.smile ?? 0 });
    while (t.obs.length && t.obs[0].ts < now - 1500) t.obs.shift();
  }

  private boxes(now: number): TrackBox[] {
    return this.tracks
      .filter((t) => now - t.lastSeen < 600)
      .map((t) => ({ id: t.id, x: t.cx - t.w / 2, y: t.cy - t.h / 2, w: t.w, h: t.h, state: t.state }));
  }

  /** Once per second: per-face states, then the shared aggregator builds zones. */
  summarize(t: number, now: number, source: AudienceSample['source']): AudienceSample {
    const faces: AudienceFace[] = [];
    const live = this.tracks.filter((tr) => now - tr.lastSeen < 1200 && now - tr.firstSeen > 300);
    for (const tr of live) this.extents.push({ ts: now, x: tr.cx, y: tr.cy });
    this.extents = this.extents.filter((e) => now - e.ts < 60_000);
    const xs = this.extents.map((e) => e.x),
      ys = this.extents.map((e) => e.y);
    // Spread dots over the map using the room's observed extent (last 60 s).
    const norm = (v: number, lo: number, hi: number) => (hi - lo < 0.15 ? v : Math.max(0, Math.min(1, 0.08 + ((v - lo) / (hi - lo)) * 0.84)));
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const maxH = Math.max(0.0001, ...live.map((l) => l.h));
    for (const tr of live) {
      const recent = tr.obs.filter((o) => o.ts > now - 1200);
      if (!recent.length) continue;
      const counts = { attentive: 0, down: 0, away: 0 };
      for (const o of recent) counts[o.cls]++;
      let state: FaceState = (Object.keys(counts) as (keyof typeof counts)[]).reduce((a, k) => (counts[k] > counts[a] ? k : a), 'attentive');
      if (tr.closedSince != null && now - tr.closedSince > AUDIENCE.drowsySec * 1000) state = 'drowsy';
      tr.state = state;
      const lmFresh = tr.lm && now - tr.lm.ts < 3000;
      const x = norm(tr.cx, minX, maxX);
      faces.push({
        id: tr.id,
        x: round(this.flipX ? 1 - x : x),
        y: round(norm(tr.cy, minY, maxY)),
        size: round(tr.h / maxH),
        state,
        confusion: !!lmFresh && tr.lm!.browDown > AUDIENCE.confusionBrowDown,
        smile: !!lmFresh && tr.lm!.smile > AUDIENCE.smile,
      });
    }
    return aggregateAudience(t, faces, source);
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;
