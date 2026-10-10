import { Router } from 'express';
import type { Hub } from '../hub.ts';
import { serverConfig } from '../status.ts';

export function sessionRoutes(hub: Hub) {
  const r = Router();

  r.get('/config', (_req, res) => {
    res.json(serverConfig());
  });

  r.post('/sessions', async (req, res) => {
    const { presenterId, mode, title } = req.body ?? {};
    if (typeof presenterId !== 'string' || !/^[\w-]{8,64}$/.test(presenterId))
      return res.status(400).json({ error: 'presenterId required' });
    const room = await hub.create(presenterId, mode === 'practice' ? 'practice' : 'live', title);
    res.json(room.info());
  });

  /** Live session lookup by room code (or id). */
  r.get('/sessions/live/:code', (req, res) => {
    const room = hub.find(req.params.code);
    if (!room) return res.status(404).json({ error: 'No session with that code' });
    res.json(room.info());
  });

  /** Compact history so a dashboard that joins mid-session can backfill its timeline and feeds. */
  r.get('/sessions/:id/history', async (req, res) => {
    const id = hub.find(req.params.id)?.id ?? req.params.id;
    const [samples, spikes, tips, transcript, reactions] = await Promise.all([
      hub.repo.getSamples(id),
      hub.repo.getSpikes(id),
      hub.repo.getTips(id),
      hub.repo.getTranscript(id),
      hub.repo.getReactions(id),
    ]);
    res.json({
      points: samples.map((s) => ({ t: s.t, attention: s.audience?.attention ?? null, score: s.score?.score ?? null })),
      spikes,
      nudges: tips.filter((t) => t.origin === 'live'),
      transcript: transcript.slice(-50),
      questions: reactions.filter((r) => r.kind === 'question').map((r) => ({ t: r.t, text: r.text ?? null })),
    });
  });

  /** Session history for the anonymous presenter ID stored in this browser. */
  r.get('/presenters/:pid/sessions', async (req, res) => {
    const rows = await hub.repo.listSessions(req.params.pid, 30);
    res.json(
      rows.map((s) => ({
        id: s.id,
        title: s.title,
        mode: s.mode,
        status: s.status,
        createdAt: s.createdAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        score: s.score,
        hasReport: !!s.summary,
      })),
    );
  });

  return r;
}
