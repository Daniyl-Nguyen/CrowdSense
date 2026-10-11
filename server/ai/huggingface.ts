// Server-only Hugging Face Inference Providers. Never return the token to clients.
import { config } from '../config.ts';

export async function hfRequest(url: string, body: string | Uint8Array, contentType: string, timeout: number): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.hfToken}`, 'Content-Type': contentType },
    body: typeof body === 'string' ? body : new Uint8Array(body),
    signal: AbortSignal.timeout(timeout),
  });
  // Provider error bodies can contain submitted data; keep them out of logs.
  if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}`);
  return response.json();
}

export async function hostedTranscribe(pcm: Float32Array): Promise<string> {
  // Wrap 16 kHz mono samples in PCM16 WAV for the hosted ASR endpoint.
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i] || 0)) * 32767), 44 + i * 2);
  const model = config.hfAsrModel.split('/').map(encodeURIComponent).join('/');
  const result = await hfRequest(`https://router.huggingface.co/hf-inference/models/${model}`, wav, 'audio/wav', 12000) as { text?: unknown };
  if (typeof result.text !== 'string') throw new Error('Invalid transcription response');
  return result.text.trim();
}
