import fs from 'node:fs';
import type { ServerConfig } from '../shared/types.ts';
import { lanUrls } from './config.ts';
import { transcriber } from './ai/whisper.ts';

let state = {
  storage: 'local' as ServerConfig['storage'],
  blobs: 'local' as ServerConfig['blobs'],
  coach: 'template' as ServerConfig['coach'],
  ffmpeg: false,
  extras: { gemini: false, tts: false, rekognition: false },
};

export function setStatus(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
}

export function serverConfig(): ServerConfig {
  return { whisper: transcriber.status, lanUrls: lanUrls(), ...state };
}

export function ffmpegPath(): string | null {
  return ffmpegResolved;
}
let ffmpegResolved: string | null = null;
export async function resolveFfmpeg() {
  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default: string | null };
    if (mod.default && fs.existsSync(mod.default)) ffmpegResolved = mod.default;
  } catch {
    /* optional */
  }
  setStatus({ ffmpeg: !!ffmpegResolved });
}
