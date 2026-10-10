// Opt-in recordings: browser → presigned multipart upload (S3 or local) → ffmpeg remux for seeking.
// Also serves everything the synced Replay page needs.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Hub } from '../hub.ts';
import type { RecordingRow } from '../db/repo.ts';
import { LocalBlobs, type BlobStore } from '../storage.ts';
import { ffmpegPath } from '../status.ts';

const run = promisify(execFile);

export function recordingRoutes(hub: Hub, blobs: BlobStore) {
  const r = Router();

  const find = async (sessionId: string, recId: string) => (await hub.repo.getRecordings(sessionId)).find((x) => x.id === recId) ?? null;

  r.post('/sessions/:id/recordings', async (req, res) => {
    const session = await hub.repo.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const room = hub.find(session.id);
    if (!room?.recording) return res.status(403).json({ error: 'Recording is not enabled for this session' });
    const role = req.body?.role === 'audience' ? 'audience' : 'presenter';
    const mime = String(req.body?.mime ?? 'video/webm').slice(0, 80);
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const id = crypto.randomUUID();
    const key = `sessions/${session.id}/${role}-${id.slice(0, 8)}.${ext}`;
    const uploadId = await blobs.createMultipart(key, mime);
    const row: RecordingRow = {
      id,
      sessionId: session.id,
      role,
      key,
      uploadId,
      status: 'recording',
      startOffsetMs: Math.max(0, Number(req.body?.startOffsetMs) || 0),
      durationMs: null,
      mime,
      finalKey: null,
    };
    await hub.repo.upsertRecording(row);
    res.json({ id, key });
  });

  r.post('/sessions/:id/recordings/:recId/part', async (req, res) => {
    const rec = await find(req.params.id, req.params.recId);
    if (!rec || rec.status !== 'recording' || !rec.uploadId) return res.status(404).json({ error: 'No active upload' });
    const n = Number(req.body?.partNumber);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return res.status(400).json({ error: 'bad part number' });
    res.json({ url: await blobs.partUrl(rec.key, rec.uploadId, n) });
  });

  r.post('/sessions/:id/recordings/:recId/complete', async (req, res) => {
    const rec = await find(req.params.id, req.params.recId);
    if (!rec || !rec.uploadId) return res.status(404).json({ error: 'No active upload' });
    const parts = (req.body?.parts ?? []) as { PartNumber: number; ETag: string }[];
    if (!parts.length) {
      await blobs.abortMultipart(rec.key, rec.uploadId);
      await hub.repo.upsertRecording({ ...rec, status: 'failed' });
      return res.json({ status: 'empty' });
    }
    await blobs.completeMultipart(rec.key, rec.uploadId, parts);
    const done: RecordingRow = { ...rec, status: 'uploaded', uploadId: null, durationMs: Math.round(Number(req.body?.durationMs) || 0) || null };
    await hub.repo.upsertRecording(done);
    res.json({ status: 'uploaded' });
    void finalize(done);
  });

  /** Make MediaRecorder output seekable: remux (no re-encode) so the file gets cues + duration. */
  async function finalize(rec: RecordingRow) {
    const ff = ffmpegPath();
    if (!ff) {
      await hub.repo.upsertRecording({ ...rec, status: 'ready', finalKey: rec.key });
      return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtr-'));
    const ext = path.extname(rec.key);
    const input = path.join(tmp, `in${ext}`);
    const output = path.join(tmp, `out${ext}`);
    try {
      await hub.repo.upsertRecording({ ...rec, status: 'processing' });
      if (blobs instanceof LocalBlobs) fs.copyFileSync(blobs.file(rec.key), input);
      else fs.writeFileSync(input, (await blobs.get(rec.key)) ?? Buffer.alloc(0));
      const args = ['-y', '-loglevel', 'error', '-fflags', '+genpts', '-i', input, '-c', 'copy'];
      if (ext === '.mp4') args.push('-movflags', '+faststart');
      await run(ff, [...args, output], { timeout: 10 * 60_000 });
      const finalKey = rec.key.replace(ext, `.seekable${ext}`);
      await blobs.put(finalKey, fs.readFileSync(output), rec.mime);
      await hub.repo.upsertRecording({ ...rec, status: 'ready', finalKey });
      console.log(`[rec] ${rec.role} recording remuxed → ${finalKey}`);
    } catch (e) {
      console.warn('[rec] remux failed; serving original', (e as Error).message);
      await hub.repo.upsertRecording({ ...rec, status: 'ready', finalKey: rec.key });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  r.get('/sessions/:id/replay', async (req, res) => {
    const session = await hub.repo.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const [samples, transcript, spikes, tips, reactions, recs] = await Promise.all([
      hub.repo.getSamples(session.id),
      hub.repo.getTranscript(session.id),
      hub.repo.getSpikes(session.id),
      hub.repo.getTips(session.id),
      hub.repo.getReactions(session.id),
      hub.repo.getRecordings(session.id),
    ]);
    // One video per role: the longest finished recording.
    const byRole = new Map<string, RecordingRow>();
    for (const rec of recs.filter((x) => x.status !== 'failed' && x.status !== 'recording'))
      if (!byRole.has(rec.role) || (rec.durationMs ?? 0) > (byRole.get(rec.role)!.durationMs ?? 0)) byRole.set(rec.role, rec);
    const recordings = await Promise.all(
      [...byRole.values()].map(async (rec) => ({
        id: rec.id,
        role: rec.role,
        status: rec.status,
        mime: rec.mime,
        startOffsetMs: rec.startOffsetMs,
        durationMs: rec.durationMs,
        url: await blobs.getUrl(rec.finalKey ?? rec.key, 6 * 3600),
      })),
    );
    res.json({
      session: { id: session.id, title: session.title, mode: session.mode, startedAt: session.startedAt, endedAt: session.endedAt },
      durationMs: (session.endedAt ?? Date.now()) - (session.startedAt ?? session.createdAt),
      samples,
      transcript,
      spikes,
      nudges: tips.filter((t) => t.origin === 'live'),
      reactions: reactions.map((x) => ({ t: x.t, kind: x.kind, text: x.text })),
      recordings,
      processing: recs.some((x) => x.status === 'recording' || x.status === 'uploaded' || x.status === 'processing'),
    });
  });

  return r;
}
