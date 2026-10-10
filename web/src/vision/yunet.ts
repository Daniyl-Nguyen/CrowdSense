// OpenCV YuNet small-face detector (MIT, hosted on Hugging Face: opencv/face_detection_yunet)
// run in the browser with ONNX Runtime Web. Finds faces down to ~10 px in a 640×640 input,
// which MediaPipe's short-range detector misses at audience distances.
import * as ort from 'onnxruntime-web';

export interface FaceDet {
  x: number; // normalized to the source frame
  y: number;
  w: number;
  h: number;
  score: number;
  /** 5 keypoints (normalized): subject's right eye, left eye, nose tip, right/left mouth corner. */
  kps: [number, number][];
}

const N = 640;
const STRIDES = [8, 16, 32];

let session: Promise<ort.InferenceSession> | null = null;

function load() {
  ort.env.wasm.wasmPaths = '/ort/';
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  return (session ??= ort.InferenceSession.create('/models/face_detection_yunet_2023mar.onnx', {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }).catch((e) => {
    session = null;
    throw e;
  }));
}

export class YuNet {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private input = new Float32Array(3 * N * N);
  scoreThreshold = 0.55;
  ms = 0;

  private constructor(private sess: ort.InferenceSession) {
    this.canvas.width = N;
    this.canvas.height = N;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  static async create() {
    return new YuNet(await load());
  }

  /** Detect faces in a region of the source (default: whole frame), letterboxed into 640×640. */
  async detect(src: CanvasImageSource, W: number, H: number, region = { x: 0, y: 0, w: W, h: H }): Promise<FaceDet[]> {
    const t0 = performance.now();
    const scale = Math.max(region.w, region.h) / N;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, N, N);
    this.ctx.drawImage(src, region.x, region.y, region.w, region.h, 0, 0, region.w / scale, region.h / scale);
    const px = this.ctx.getImageData(0, 0, N, N).data;
    const plane = N * N;
    // BGR, 0..255, CHW (what OpenCV's FaceDetectorYN feeds the model).
    for (let i = 0, j = 0; i < plane; i++, j += 4) {
      this.input[i] = px[j + 2];
      this.input[plane + i] = px[j + 1];
      this.input[2 * plane + i] = px[j];
    }
    const out = await this.sess.run({ input: new ort.Tensor('float32', this.input, [1, 3, N, N]) });
    const raw: FaceDet[] = [];
    for (const s of STRIDES) {
      const cols = N / s;
      const cls = out[`cls_${s}`].data as Float32Array;
      const obj = out[`obj_${s}`].data as Float32Array;
      const bb = out[`bbox_${s}`].data as Float32Array;
      const kp = out[`kps_${s}`].data as Float32Array;
      for (let i = 0; i < cls.length; i++) {
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < this.scoreThreshold) continue;
        const c = i % cols,
          r = Math.floor(i / cols);
        const cx = (c + bb[i * 4]) * s,
          cy = (r + bb[i * 4 + 1]) * s;
        const w = Math.exp(bb[i * 4 + 2]) * s,
          h = Math.exp(bb[i * 4 + 3]) * s;
        const toX = (v: number) => (region.x + v * scale) / W;
        const toY = (v: number) => (region.y + v * scale) / H;
        const kps: [number, number][] = [];
        for (let k = 0; k < 5; k++) kps.push([toX((kp[i * 10 + 2 * k] + c) * s), toY((kp[i * 10 + 2 * k + 1] + r) * s)]);
        raw.push({ x: toX(cx - w / 2), y: toY(cy - h / 2), w: (w * scale) / W, h: (h * scale) / H, score, kps });
      }
    }
    this.ms = performance.now() - t0;
    return nms(raw, 0.3);
  }
}

export function nms(dets: FaceDet[], thr: number): FaceDet[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: FaceDet[] = [];
  for (const d of sorted) if (!keep.some((k) => iou(k, d) > thr)) keep.push(d);
  return keep;
}

function iou(a: FaceDet, b: FaceDet) {
  const x1 = Math.max(a.x, b.x),
    y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w),
    y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Coarse head pose from YuNet's 5 keypoints, used when a face is too small for landmarks.
 * Yaw: the nose tip sits ~0.6 eye-distances in front of the eye plane, so its sideways offset
 * is ≈ 0.6·tan(yaw). Pitch: where the nose falls between the eye line and the mouth line.
 */
export function kpsPose(k: [number, number][], W: number, H: number): { yaw: number; pitch: number } {
  const P = k.map(([x, y]) => [x * W, y * H]);
  const [re, le, nose, rm, lm] = P;
  const eye = [(re[0] + le[0]) / 2, (re[1] + le[1]) / 2];
  const mouth = [(rm[0] + lm[0]) / 2, (rm[1] + lm[1]) / 2];
  const eyeDist = Math.hypot(le[0] - re[0], le[1] - re[1]) || 1;
  const midX = (eye[0] + mouth[0]) / 2;
  const yaw = (Math.atan((nose[0] - midX) / eyeDist / 0.6) * 180) / Math.PI;
  const span = mouth[1] - eye[1] || 1;
  const p = (nose[1] - eye[1]) / span; // ~0.55 when level
  const pitch = -(p - 0.55) * 120;
  return { yaw, pitch };
}
