import express from 'express';
import { authRoutes, owns } from './auth.ts';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { config, lanUrls } from './config.ts';
import { Hub } from './hub.ts';
import { LocalRepo, type Repo } from './db/repo.ts';
import { LocalBlobs, S3Blobs, type BlobStore } from './storage.ts';
import { attachWs } from './ws.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { resolveFfmpeg, setStatus } from './status.ts';
import { transcriber } from './ai/whisper.ts';

async function makeRepo(): Promise<Repo> {
  if (config.neonUrl) {
    try {
      const { NeonRepo } = await import('./db/neon.ts');
      const repo: Repo = new NeonRepo(config.neonUrl);
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

async function makeBlobs(): Promise<BlobStore> {
  if (config.s3Bucket) {
    try {
      const s3 = new S3Blobs(config.s3Bucket);
      await s3.init();
      setStatus({ blobs: 's3' });
      console.log(`[s3] using bucket ${config.s3Bucket}`);
      return s3;
    } catch (e) {
      throw e;
    }
  }
  return new LocalBlobs(config.dataDir);
}

const app = express();
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && config.publicUrl && req.get('origin') !== new URL(config.publicUrl).origin)
    return res.status(403).json({ error: 'Please use the app website for this request' });
  next();
});
app.use(express.json({ limit: '2mb' }));

// MediaPipe runtime + models are served locally (no CDN version drift, works offline after install).
app.use('/ort', express.static(path.resolve('node_modules/onnxruntime-web/dist'), { maxAge: '7d' }));
app.use('/mediapipe/wasm', express.static(path.resolve('node_modules/@mediapipe/tasks-vision/wasm'), { maxAge: '7d' }));
app.get('/models/:name', (req, res) => {
  const file = path.resolve('.cache/models', path.basename(req.params.name));
  if (fs.existsSync(file)) return res.sendFile(file, { maxAge: '7d', dotfiles: 'allow' });
  const remote: Record<string, string> = {
    'face_detection_yunet_2023mar.onnx':
      'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    'face_landmarker.task':
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    'pose_landmarker_lite.task':
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  };
  const url = remote[req.params.name];
  return url ? res.redirect(url) : res.sendStatus(404);
});

const repo = await makeRepo();
const blobs = await makeBlobs();
if (blobs instanceof LocalBlobs || blobs instanceof S3Blobs) blobs.mount(app);
const hub = new Hub(repo);
app.use('/api/auth', authRoutes());
app.use('/api/sessions/:id', async (req, res, next) => {
  if (req.params.id === 'live') return next();
  const session = await repo.getSession(req.params.id);
  if (session?.presenterId.startsWith('account:') && !owns(req, session.presenterId)) {
    // Upload endpoints validate a separate camera-only capability.
    if (/^\/recordings(?:\/|$)/.test(req.path)) return next();
    // Live room participants can backfill live feedback, never saved media.
    const liveRoom = hub.find(session.id);
    if (req.path === '/history' && liveRoom && liveRoom.row.status !== 'ended') return next();
    return res.status(403).json({ error: 'Sign in to the account that owns this session' });
  }
  next();
});
const { mountExtras } = await import('./extras.ts');
await mountExtras(app, hub, blobs);
app.use('/api', sessionRoutes(hub));

// Production: serve the built web app.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|ws|models|mediapipe|ort).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
attachWs(server, hub);
await resolveFfmpeg();
server.listen(config.port, () => {
  console.log(`[server] API on http://localhost:${config.port}  (whisper: ${transcriber.status})`);
  console.log(`[server] open http://localhost:${config.webPort}${config.https ? ' (https)' : ''}`);
  for (const u of lanUrls()) console.log(`[server] LAN/tunnel: ${u}`);
});
