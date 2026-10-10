// Synced replay: both recordings + the anonymized room map + transcript + metrics on one clock.
// The clock is virtual (session ms); videos are slaved to it with drift correction, so gaps,
// different start offsets, and missing recordings all just work.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { LiveTick, ReactionKind, Spike, TranscriptSegment } from '@shared/types.ts';
import { api } from '../lib/api.ts';
import { TopBar, fmtTime, StateGlyph } from '../ui/components.tsx';
import { RoomMap } from '../ui/room.tsx';
import { Timeline } from '../ui/Timeline.tsx';

interface ReplayData {
  session: { id: string; title: string; mode: string; startedAt: number | null; endedAt: number | null };
  durationMs: number;
  samples: SampleRow[];
  transcript: TranscriptSegment[];
  spikes: Spike[];
  nudges: { t: number | null; kind: string; text: string; why: string }[];
  reactions: { t: number; kind: ReactionKind; text?: string }[];
  recordings: { id: string; role: 'presenter' | 'audience'; status: string; mime: string; startOffsetMs: number; durationMs: number | null; url: string }[];
  processing: boolean;
}

type SampleRow = Omit<LiveTick, 'status'>;

const GAZE = { audience: 'Audience', screen: 'Screen', away: 'Away', unknown: 'n/a' } as const;

export default function Replay() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(Number(params.get('t') ?? 0) || 0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [audView, setAudView] = useState<'map' | 'video'>('map');
  const vids = useRef<Record<string, HTMLVideoElement | null>>({});
  const tRef = useRef(t);
  tRef.current = t;
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Load (and re-poll while recordings are still being processed).
  useEffect(() => {
    let timer = 0;
    const load = () =>
      api
        .get<ReplayData>(`/api/sessions/${id}/replay`)
        .then((d) => {
          setData(d);
          if (d.processing) timer = window.setTimeout(load, 3000);
        })
        .catch((e) => setError(e.message));
    load();
    return () => window.clearTimeout(timer);
  }, [id]);

  const duration = data?.durationMs ?? 0;
  const recs = data?.recordings ?? [];
  const presenterRec = recs.find((r) => r.role === 'presenter');
  const audienceRec = recs.find((r) => r.role === 'audience');

  /** Put every video where the session clock says it should be. */
  const sync = useCallback(
    (time: number, hard: boolean, isPlaying: boolean) => {
      for (const rec of recs) {
        const v = vids.current[rec.id];
        if (!v || v.readyState < 1) continue;
        const local = (time - rec.startOffsetMs) / 1000;
        const dur = Number.isFinite(v.duration) ? v.duration : (rec.durationMs ?? 0) / 1000;
        const inRange = local >= 0 && local <= dur;
        if (!inRange) {
          if (!v.paused) v.pause();
          continue;
        }
        if (hard || Math.abs(v.currentTime - local) > 0.3) v.currentTime = local;
        v.playbackRate = rate;
        if (isPlaying && v.paused) void v.play().catch(() => {});
        if (!isPlaying && !v.paused) v.pause();
      }
    },
    [recs, rate],
  );

  // Virtual clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = Math.min(duration, tRef.current + (now - last) * rate);
      last = now;
      setT(next);
      sync(next, false, true);
      if (next >= duration) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, duration, sync]);

  useEffect(() => sync(tRef.current, false, playing), [playing, sync]);

  const seek = useCallback(
    (time: number) => {
      const c = Math.max(0, Math.min(duration, time));
      setT(c);
      sync(c, true, playing);
    },
    [duration, sync, playing],
  );

  // Keyboard: space play/pause, ←/→ 5 s, [ / ] previous/next lost moment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.closest('input, select, textarea')) return;
      if (e.key === ' ') {
        if (el?.closest('button, a')) return; // let Space activate the focused control
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') seek(tRef.current + 5000);
      else if (e.key === 'ArrowLeft') seek(tRef.current - 5000);
      else if (e.key === ']' || e.key === '[') {
        const sp = data?.spikes ?? [];
        const target = e.key === ']' ? sp.find((s) => s.t - 8000 > tRef.current + 500) : [...sp].reverse().find((s) => s.t - 8000 < tRef.current - 500);
        if (target) seek(target.t - 8000);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek, data]);

  const sample = useMemo(() => {
    const s = data?.samples ?? [];
    let lo = 0,
      hi = s.length - 1,
      best: SampleRow | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= t) {
        best = s[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }, [data, t]);
  const points = useMemo(() => (data?.samples ?? []).map((s) => ({ t: s.t, attention: s.audience?.attention ?? null, score: s.score?.score ?? null })), [data]);
  const activeSeg = data?.transcript.findLast((s) => s.t0 <= t);
  const activeNudge = data?.nudges.find((n) => n.t != null && t >= n.t && t < n.t + 8000);

  useEffect(() => {
    const el = transcriptRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSeg?.id]);

  if (error)
    return (
      <div className="shell">
        <TopBar title="Replay" />
        <main id="main" className="panel">
          <h1>Replay unavailable</h1>
          <p className="dim">{error}</p>
        </main>
      </div>
    );
  if (!data) return <div className="shell empty">Loading replay…</div>;

  const p = sample?.presenter;
  return (
    <div className="shell shell-wide">
      <TopBar title={`Replay · ${data.session.title}`}>
        <Link className="btn btn-sm" to={`/report/${id}`}>
          Report
        </Link>
      </TopBar>
      <main id="main" className="replay-layout">
        <section className="stack" aria-label="Recordings">
          <div className="replay-stage">
            <VideoPane
              label="Presenter"
              rec={presenterRec}
              refFn={(el) => presenterRec && (vids.current[presenterRec.id] = el)}
              t={t}
              mirror
              onReady={() => sync(tRef.current, true, playing)}
            />
            <div className="replay-pane">
              <div className="row replay-pane-head">
                <strong>Audience</strong>
                <div className="seg" role="tablist" aria-label="Audience view">
                  <button role="tab" aria-selected={audView === 'map'} onClick={() => setAudView('map')}>
                    Room map
                  </button>
                  <button role="tab" aria-selected={audView === 'video'} onClick={() => setAudView('video')} disabled={!audienceRec}>
                    Video
                  </button>
                </div>
              </div>
              {audView === 'map' || !audienceRec ? (
                <RoomMap sample={sample?.audience ?? null} showLegend={false} />
              ) : (
                <VideoPane label="" rec={audienceRec} refFn={(el) => (vids.current[audienceRec.id] = el)} t={t} onReady={() => sync(tRef.current, true, playing)} bare />
              )}
            </div>
          </div>
          {data.processing && (
            <p className="chip chip-warn" role="status">
              Recordings are still uploading or being made seekable. This page refreshes on its own.
            </p>
          )}

          <div className="panel replay-controls">
            <div className="row">
              <button className="btn btn-primary" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pause' : 'Play'} style={{ minWidth: 96 }}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <button className="btn btn-sm" onClick={() => seek(t - 10_000)} aria-label="Back 10 seconds">
                −10s
              </button>
              <button className="btn btn-sm" onClick={() => seek(t + 10_000)} aria-label="Forward 10 seconds">
                +10s
              </button>
              <span className="display num" style={{ fontSize: '1.5rem' }}>
                {fmtTime(t)} <span className="faint">/ {fmtTime(duration)}</span>
              </span>
              <span style={{ flex: 1 }} />
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                Speed
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {[0.75, 1, 1.5, 2].map((r) => (
                    <option key={r} value={r}>
                      {r}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <input
              type="range"
              className="scrubber"
              min={0}
              max={duration}
              step={100}
              value={t}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
              aria-valuetext={fmtTime(t)}
            />
            <Timeline points={points} spikes={data.spikes} playhead={t} onSeek={(x) => seek(x)} height={170} spanMs={duration} />
            <div className="row" style={{ gap: 6 }}>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                Lost moments:
              </span>
              {data.spikes.length === 0 && <span className="faint">none</span>}
              {data.spikes.map((s) => (
                <button key={s.id} className="btn btn-sm spike-chip" onClick={() => seek(s.t - 8000)} title={s.text}>
                  ▼ {fmtTime(s.t)} {s.kind === 'lost-taps' ? 'Lost me' : s.kind === 'confusion' ? 'Confusion' : 'Drift'}
                </button>
              ))}
              <span className="faint" style={{ fontSize: 'var(--fs-xs)', marginLeft: 'auto' }}>
                <span className="kbd">Space</span> play · <span className="kbd">←</span>
                <span className="kbd">→</span> 5s · <span className="kbd">[</span>
                <span className="kbd">]</span> lost moments
              </span>
            </div>
          </div>
        </section>

        <aside className="stack" aria-label="At this moment">
          <div className="panel">
            <div className="panel-head">
              <h2>At {fmtTime(t)}</h2>
            </div>
            <div className="moment-grid">
              <Moment label="Room attention" value={sample?.audience?.attention != null ? `${Math.round(sample.audience.attention * 100)}%` : '—'} />
              <Moment label="Delivery score" value={sample?.score ? `${sample.score.score}` : '—'} />
              <Moment label="Pace" value={sample?.speech.wpm != null ? `${sample.speech.wpm} wpm` : '—'} />
              <Moment label="Looking at" value={p?.present ? GAZE[p.gaze] : '—'} />
              <Moment label="Volume" value={p?.speaking ? `${p.volumeRel > 0 ? '+' : ''}${p.volumeRel.toFixed(0)} dB` : 'silent'} />
              <Moment label="Posture" value={p?.present ? (p.slouch > 0.14 ? 'Slouching' : p.sway > 0.55 ? 'Swaying' : 'Steady') : '—'} />
            </div>
            {sample?.audience && (
              <div className="legend" style={{ marginTop: 12 }}>
                {(['attentive', 'down', 'away', 'drowsy'] as const).map((st) => (
                  <span key={st}>
                    <StateGlyph state={st} /> {sample.audience!.faces.filter((f) => f.state === st).length}
                  </span>
                ))}
              </div>
            )}
            {activeNudge && (
              <div className="replay-nudge" role="status">
                <span className="eyebrow">Live nudge shown</span>
                <strong>{activeNudge.text}</strong>
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  {activeNudge.why}
                </span>
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Transcript</h2>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                click a line to jump
              </span>
            </div>
            <div className="replay-transcript" ref={transcriptRef}>
              {data.transcript.length === 0 && <p className="empty">No transcript for this session.</p>}
              {data.transcript.map((seg) => (
                <button key={seg.id} className="tline" data-active={seg.id === activeSeg?.id} onClick={() => seek(seg.t0)}>
                  <span className="faint num">{fmtTime(seg.t0)}</span>
                  <span>
                    {seg.text}
                    {seg.fillers > 0 && <span className="chip" style={{ marginLeft: 6 }}>{seg.fillers} filler{seg.fillers > 1 ? 's' : ''}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Moment({ label, value }: { label: string; value: string }) {
  return (
    <div className="moment">
      <span className="stat-label">{label}</span>
      <span className="moment-value num">{value}</span>
    </div>
  );
}

function VideoPane({
  label,
  rec,
  refFn,
  t,
  mirror,
  bare,
  onReady,
}: {
  label: string;
  rec?: ReplayData['recordings'][number];
  refFn: (el: HTMLVideoElement | null) => void;
  t: number;
  mirror?: boolean;
  bare?: boolean;
  onReady: () => void;
}) {
  const before = rec && t < rec.startOffsetMs;
  const body = (
    <div className="video-wrap" style={{ aspectRatio: '16 / 9' }}>
      {rec ? (
        <>
          <video
            ref={refFn}
            src={rec.url}
            className={mirror ? 'mirror' : undefined}
            playsInline
            preload="auto"
            aria-label={`${label || 'Audience'} recording`}
            onLoadedMetadata={(e) => {
              // MediaRecorder WebM without cues reports Infinity; force the browser to find the end.
              const v = e.currentTarget;
              if (v.duration === Infinity) {
                v.currentTime = 1e101;
                v.addEventListener('timeupdate', () => onReady(), { once: true });
              } else onReady();
            }}
          />
          {before && <div className="video-msg">Recording starts at {fmtTime(rec.startOffsetMs)}</div>}
        </>
      ) : (
        <div className="video-msg" style={{ inset: 0, display: 'grid', placeItems: 'center' }}>
          No {label.toLowerCase() || 'audience'} recording. Turn on “Record video” during a session to enable replay video.
        </div>
      )}
    </div>
  );
  if (bare) return body;
  return (
    <div className="replay-pane">
      <div className="row replay-pane-head">
        <strong>{label}</strong>
        {rec && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{rec.status}</span>}
      </div>
      {body}
    </div>
  );
}
