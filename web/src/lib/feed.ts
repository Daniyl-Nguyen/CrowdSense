// Accumulates the live event streams (timeline, nudges, spikes, questions, transcript) for a room.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveTick, Nudge, ReactionKind, ServerMsg, SessionInfo, Spike, TranscriptSegment } from '@shared/types.ts';
import type { TimelinePoint } from '../ui/Timeline.tsx';
import { api } from './api.ts';

export interface Question {
  t: number;
  text: string | null;
}
export interface ReactionEvent {
  id: number;
  kind: ReactionKind;
  t: number;
}

export function useLiveFeed() {
  const [points, setPoints] = useState<TimelinePoint[]>([]);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [spikes, setSpikes] = useState<Spike[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [latestNudge, setLatestNudge] = useState<Nudge | null>(null);
  const [latestSpike, setLatestSpike] = useState<Spike | null>(null);
  const seq = useRef(0);

  const onMsg = useCallback((m: ServerMsg) => {
    switch (m.type) {
      case 'tick':
        if (m.tick.status === 'live') setPoints((p) => [...p.slice(-3600), toPoint(m.tick)]);
        break;
      case 'nudge':
        setLatestNudge(m.nudge);
        setNudges((n) => [m.nudge, ...n].slice(0, 50));
        break;
      case 'spike':
        setSpikes((s) => {
          const i = s.findIndex((x) => x.id === m.spike.id);
          if (i >= 0) return s.map((x) => (x.id === m.spike.id ? m.spike : x));
          setLatestSpike(m.spike);
          return [...s, m.spike];
        });
        break;
      case 'reaction':
        setReactions((r) => [...r.slice(-40), { id: ++seq.current, kind: m.kind, t: m.t }]);
        if (m.kind === 'question') setQuestions((q) => [{ t: m.t, text: m.text ?? null }, ...q].slice(0, 30));
        break;
      case 'transcript':
        setTranscript((t) => [...t.slice(-60), m.segment]);
        break;
    }
  }, []);

  return { points, nudges, spikes, questions, transcript, reactions, latestNudge, latestSpike, onMsg, setPoints, setSpikes, setNudges, setQuestions, setTranscript };
}

const toPoint = (t: LiveTick): TimelinePoint => ({ t: t.t, attention: t.audience?.attention ?? null, score: t.score?.score ?? null });

/** Backfill once when joining a session that is already live. */
export function useBackfill(session: SessionInfo | null, feed: ReturnType<typeof useLiveFeed>) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!session || session.status === 'lobby' || done.current === session.id) return;
    done.current = session.id;
    api
      .get<{ points: TimelinePoint[]; spikes: Spike[]; nudges: { t: number; kind: string; text: string; why: string }[]; transcript: TranscriptSegment[]; questions: Question[] }>(
        `/api/sessions/${session.id}/history`,
      )
      .then((h) => {
        feed.setPoints((p) => [...h.points.filter((x) => !p.length || x.t < p[0].t), ...p]);
        feed.setSpikes((s) => [...h.spikes.filter((x) => !s.some((y) => y.id === x.id)), ...s]);
        feed.setTranscript((t) => [...h.transcript.filter((x) => !t.some((y) => y.id === x.id)), ...t]);
        feed.setQuestions((q) => [...q, ...h.questions.reverse()]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);
}
