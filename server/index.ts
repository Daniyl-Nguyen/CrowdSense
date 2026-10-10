import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { config, lanUrls } from './config.ts';
import { Hub } from './hub.ts';
import { LocalRepo, type Repo } from './db/repo.ts';
import { attachWs } from './ws.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { resolveFfmpeg, setStatus } from './status.ts';
import { transcriber } from './ai/whisper.ts';

async function makeRepo(): Promise<Repo> {
  if (config.neonUrl) {
    try {
      const { NeonRepo } = await import('./db/neon.ts');
      const repo = new NeonRepo(config.neonUrl) as unknown as Repo;
      await repo.init();
      setStatus({ storage: 'neon' });
      console.log('[db] Neon Postgres connected');
      return repo;
    } catch (e) {
      console.warn(`[db] Neon unavailable (${(e as Error).message}); falling back to local JSON storage`);
    }
  }
  const repo = new LocalRepo(config.dataDir);
  await repo.init();
  return repo;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// MediaPipe runtime + models are served locally (no CDN version drift, works offline after install).
app.use('/mediapipe/wasm', express.static(path.resolve('node_modules/@mediapipe/tasks-vision/wasm'), { maxAge: '7d' }));
app.get('/models/:name', (req, res) => {
  const file = path.resolve('.cache/models', path.basename(req.params.name));
  if (fs.existsSync(file)) return res.sendFile(file, { maxAge: '7d', dotfiles: 'allow' });
  const remote: Record<string, string> = {
    'face_landmarker.task':
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    'pose_landmarker_lite.task':
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  };
  const url = remote[req.params.name];
  return url ? res.redirect(url) : res.sendStatus(404);
});

const repo = await makeRepo();
const hub = new Hub(repo);
const { mountExtras } = await import('./extras.ts');
await mountExtras(app, hub);
app.use('/api', sessionRoutes(hub));

// Production: serve the built web app.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|ws|models|mediapipe).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
attachWs(server, hub);
await resolveFfmpeg();
server.listen(config.port, () => {
  console.log(`[server] API on http://localhost:${config.port}  (whisper: ${transcriber.status})`);
  console.log(`[server] open http://localhost:${config.webPort}${config.https ? ' (https)' : ''}`);
  for (const u of lanUrls()) console.log(`[server] LAN/tunnel: ${u}`);
});
