// Downloads MediaPipe model files into .cache/models so the app works offline after install.
// Safe to fail: the server falls back to redirecting to Google's CDN.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('.cache/models');
fs.mkdirSync(dir, { recursive: true });
const models = {
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
for (const [name, url] of Object.entries(models)) {
  const file = path.join(dir, name);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`[models] fetched ${name}`);
  } catch (e) {
    console.warn(`[models] could not fetch ${name} (${e.message}); will use CDN at runtime`);
  }
}
