import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { DrawData } from './presenter.ts';

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [0, 11], [0, 12],
];

function fit(c: HTMLCanvasElement, v: HTMLVideoElement) {
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr)) {
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
  }
  // Map normalized video coords into the object-fit: contain box.
  const vw = v.videoWidth || 1, vh = v.videoHeight || 1;
  const scale = Math.min(c.width / vw, c.height / vh);
  const ox = (c.width - vw * scale) / 2, oy = (c.height - vh * scale) / 2;
  return (p: { x: number; y: number }) => [ox + p.x * vw * scale, oy + p.y * vh * scale] as const;
}

export function drawPresenterOverlay(c: HTMLCanvasElement, v: HTMLVideoElement, d: DrawData) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const map = fit(c, v);
  ctx.clearRect(0, 0, c.width, c.height);
  const css = getComputedStyle(document.documentElement);
  if (d.pose) {
    ctx.lineWidth = 4 * (window.devicePixelRatio || 1);
    ctx.lineCap = 'round';
    ctx.strokeStyle = css.getPropertyValue('--spot').trim() || '#ffb547';
    const vis = (p: NormalizedLandmark) => (p.visibility ?? 0) > 0.5;
    for (const [a, b] of BONES) {
      const pa = d.pose[a], pb = d.pose[b];
      if (!pa || !pb || !vis(pa) || !vis(pb)) continue;
      const [x1, y1] = map(pa), [x2, y2] = map(pb);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  if (d.face) {
    ctx.fillStyle = css.getPropertyValue('--st-attentive').trim() || '#56b4e9';
    for (let i = 0; i < d.face.length; i += 6) {
      const [x, y] = map(d.face[i]);
      ctx.fillRect(x - 1, y - 1, 2.5, 2.5);
    }
  }
}

/** Audience overlay: one box per tracked face, colored + shaped by state. */
export function drawAudienceOverlay(
  c: HTMLCanvasElement,
  v: HTMLVideoElement,
  boxes: { x: number; y: number; w: number; h: number; id: number; state: string }[],
) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const map = fit(c, v);
  ctx.clearRect(0, 0, c.width, c.height);
  const css = getComputedStyle(document.documentElement);
  const dpr = window.devicePixelRatio || 1;
  ctx.font = `${12 * dpr}px ui-monospace, monospace`;
  for (const b of boxes) {
    const [x1, y1] = map({ x: b.x, y: b.y });
    const [x2, y2] = map({ x: b.x + b.w, y: b.y + b.h });
    const color = css.getPropertyValue(`--st-${b.state}`).trim() || '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * dpr;
    ctx.setLineDash(b.state === 'attentive' ? [] : [6 * dpr, 4 * dpr]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.fillStyle = color;
    ctx.fillText(`#${b.id}`, x1 + 3 * dpr, y1 - 4 * dpr);
  }
  ctx.setLineDash([]);
}
