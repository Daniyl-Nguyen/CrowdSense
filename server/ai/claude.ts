// Claude coaching providers: Amazon Bedrock (Mantle client) first, then the Anthropic API.
// Both return schema-validated JSON (structured outputs). If one fails or declines, the coach
// chain in coach.ts moves to the next provider, ending at rule-based templates.
import Anthropic from '@anthropic-ai/sdk';
import type { Coaching, Report } from '../../shared/report.ts';
import type { TranscriptSegment } from '../../shared/types.ts';
import { config } from '../config.ts';
import type { CoachProvider } from './coach.ts';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are an expert public-speaking coach reviewing one presentation from measured data.

You receive JSON with: delivery metrics (eye contact, pace in words per minute, filler words, volume relative to the speaker's own calibrated baseline, posture/movement percentages), audience engagement estimates from head pose (these are estimates, not emotion reading), "lost moments" (sharp attention drops, confusion-like expressions, or audience "Lost me" taps) with what was being said and what the presenter was doing, the presenter's previous sessions, and the transcript.

Write coaching the speaker can act on next time:
- headline: one sentence, with the score and the single biggest lever.
- strengths: 2-3 specific things that worked, citing numbers or moments.
- improvements: the 3-4 highest-impact changes, most important first. Each has a short imperative title, a detail of 1-3 sentences that cites the evidence (numbers, quoted words, timestamps as m:ss), a short evidence label, and t_ms: the session time in milliseconds of the moment it refers to, or -1 if it isn't tied to a moment.
- drill: one concrete practice exercise for the next rehearsal.

Compare with past sessions when that history exists. Be direct and warm. Don't invent metrics that aren't in the data. Call audience signals "engagement" or "attention", never emotions.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'strengths', 'improvements', 'drill'],
  properties: {
    headline: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'evidence', 't_ms'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'string' },
          t_ms: { type: 'integer' },
        },
      },
    },
    drill: { type: 'string' },
  },
};

interface CoachJson {
  headline: string;
  strengths: string[];
  improvements: { title: string; detail: string; evidence: string; t_ms: number }[];
  drill: string;
}

function userContent(report: Omit<Report, 'coaching'>, transcript: TranscriptSegment[]): string {
  const facts = {
    title: report.title,
    mode: report.mode,
    durationSec: report.durationSec,
    summary: report.summary,
    lostMoments: report.spikes.map((s) => ({
      t_ms: s.t,
      kind: s.kind,
      what: s.text,
      saying: s.transcript,
      presenterWas: s.presenter,
      attentionBefore: s.attentionBefore,
      attentionAfter: s.attentionAfter,
    })),
    pastSessions: report.history,
  };
  const lines = transcript.map((s) => `[${Math.floor(s.t0 / 60000)}:${String(Math.floor((s.t0 % 60000) / 1000)).padStart(2, '0')}] ${s.text}`).join('\n');
  return `Session data:\n${JSON.stringify(facts, null, 1)}\n\nTranscript:\n${lines || '(no transcript captured)'}`;
}

function toCoaching(provider: Coaching['provider'], model: string, msg: Anthropic.Beta.BetaMessage): Coaching {
  if (msg.stop_reason === 'refusal') throw new Error(`declined (${msg.stop_details?.category ?? 'unknown'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('response truncated');
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const j = JSON.parse(text) as CoachJson;
  return {
    provider,
    model: msg.model ?? model,
    headline: j.headline,
    strengths: j.strengths.slice(0, 4),
    improvements: j.improvements.slice(0, 5).map((i) => ({ title: i.title, detail: i.detail, evidence: i.evidence || undefined, t: i.t_ms >= 0 ? i.t_ms : undefined })),
    drill: j.drill,
  };
}

/** Claude on Amazon Bedrock via the Mantle (Messages API) client; AWS credentials from env. */
export const bedrockCoach: CoachProvider = {
  name: 'bedrock',
  available: () => config.bedrockEnabled && config.aws.hasCreds,
  async generate(report, transcript) {
    const { AnthropicBedrockMantle } = await import('@anthropic-ai/bedrock-sdk');
    const client = new AnthropicBedrockMantle({ awsRegion: config.aws.region, timeout: 120_000, maxRetries: 1 });
    const model = config.bedrockModel ?? `anthropic.${MODEL}`;
    // Server-side fallbacks aren't available on Bedrock; a decline falls through to the next provider.
    const msg = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent(report, transcript) }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
    return toCoaching('bedrock', model, msg);
  },
};

/** Claude via the Anthropic API (ANTHROPIC_API_KEY). Declines retry server-side on the recommended fallback. */
export const anthropicCoach: CoachProvider = {
  name: 'anthropic',
  available: () => !!config.anthropicKey,
  async generate(report, transcript) {
    const client = new Anthropic({ apiKey: config.anthropicKey, timeout: 120_000, maxRetries: 1 });
    const model = config.anthropicModel;
    const msg = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent(report, transcript) }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    return toCoaching('anthropic', model, msg);
  },
};
