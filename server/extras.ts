// Report routes, blob storage, and post-session processing.
import type { Express } from 'express';
import type { Hub } from './hub.ts';
import type { BlobStore } from './storage.ts';
import { buildReport } from './report.ts';
import { geminiCoach } from './ai/gemini.ts';
import { coach, registerCoach } from './ai/coach.ts';
import { setStatus } from './status.ts';
import { recordingRoutes } from './routes/recordings.ts';
import { debriefScript, synthesize, ttsAvailable } from './ai/tts.ts';
import type { Report } from '../shared/report.ts';
import { geminiAvailable, geminiReview, rekognitionAvailable, rekognitionCheck } from './ai/review.ts';

const regenerationErrors = new Map<string, string>();
const building = new Map<string, Promise<unknown>>();

export function generate(hub: Hub, blobs: BlobStore, sessionId: string, requireAI = false) {
  let p = building.get(sessionId);
  if (!p) {
    p = buildReport(hub.repo, blobs, sessionId, requireAI)
      .finally(() => building.delete(sessionId));
    building.set(sessionId, p);
  }
  return p;
}

export async function mountExtras(app: Express, hub: Hub, blobs: BlobStore) {
  // Gemini coaching; initial reports retain the template fallback.
  registerCoach(geminiCoach);
  setStatus({ coach: coach.activeName(), extras: { gemini: geminiAvailable(), tts: ttsAvailable(), rekognition: rekognitionAvailable(blobs) } });
  hub.onEnded = (room) => {
    // Give Whisper a moment to finish the last utterance before summarizing.
    setTimeout(async () => {
      try { await generate(hub, blobs, room.id); } catch { console.warn('[report] Automatic report generation failed'); return; }
      room.broadcast({ type: 'report.ready', sessionId: room.id });
      // Optional: Gemini reviews each lost moment once recordings have settled.
      if (geminiAvailable())
        setTimeout(async () => {
          const s = await hub.repo.getSession(room.id);
          if (s?.summary && (s.summary as Report).spikes.length) await geminiReview(hub.repo, blobs, s).catch((e) => console.warn('[gemini]', e.message));
        }, 20_000);
    }, 4000);
  };

  app.use('/api', recordingRoutes(hub, blobs));

  app.post('/api/sessions/:id/spike-review', async (req, res) => {
    if (!geminiAvailable()) return res.status(404).json({ error: 'GEMINI_API_KEY not set' });
    const s = await hub.repo.getSession(req.params.id);
    if (!s?.summary) return res.status(404).json({ error: 'No report yet' });
    try {
      res.json({ reviews: await geminiReview(hub.repo, blobs, s) });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  app.post('/api/sessions/:id/rekognition', async (req, res) => {
    if (!rekognitionAvailable(blobs)) return res.status(404).json({ error: 'Needs S3 storage, AWS credentials and ffmpeg' });
    const s = await hub.repo.getSession(req.params.id);
    if (!s?.summary) return res.status(404).json({ error: 'No report yet' });
    void rekognitionCheck(hub.repo, blobs, s);
    res.status(202).json({ status: 'running' });
  });

  app.post('/api/tts', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!ttsAvailable() || !text) return res.sendStatus(404);
    try {
      res.type('audio/mpeg').send(await synthesize(text));
    } catch (e) {
      console.warn('[tts]', (e as Error).message);
      res.sendStatus(502);
    }
  });

  /** Spoken debrief: MP3 via ElevenLabs when configured, otherwise the script for browser speech. */
  app.get('/api/sessions/:id/debrief', async (req, res) => {
    const s = await hub.repo.getSession(req.params.id);
    if (!s?.summary) return res.status(404).json({ error: 'No report yet' });
    const text = debriefScript(s.summary as Report);
    if (req.query.format === 'text' || !ttsAvailable()) return res.json({ text, audio: false });
    try {
      res.type('audio/mpeg').send(await synthesize(text));
    } catch (e) {
      console.warn('[tts] debrief', (e as Error).message);
      res.json({ text, audio: false });
    }
  });

  app.get('/api/sessions/:id/report', async (req, res) => {
    const s = await hub.repo.getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (building.has(s.id)) return res.status(202).json({ status: 'building' });
    const regenerationError = regenerationErrors.get(s.id);
    if (regenerationError) return res.status(502).json({ error: regenerationError });
    if (s.summary) return res.json({ status: 'ready', report: s.summary });
    if (s.status !== 'ended') return res.status(409).json({ status: s.status, error: 'Session has not ended yet' });
    void generate(hub, blobs, s.id).catch(() => console.warn('[report] Report generation failed'));
    res.status(202).json({ status: 'building' });
  });

  app.post('/api/sessions/:id/report/regenerate', async (req, res) => {
    const s = await hub.repo.getSession(req.params.id);
    if (!s || s.status !== 'ended') return res.status(404).json({ error: 'No ended session' });
    if (building.has(s.id)) return res.status(409).json({ error: 'A report is already being generated. Please try again when it finishes.' });
    regenerationErrors.delete(s.id);
    void generate(hub, blobs, s.id, true).catch((e) => {
      const message = (e as Error).message;
      const safe = /^(AI coaching|No AI coaching)/.test(message) ? message : 'Could not update the report. Please try again.';
      regenerationErrors.set(s.id, safe);
      setTimeout(() => { if (regenerationErrors.get(s.id) === safe) regenerationErrors.delete(s.id); }, 10 * 60000).unref();
    });
    res.status(202).json({ status: 'building' });
  });
}
