// ElevenLabs text-to-speech for spoken nudges and the post-session debrief.
// Without ELEVENLABS_API_KEY the routes return 404 and the browser uses its own speech synthesis.
import type { Report } from '../../shared/report.ts';
import { config } from '../config.ts';

const cache = new Map<string, Buffer>(); // nudge phrases repeat; don't pay twice

export const ttsAvailable = () => !!config.elevenKey;

export async function synthesize(text: string): Promise<Buffer> {
  const key = text.trim().slice(0, 1200);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenVoice)}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': config.elevenKey!, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: key, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (key.length < 120) cache.set(key, buf);
  return buf;
}

/** A ~45-second spoken debrief written from the report. */
export function debriefScript(r: Report): string {
  const c = r.coaching;
  const parts = [
    `Here's your debrief for ${r.title}.`,
    c.headline,
    c.strengths[0] ? `What worked: ${c.strengths[0]}` : '',
    ...c.improvements.slice(0, 2).map((t, i) => `${i === 0 ? 'First' : 'Next'}, ${t.title.toLowerCase()}. ${t.detail}`),
    `Your drill for next time: ${c.drill}`,
  ];
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ');
}
