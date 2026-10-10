import 'dotenv/config';
import os from 'node:os';

const env = (k: string) => (process.env[k] ?? '').trim() || undefined;

export const config = {
  port: Number(env('PORT') ?? 8787),
  webPort: Number(env('WEB_PORT') ?? 5173),
  https: env('HTTPS') === '1',
  publicUrl: env('PUBLIC_URL'), // e.g. a cloudflared tunnel URL; used for QR codes
  demoSpeed: env('NUDGE_SPEED') === 'demo',
  dataDir: env('DATA_DIR') ?? '.data',

  neonUrl: env('NEON_DATABASE_URL') ?? env('DATABASE_URL'),

  aws: {
    region: env('AWS_REGION') ?? 'us-east-1',
    hasCreds: !!(env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY')) || !!env('AWS_PROFILE'),
  },
  s3Bucket: env('S3_BUCKET'),
  bedrockModel: env('BEDROCK_MODEL_ID'),
  bedrockEnabled: env('BEDROCK_ENABLED') !== '0',

  anthropicKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL') ?? 'claude-opus-5-5',

  whisperEnabled: env('WHISPER_ENABLED') !== '0',
  whisperModel: env('WHISPER_MODEL') ?? 'onnx-community/whisper-base.en',

  geminiKey: env('GEMINI_API_KEY'),
  elevenKey: env('ELEVENLABS_API_KEY'),
  elevenVoice: env('ELEVENLABS_VOICE_ID') ?? 'JBFqnCBsd6RMkjVDRZzb',
};

export function lanUrls(): string[] {
  const proto = config.https ? 'https' : 'http';
  const urls: string[] = [];
  if (config.publicUrl) urls.push(config.publicUrl.replace(/\/$/, ''));
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? [])
      if (i.family === 'IPv4' && !i.internal) urls.push(`${proto}://${i.address}:${config.webPort}`);
  return urls;
}
