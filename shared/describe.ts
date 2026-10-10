// Plain-language description of what the presenter was doing, for spikes and reports.
import type { PresenterSample, SpeechStats } from './types.ts';
import { PRESENTER, SPEECH } from './thresholds.ts';

export function describePresenter(p: PresenterSample | null, s: SpeechStats | null): string {
  if (!p || !p.present) return 'Presenter not in frame';
  const bits: string[] = [];
  if (p.gaze === 'screen') bits.push(`looking at screen${p.screenGazeSec >= 5 ? ` (${Math.round(p.screenGazeSec)}s)` : ''}`);
  else if (p.gaze === 'away') bits.push('turned away from the audience');
  else if (p.gaze === 'audience') bits.push('facing the audience');
  if (!p.speaking && p.silenceSec >= SPEECH.longPauseSec) bits.push(`paused ${Math.round(p.silenceSec)}s`);
  if (p.speaking && p.volumeRel < -6) bits.push(`quiet (${p.volumeRel.toFixed(0)} dB vs baseline)`);
  if (s?.wpm != null && s.wpm > SPEECH.wpmFast) bits.push(`fast pace (${s.wpm} wpm)`);
  if (s?.wpm != null && s.wpm < SPEECH.wpmSlow) bits.push(`slow pace (${s.wpm} wpm)`);
  if (s && s.fillersPerMin > SPEECH.fillersPerMinHigh) bits.push(`${s.fillersPerMin.toFixed(0)} fillers/min`);
  if (p.slouch > PRESENTER.slouch) bits.push('slouching');
  if (p.sway > PRESENTER.swayHigh) bits.push('swaying');
  if (p.pacing > PRESENTER.pacingHigh) bits.push('pacing');
  if (p.fidget > PRESENTER.fidgetHigh) bits.push('fidgeting');
  return bits.length ? bits.join(', ') : 'steady delivery';
}
