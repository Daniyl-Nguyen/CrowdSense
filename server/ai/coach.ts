// Coaching report generator behind one interface. Providers are tried in order:
// Claude on Amazon Bedrock → Anthropic API → rule-based templates (always works, no keys).
import type { Coaching, CoachingTip, Report } from '../../shared/report.ts';
import type { TranscriptSegment } from '../../shared/types.ts';
import { SPEECH } from '../../shared/thresholds.ts';

export interface CoachProvider {
  name: Coaching['provider'];
  available(): boolean;
  generate(report: Omit<Report, 'coaching'>, transcript: TranscriptSegment[]): Promise<Coaching>;
}

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const pct = (v: number | null | undefined) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);

export const templateCoach: CoachProvider = {
  name: 'template',
  available: () => true,
  async generate(r) {
    const s = r.summary;
    const prev = r.history[0];
    const issues: (CoachingTip & { weight: number })[] = [];
    const strengths: string[] = [];

    if (s.eyeContactPct != null) {
      if (s.eyeContactPct < 0.6)
        issues.push({
          weight: (0.6 - s.eyeContactPct) * 3,
          title: 'Look up from your screen',
          detail: `You faced the audience ${pct(s.eyeContactPct)} of the time, and your longest stretch looking at the screen was ${s.screenGazeLongestSec}s. Glance down, then deliver the line to a person.`,
          evidence: `eye contact ${pct(s.eyeContactPct)}`,
        });
      else if (s.eyeContactPct >= 0.7) strengths.push(`Strong eye contact: you faced the room ${pct(s.eyeContactPct)} of the time.`);
    }
    if (s.fillersPerMin > 4) {
      const top = Object.entries(s.fillerBreakdown).sort((a, b) => b[1] - a[1])[0];
      issues.push({
        weight: (s.fillersPerMin - 4) / 3,
        title: 'Swap fillers for pauses',
        detail: `${s.fillersPerMin} filler words per minute${top ? `, mostly "${top[0]}" (${top[1]}×)` : ''}. A one-beat silence sounds more confident than "um".`,
        evidence: `${s.fillerTotal} fillers total`,
      });
    } else if (s.wordTotal > 50)
      strengths.push(s.fillerTotal === 0 ? 'Clean language: no filler words detected.' : `Clean language: only ${s.fillersPerMin} fillers per minute.`);
    if (s.wpmAvg != null) {
      if (s.wpmAvg > SPEECH.wpmIdealHigh + 5)
        issues.push({
          weight: (s.wpmAvg - SPEECH.wpmIdealHigh) / 20,
          title: 'Slow down to land key points',
          detail: `Average pace was ${s.wpmAvg} wpm, above the ${SPEECH.wpmIdealLow}–${SPEECH.wpmIdealHigh} range, and you were above ${SPEECH.wpmFast} wpm ${pct(s.fastPct)} of the time. Pause after each key sentence.`,
          evidence: `${s.wpmAvg} wpm`,
        });
      else if (s.wpmAvg < SPEECH.wpmIdealLow - 10)
        issues.push({
          weight: (SPEECH.wpmIdealLow - s.wpmAvg) / 25,
          title: 'Add energy to your pace',
          detail: `Average pace was ${s.wpmAvg} wpm. Lift the tempo on transitions and examples, and save the slow delivery for the key line.`,
          evidence: `${s.wpmAvg} wpm`,
        });
      else strengths.push(`Comfortable pace: ${s.wpmAvg} wpm on average.`);
    }
    if (s.quietPct > 0.2)
      issues.push({
        weight: s.quietPct * 2,
        title: 'Project to the back row',
        detail: `You were more than 6 dB below your own baseline ${pct(s.quietPct)} of the time you spoke. Aim your voice at the farthest person.`,
        evidence: `quiet ${pct(s.quietPct)}`,
      });
    const posture = s.posture;
    if (posture.slouchPct > 0.15 || posture.forwardHeadPct > 0.15)
      issues.push({
        weight: Math.max(posture.slouchPct, posture.forwardHeadPct) * 2,
        title: 'Stand tall',
        detail: `You were slouched or leaning your head forward ${pct(Math.max(posture.slouchPct, posture.forwardHeadPct))} of the time, compared to your calibrated posture. Reset your shoulders at every slide change.`,
      });
    if (posture.swayPct > 0.15 || posture.fidgetPct > 0.15)
      issues.push({
        weight: Math.max(posture.swayPct, posture.fidgetPct) * 1.5,
        title: posture.swayPct >= posture.fidgetPct ? 'Plant your feet' : 'Quiet your hands',
        detail:
          posture.swayPct >= posture.fidgetPct
            ? `You swayed side to side ${pct(posture.swayPct)} of the time. Stand hip-width apart and move with purpose, not rhythm.`
            : `Your hands fidgeted ${pct(posture.fidgetPct)} of the time. Rest them at your waist between deliberate gestures.`,
      });
    if (s.attentionAvg != null) {
      if (s.attentionAvg < 0.65)
        issues.push({
          weight: (0.65 - s.attentionAvg) * 3,
          title: 'Re-engage the room more often',
          detail: `Estimated attention averaged ${pct(s.attentionAvg)}. Ask the room something or show a concrete example every 3–4 minutes.`,
          evidence: `attention ${pct(s.attentionAvg)}, low ${pct(s.attentionMin)}`,
        });
      else if (s.attentionAvg >= 0.75) strengths.push(`You held the room: estimated attention averaged ${pct(s.attentionAvg)}.`);
    }
    const worst = [...r.spikes].sort((a, b) => b.severity - a.severity)[0];
    if (worst)
      issues.push({
        weight: 0.8 + worst.severity,
        title: `Rework the moment at ${mmss(worst.t)}`,
        detail: `${worst.text}.${worst.transcript ? ` You were saying: "${worst.transcript.slice(-160)}".` : ''}${worst.presenter ? ` You were ${worst.presenter}.` : ''} Simplify this part, or add an example there.`,
        t: worst.t,
      });
    if (s.bestMoment && s.bestMoment.attention > 0.8)
      strengths.push(`Your best stretch was at ${mmss(s.bestMoment.t)} (${pct(s.bestMoment.attention)} attentive)${s.bestMoment.transcript ? `: "${s.bestMoment.transcript.slice(0, 100)}…"` : ''}. Do more of that.`);
    if (prev?.score != null && s.score != null && s.score > prev.score) strengths.push(`Your score improved from ${prev.score} to ${s.score} since last time.`);
    if (!strengths.length) strengths.push('You finished the session, and your baseline is set, so next time is measured against today.');

    issues.sort((a, b) => b.weight - a.weight);
    const top = issues.slice(0, 4).map(({ weight: _w, ...t }) => t);
    const delta = prev?.score != null && s.score != null ? s.score - prev.score : null;
    const headline =
      s.score == null
        ? 'Session recorded. Not enough presenter data for a score.'
        : `Delivery score ${s.score}${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta} vs last time)` : ''}. ${top[0] ? `Biggest lever: ${top[0].title.toLowerCase()}.` : 'Solid run all round.'}`;
    const drills: Record<string, string> = {
      'Swap fillers for pauses': 'Record a 60-second explanation of your main point. Every time you feel an "um" coming, close your mouth and count one beat. Repeat until the run has zero fillers.',
      'Look up from your screen': 'Practice mode: deliver one slide while holding eye contact for a full sentence before glancing down. Goal: no screen glance longer than 5 seconds.',
      'Slow down to land key points': 'Read your opening at 120 wpm with a two-beat pause after each sentence. Then run it in Practice Mode and keep the pace tile green.',
      'Project to the back row': 'Stand 5 m from your phone and record your opening. Play it back: if you strain to hear it, so does the back row.',
    };
    return { provider: 'template', headline, strengths: strengths.slice(0, 3), improvements: top, drill: (top[0] && drills[top[0].title]) ?? 'Run a 2-minute Practice Mode session focusing on the first improvement above, then compare scores.' };
  },
};

const providers: CoachProvider[] = [];

export function registerCoach(p: CoachProvider) {
  providers.push(p);
}

export const coach = {
  activeName(): Coaching['provider'] {
    return providers.find((p) => p.available())?.name ?? 'template';
  },
  async generate(report: Omit<Report, 'coaching'>, transcript: TranscriptSegment[], requireAI = false): Promise<Coaching> {
    let attempted = false;
    let providerError = '';
    for (const p of providers) {
      if (!p.available()) continue;
      attempted = true;
      try {
        return await p.generate(report, transcript);
      } catch (e) {
        if ((e as Error).name === 'TimeoutError') providerError = 'AI coaching timed out after 90 seconds. Please retry; your previous report is unchanged.';
        if ((e as Error).message.startsWith('AI coaching')) providerError = (e as Error).message;
        console.warn(`[coach] ${p.name} failed (${(e as Error).message}); trying next provider`);
      }
    }
    if (requireAI) throw new Error(providerError || (attempted ? 'AI coaching is unavailable right now. Your previous report is unchanged; try again later.' : 'No AI coaching provider is configured. Your previous report is unchanged.'));
    return templateCoach.generate(report, transcript);
  },
};
