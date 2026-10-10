// Optional extras, each behind its own key and each failing soft:
//  • Gemini multimodal review of every lost moment (presenter keyframe + transcript + metrics).
//    Privacy: only the PRESENTER's frame is sent; the audience is described by anonymous numbers.
//  • Amazon Rekognition Video cross-check of the browser's attention estimates on the recorded
//    audience video (face *detection*: pose + eyes only; no collections, no identity search).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Report } from '../../shared/report.ts';
import { AUDIENCE } from '../../shared/thresholds.ts';
import type { Repo, RecordingRow, SessionRow } from '../db/repo.ts';
import { LocalBlobs, type BlobStore } from '../storage.ts';
import { ffmpegPath } from '../status.ts';
import { config } from '../config.ts';

const run = promisify(execFile);

export interface SpikeReview {
  summary: string;
  likelyCause: string;
  fix: string;
  usedKeyframe: boolean;
}
export interface RekognitionCheck {
  status: 'running' | 'done' | 'error';
  error?: string;
  seconds?: number;
  meanAbsDiffPts?: number; // mean |browser − Rekognition| attention, percentage points
  correlation?: number | null;
  points?: { t: number; browser: number | null; rekognition: number }[];
}

export const geminiAvailable = () => !!config.geminiKey;
export const rekognitionAvailable = (blobs: BlobStore) => blobs.kind === 's3' && config.aws.hasCreds && !!ffmpegPath();

async function localCopy(blobs: BlobStore, key: string, dir: string): Promise<string> {
  const file = path.join(dir, path.basename(key));
  if (blobs instanceof LocalBlobs) fs.copyFileSync(blobs.file(key), file);
  else fs.writeFileSync(file, (await blobs.get(key)) ?? Buffer.alloc(0));
  return file;
}

async function keyframe(video: string, sec: number, dir: string): Promise<string | null> {
  const ff = ffmpegPath();
  if (!ff || sec < 0) return null;
  const out = path.join(dir, `kf-${Math.round(sec * 1000)}.jpg`);
  try {
    await run(ff, ['-y', '-loglevel', 'error', '-ss', sec.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', out], { timeout: 30_000 });
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

async function saveExtras(repo: Repo, session: SessionRow, patch: Record<string, unknown>) {
  const fresh = (await repo.getSession(session.id)) ?? session;
  const report = fresh.summary as Report;
  report.extras = { ...(report.extras ?? {}), ...patch };
  await repo.upsertSession({ ...fresh, summary: report });
}

// ---------------------------------------------------------------- Gemini

export async function geminiReview(repo: Repo, blobs: BlobStore, session: SessionRow): Promise<Record<string, SpikeReview>> {
  const report = session.summary as Report;
  const recs = await repo.getRecordings(session.id);
  const presenter = recs.find((r) => r.role === 'presenter' && r.status === 'ready');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtr-gem-'));
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const out: Record<string, SpikeReview> = {};
  try {
    const video = presenter ? await localCopy(blobs, presenter.finalKey ?? presenter.key, tmp) : null;
    for (const s of report.spikes.slice(0, 6)) {
      const frame = video && presenter ? await keyframe(video, (s.t - presenter.startOffsetMs) / 1000, tmp) : null;
      const prompt = `You are a presentation coach. At ${Math.floor(s.t / 60000)}:${String(Math.floor((s.t % 60000) / 1000)).padStart(2, '0')} the audience showed a "lost moment": ${s.text}.
Audience attention (anonymous engagement estimate from head pose) went from ${s.attentionBefore != null ? Math.round(s.attentionBefore * 100) + '%' : 'unknown'} to ${s.attentionAfter != null ? Math.round(s.attentionAfter * 100) + '%' : 'unknown'}.
The presenter was: ${s.presenter ?? 'unknown'}.
They were saying: "${s.transcript ?? '(no transcript)'}"
${frame ? 'The attached image is a frame of the presenter at that moment (their camera, mirrored).' : 'No video frame is available.'}
Explain briefly what most likely lost the room and one concrete fix. Do not speculate about anyone's emotions or identity.
Respond as JSON: {"summary": string (1 sentence), "likelyCause": string (1-2 sentences), "fix": string (1-2 sentences)}.`;
      const parts: unknown[] = [{ text: prompt }];
      if (frame) parts.push({ inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(frame).toString('base64') } });
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey! },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const j = JSON.parse(text) as Omit<SpikeReview, 'usedKeyframe'>;
      out[s.id] = { summary: j.summary, likelyCause: j.likelyCause, fix: j.fix, usedKeyframe: !!frame };
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  await saveExtras(repo, session, { spikeReviews: out, spikeReviewModel: model });
  return out;
}

// ---------------------------------------------------------------- Rekognition

export async function rekognitionCheck(repo: Repo, blobs: BlobStore, session: SessionRow): Promise<void> {
  const save = (r: RekognitionCheck) => saveExtras(repo, session, { rekognition: r });
  const recs = await repo.getRecordings(session.id);
  const aud: RecordingRow | undefined = recs.find((r) => r.role === 'audience' && r.status === 'ready');
  if (!aud) return save({ status: 'error', error: 'No audience recording for this session (turn on Record video).' });
  await save({ status: 'running' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtr-rek-'));
  try {
    // Rekognition Video reads MP4/MOV (H.264), so transcode the WebM once.
    const src = await localCopy(blobs, aud.finalKey ?? aud.key, tmp);
    const mp4 = path.join(tmp, 'audience.mp4');
    await run(ffmpegPath()!, ['-y', '-loglevel', 'error', '-i', src, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', mp4], { timeout: 15 * 60_000 });
    const key = `sessions/${session.id}/audience.rekognition.mp4`;
    await blobs.put(key, fs.readFileSync(mp4), 'video/mp4');

    const R = await import('@aws-sdk/client-rekognition');
    const rek = new R.RekognitionClient({ region: config.aws.region });
    const { JobId } = await rek.send(new R.StartFaceDetectionCommand({ Video: { S3Object: { Bucket: config.s3Bucket!, Name: key } }, FaceAttributes: 'ALL' }));
    const faces: { ts: number; yaw: number; pitch: number; eyesOpen: boolean }[] = [];
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const first = await rek.send(new R.GetFaceDetectionCommand({ JobId, MaxResults: 1000 }));
      if (first.JobStatus === 'FAILED') throw new Error(first.StatusMessage ?? 'Rekognition job failed');
      if (first.JobStatus !== 'SUCCEEDED') {
        if (i > 120) throw new Error('Rekognition timed out');
        continue;
      }
      let page: typeof first | undefined = first;
      while (page) {
        for (const f of page.Faces ?? [])
          faces.push({ ts: f.Timestamp ?? 0, yaw: f.Face?.Pose?.Yaw ?? 0, pitch: f.Face?.Pose?.Pitch ?? 0, eyesOpen: f.Face?.EyesOpen?.Value ?? true });
        page = page.NextToken ? await rek.send(new R.GetFaceDetectionCommand({ JobId, MaxResults: 1000, NextToken: page.NextToken })) : undefined;
      }
      break;
    }
    // Same rule as the browser: pose relative to the room's median pitch.
    const sorted = faces.map((f) => f.pitch).sort((a, b) => a - b);
    const base = sorted[sorted.length >> 1] ?? 0;
    const perSec = new Map<number, { n: number; att: number }>();
    for (const f of faces) {
      const t = Math.floor((f.ts + aud.startOffsetMs) / 1000) * 1000;
      const e = perSec.get(t) ?? { n: 0, att: 0 };
      e.n++;
      if (Math.abs(f.yaw) < AUDIENCE.attentiveYawDeg && f.pitch - base > AUDIENCE.downPitchDeg && f.eyesOpen) e.att++;
      perSec.set(t, e);
    }
    const samples = await repo.getSamples(session.id);
    const browserAt = (t: number) => {
      const s = samples.find((x) => Math.abs(x.t - t) < 700);
      return s?.audience?.attention ?? null;
    };
    const points = [...perSec.entries()].sort((a, b) => a[0] - b[0]).map(([t, e]) => ({ t, browser: browserAt(t), rekognition: e.att / e.n }));
    const paired = points.filter((p) => p.browser != null) as { t: number; browser: number; rekognition: number }[];
    const mad = paired.length ? (paired.reduce((a, p) => a + Math.abs(p.browser - p.rekognition), 0) / paired.length) * 100 : undefined;
    await save({ status: 'done', seconds: points.length, meanAbsDiffPts: mad != null ? Math.round(mad * 10) / 10 : undefined, correlation: pearson(paired.map((p) => p.browser), paired.map((p) => p.rekognition)), points });
  } catch (e) {
    await save({ status: 'error', error: (e as Error).message });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 5) return null;
  const ma = a.reduce((x, y) => x + y, 0) / a.length,
    mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? Math.round((num / Math.sqrt(da * db)) * 100) / 100 : null;
}
