// Post-session report: summary stats, spikes with context, history comparison, AI coaching.
import type { Report, ReportSpike, ReportSummary, PastSession } from '../shared/report.ts';
import type { ScoreParts } from '../shared/types.ts';
import { PRESENTER, SPEECH } from '../shared/thresholds.ts';
import { findFillers } from '../shared/fillers.ts';
import type { Repo, SampleRow } from './db/repo.ts';
import type { BlobStore } from './storage.ts';
import { coach } from './ai/coach.ts';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const frac = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

export async function buildReport(repo: Repo, blobs: BlobStore, sessionId: string, requireAI = false): Promise<Report> {
  const session = await repo.getSession(sessionId);
  if (!session) throw new Error('session not found');
  const [samples, transcript, spikes, reactions, tips] = await Promise.all([
    repo.getSamples(sessionId),
    repo.getTranscript(sessionId),
    repo.getSpikes(sessionId),
    repo.getReactions(sessionId),
    repo.getTips(sessionId),
  ]);
  const durationSec = Math.round(((session.endedAt ?? Date.now()) - (session.startedAt ?? session.createdAt)) / 1000);

  const pres = samples.map((s) => s.presenter).filter((p): p is NonNullable<typeof p> => !!p && p.present);
  const speaking = pres.filter((p) => p.speaking);
  const atts = samples.map((s) => s.audience?.attention).filter((v): v is number => v != null);
  const wpms = samples.map((s) => s.speech.wpm).filter((v): v is number => v != null);
  const scores = samples.map((s) => s.score).filter((v): v is NonNullable<typeof v> => !!v);

  const fillerBreakdown: Record<string, number> = {};
  for (const seg of transcript) for (const f of findFillers(seg.text)) fillerBreakdown[f.word] = (fillerBreakdown[f.word] ?? 0) + 1;
  const fillerTotal = Object.values(fillerBreakdown).reduce((a, b) => a + b, 0);
  const wordTotal = transcript.reduce((a, s) => a + s.words, 0);
  const speakingMin = Math.max(speaking.length, 30) / 60;

  let longPauses = 0;
  for (let i = 1; i < pres.length; i++) if (pres[i].silenceSec === SPEECH.longPauseSec) longPauses++;

  const parts: ScoreParts | null = scores.length
    ? (Object.fromEntries(
        (Object.keys(scores[0].parts) as (keyof ScoreParts)[]).map((k) => [k, r2(avg(scores.map((s) => s.parts[k])))!]),
      ) as unknown as ScoreParts)
    : null;

  const reactionCounts = { lost: 0, fast: 0, love: 0, question: 0 };
  for (const r of reactions) reactionCounts[r.kind]++;
  const nudgeCounts: Record<string, number> = {};
  for (const t of tips.filter((t) => t.origin === 'live')) nudgeCounts[t.kind] = (nudgeCounts[t.kind] ?? 0) + 1;

  const around = (t: number, before = 15_000, after = 5_000) =>
    transcript
      .filter((s) => s.t1 >= t - before && s.t0 <= t + after)
      .map((s) => s.text)
      .join(' ');

  const summary: ReportSummary = {
    score: scores.length ? Math.round(avg(scores.map((s) => s.score))!) : null,
    scoreParts: parts,
    attentionAvg: r2(avg(atts)),
    attentionMin: atts.length ? r2(Math.min(...atts)) : null,
    peopleAvg: r2(avg(samples.map((s) => s.audience?.count).filter((v): v is number => v != null))),
    eyeContactPct: r2(avg(pres.map((p) => p.eyeContact))),
    screenGazeLongestSec: Math.max(0, ...pres.map((p) => p.screenGazeSec)),
    wpmAvg: wpms.length ? Math.round(avg(wpms)!) : null,
    fastPct: r2(frac(wpms.map((w) => w > SPEECH.wpmFast)))!,
    fillerTotal,
    fillersPerMin: Math.round((fillerTotal / speakingMin) * 10) / 10,
    fillerBreakdown,
    wordTotal,
    volumeRelAvg: r2(avg(speaking.map((p) => p.volumeRel))),
    quietPct: r2(frac(speaking.map((p) => p.volumeRel < -6)))!,
    longPauses,
    posture: {
      slouchPct: r2(frac(pres.map((p) => p.slouch > PRESENTER.slouch)))!,
      tiltPct: r2(frac(pres.map((p) => p.shoulderTilt > PRESENTER.tiltDeg)))!,
      forwardHeadPct: r2(frac(pres.map((p) => p.forwardHead > PRESENTER.forwardHead)))!,
      swayPct: r2(frac(pres.map((p) => p.sway > PRESENTER.swayHigh)))!,
      fidgetPct: r2(frac(pres.map((p) => p.fidget > PRESENTER.fidgetHigh)))!,
      pacingPct: r2(frac(pres.map((p) => p.pacing > PRESENTER.pacingHigh)))!,
    },
    presentPct: r2(samples.length ? pres.length / samples.length : 0)!,
    reactions: reactionCounts,
    questions: reactions.filter((r) => r.kind === 'question').map((r) => ({ t: r.t, text: r.text ?? null })),
    nudgeCounts,
    bestMoment: bestMoment(samples, around),
  };

  const attAt = (t0: number, t1: number) => r2(avg(samples.filter((s) => s.t >= t0 && s.t < t1).map((s) => s.audience?.attention).filter((v): v is number => v != null)));
  const reportSpikes: ReportSpike[] = spikes.map((s) => ({
    ...s,
    transcript: s.transcript || around(s.t),
    attentionBefore: attAt(s.t - 15_000, s.t - 3000),
    attentionAfter: attAt(s.t, s.t + 10_000),
  }));

  const history: PastSession[] = (await repo.listSessions(session.presenterId, 12))
    .filter((s) => s.id !== sessionId && s.summary && s.createdAt < session.createdAt)
    .slice(0, 6)
    .map((s) => {
      const r = s.summary as Report;
      return {
        id: s.id,
        title: s.title,
        date: s.startedAt ?? s.createdAt,
        mode: s.mode,
        score: s.score,
        attentionAvg: r.summary?.attentionAvg ?? null,
        wpmAvg: r.summary?.wpmAvg ?? null,
        fillersPerMin: r.summary?.fillersPerMin ?? null,
        eyeContactPct: r.summary?.eyeContactPct ?? null,
      };
    });

  const step = Math.max(1, Math.ceil(samples.length / 400));
  const timeline = samples
    .filter((_, i) => i % step === 0)
    .map((s) => ({ t: s.t, attention: s.audience?.attention ?? null, score: s.score?.score ?? null }));

  const base: Omit<Report, 'coaching'> = {
    version: 1,
    sessionId,
    title: session.title,
    mode: session.mode,
    startedAt: session.startedAt,
    durationSec,
    generatedAt: Date.now(),
    summary,
    timeline,
    spikes: reportSpikes,
    history,
  };
  const coaching = await coach.generate(base, transcript, requireAI);
  const report: Report = { ...base, coaching };

  // System of record: Neon (summary + tips); artifacts: S3 (report + transcript JSON).
  const reportKey = `sessions/${sessionId}/report.json`;
  await Promise.all([
    blobs.put(reportKey, JSON.stringify(report), 'application/json').catch((e) => console.warn('[report] blob put failed', e.message)),
    blobs.put(`sessions/${sessionId}/transcript.json`, JSON.stringify(transcript), 'application/json').catch(() => {}),
  ]);
  await repo.insertTips(sessionId, [
    ...coaching.improvements.map((t) => ({ t: t.t ?? null, kind: 'report', text: t.title, why: t.detail, origin: 'report' as const })),
  ]);
  await repo.upsertSession({ ...session, summary: report, score: summary.score, reportKey });
  return report;
}

function bestMoment(samples: SampleRow[], around: (t: number) => string) {
  const win = 20;
  let best: { t: number; attention: number } | null = null;
  for (let i = win; i < samples.length; i++) {
    const vals = samples
      .slice(i - win, i)
      .map((s) => s.audience?.attention)
      .filter((v): v is number => v != null);
    if (vals.length < win * 0.7) continue;
    const a = vals.reduce((x, y) => x + y, 0) / vals.length;
    if (!best || a > best.attention) best = { t: samples[i - win].t, attention: Math.round(a * 100) / 100 };
  }
  return best ? { ...best, transcript: around(best.t + 10_000) } : null;
}
