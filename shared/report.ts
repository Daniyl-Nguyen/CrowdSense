import type { ReactionCounts, ScoreParts, SessionMode, Spike } from './types.ts';

export interface ReportSummary {
  score: number | null;
  scoreParts: ScoreParts | null;
  attentionAvg: number | null; // 0..1
  attentionMin: number | null;
  peopleAvg: number | null;
  eyeContactPct: number | null; // 0..1
  screenGazeLongestSec: number;
  wpmAvg: number | null;
  fastPct: number; // fraction of paced seconds above the fast threshold
  fillerTotal: number;
  fillersPerMin: number;
  fillerBreakdown: Record<string, number>;
  wordTotal: number;
  volumeRelAvg: number | null;
  quietPct: number;
  longPauses: number;
  posture: { slouchPct: number; tiltPct: number; forwardHeadPct: number; swayPct: number; fidgetPct: number; pacingPct: number };
  presentPct: number;
  reactions: ReactionCounts;
  questions: { t: number; text: string | null }[];
  nudgeCounts: Record<string, number>;
  bestMoment: { t: number; attention: number; transcript: string } | null;
}

export interface ReportSpike extends Spike {
  attentionBefore: number | null;
  attentionAfter: number | null;
}

export interface PastSession {
  id: string;
  title: string;
  date: number;
  mode: SessionMode;
  score: number | null;
  attentionAvg: number | null;
  wpmAvg: number | null;
  fillersPerMin: number | null;
  eyeContactPct: number | null;
}

export interface CoachingTip {
  title: string;
  detail: string;
  evidence?: string; // metric or moment that supports it
  t?: number; // session ms to jump to
}

export interface Coaching {
  provider: 'bedrock' | 'anthropic' | 'template';
  model?: string;
  headline: string;
  strengths: string[];
  improvements: CoachingTip[];
  drill: string;
}

export interface Report {
  version: 1;
  sessionId: string;
  title: string;
  mode: SessionMode;
  startedAt: number | null;
  durationSec: number;
  generatedAt: number;
  summary: ReportSummary;
  timeline: { t: number; attention: number | null; score: number | null }[];
  spikes: ReportSpike[];
  history: PastSession[]; // previous sessions by the same anonymous presenter, newest first
  coaching: Coaching;
  extras?: Record<string, unknown>;
}
