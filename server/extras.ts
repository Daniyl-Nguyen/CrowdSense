// Report routes, blob storage, and post-session processing.
import type { Express } from 'express';
import type { Hub } from './hub.ts';
import type { BlobStore } from './storage.ts';
import { buildReport } from './report.ts';
import { coach } from './ai/coach.ts';
import { setStatus } from './status.ts';

const building = new Map<string, Promise<unknown>>();

export function generate(hub: Hub, blobs: BlobStore, sessionId: string) {
  let p = building.get(sessionId);
  if (!p) {
    p = buildReport(hub.repo, blobs, sessionId)
      .catch((e) => console.warn('[report] failed', e))
      .finally(() => building.delete(sessionId));
    building.set(sessionId, p);
  }
  return p;
}

export async function mountExtras(app: Express, hub: Hub, blobs: BlobStore) {
  setStatus({ coach: coach.activeName() });
  hub.onEnded = (room) => {
    // Give Whisper a moment to finish the last utterance before summarizing.
    setTimeout(async () => {
      await generate(hub, blobs, room.id);
      room.broadcast({ type: 'report.ready', sessionId: room.id });
    }, 4000);
  };

  app.get('/api/sessions/:id/report', async (req, res) => {
    const s = await hub.repo.getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (s.summary) return res.json({ status: 'ready', report: s.summary });
    if (s.status !== 'ended') return res.status(409).json({ status: s.status, error: 'Session has not ended yet' });
    void generate(hub, blobs, s.id);
    res.status(202).json({ status: 'building' });
  });

  app.post('/api/sessions/:id/report/regenerate', async (req, res) => {
    const s = await hub.repo.getSession(req.params.id);
    if (!s || s.status !== 'ended') return res.status(404).json({ error: 'No ended session' });
    await generate(hub, blobs, s.id);
    const fresh = await hub.repo.getSession(s.id);
    res.json({ status: 'ready', report: fresh?.summary });
  });
}
