// Head pose from face landmarks, without the transformation matrix (and its conventions).
// Build the face plane from the eye line (33→263) and the vertical (10 forehead → 152 chin),
// in pixel space so aspect ratio is right. Forward = vertical × eyeLine points out of the face.
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface HeadPose {
  yaw: number; // degrees; + = face turned toward image right (camera's right)
  pitch: number; // degrees; + = up, − = down
}

export function headPose(lm: NormalizedLandmark[], w: number, h: number): HeadPose {
  const p = (i: number) => [lm[i].x * w, lm[i].y * h, lm[i].z * w] as const;
  const r = p(33),
    l = p(263),
    top = p(10),
    chin = p(152);
  const a = [l[0] - r[0], l[1] - r[1], l[2] - r[2]]; // eye line, image-right for a frontal face
  const b = [chin[0] - top[0], chin[1] - top[1], chin[2] - top[2]]; // forehead → chin, image-down
  // f = b × a ; frontal face gives (0, 0, -1): pointing at the camera (z grows away from camera).
  const f = [b[1] * a[2] - b[2] * a[1], b[2] * a[0] - b[0] * a[2], b[0] * a[1] - b[1] * a[0]];
  const n = Math.hypot(f[0], f[1], f[2]) || 1;
  const fx = f[0] / n,
    fy = f[1] / n,
    fz = f[2] / n;
  const deg = 180 / Math.PI;
  return {
    yaw: Math.atan2(fx, -fz) * deg,
    pitch: -Math.atan2(fy, Math.hypot(fx, fz)) * deg,
  };
}

export function faceBox(lm: NormalizedLandmark[]) {
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function blend(categories: { categoryName: string; score: number }[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of categories ?? []) out[c.categoryName] = c.score;
  return out;
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const percentile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};
export const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
