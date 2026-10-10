// Practice Mode: solo rehearsal with a virtual audience driven by the same scoring engine as live.
// Goals per run, score, personal best, daily streak, and progress across runs. Doubles as demo mode.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Nudge, ServerMsg } from '@shared/types.ts';
import type { Report } from '@shared/report.ts';
import { api, type HistoryRow } from '../lib/api.ts';
import { pref, setPref } from '../lib/ids.ts';
import { useRoom } from '../lib/socket.ts';
import { usePresenterPipeline } from '../vision/usePresenterPipeline.ts';
import { ConsentGate, LiveIndicators, NudgeCard, Stat, TopBar, fmtTime } from '../ui/components.tsx';
import { PresenterStats, SessionControls, useSessionClock } from '../ui/live.tsx';
import { VirtualRoom } from '../ui/VirtualRoom.tsx';
import { useRecorder } from '../rec/useRecorder.ts';

interface Goal {
  id: string;
  label: string;
  live: (v: { wpm: number | null; fpm: number; eye: number | null; room: number | null; score: number | null }) => boolean | null;
  final: (r: Report) => boolean | null;
}

const GOALS: Goal[] = [
  { id: 'score', label: 'Score 80 or higher', live: (v) => (v.score == null ? null : v.score >= 80), final: (r) => (r.summary.score == null ? null : r.summary.score >= 80) },
  { id: 'pace', label: 'Pace between 120 and 160 wpm', live: (v) => (v.wpm == null ? null : v.wpm >= 120 && v.wpm <= 160), final: (r) => (r.summary.wpmAvg == null ? null : r.summary.wpmAvg >= 120 && r.summary.wpmAvg <= 160) },
  { id: 'fillers', label: 'Under 3 filler words per minute', live: (v) => v.fpm < 3, final: (r) => r.summary.fillersPerMin < 3 },
  { id: 'eyes', label: 'Eye contact 70% or more', live: (v) => (v.eye == null ? null : v.eye >= 0.7), final: (r) => (r.summary.eyeContactPct == null ? null : r.summary.eyeContactPct >= 0.7) },
  { id: 'room', label: 'Keep the room 75%+ engaged', live: (v) => (v.room == null ? null : v.room >= 0.75), final: (r) => (r.summary.attentionAvg == null ? null : r.summary.attentionAvg >= 0.75) },
];

export default function Practice() {
  const [params, setParams] = useSearchParams();
  const code = params.get('s')?.toUpperCase() ?? null;
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!code)
      api
        .createSession('practice', 'Practice run')
        .then((s) => setParams({ s: s.code }, { replace: true }))
        .catch((e) => setErr(e.message));
  }, [code, setParams]);
  if (!code) return <div className="shell empty">{err ?? 'Setting up your practice room…'}</div>;
  return <PracticeRoom key={code} code={code} />;
}

function PracticeRoom({ code }: { code: string }) {
  const nav = useNavigate();
  // Consent is remembered for this tab so "Next run" doesn't re-prompt; camera indicators stay on.
  const [consented, setConsentedState] = useState<boolean>(() => sessionStorage.getItem('rtr.consent.practice') === '1');
  const setConsented = (v: boolean) => {
    sessionStorage.setItem('rtr.consent.practice', v ? '1' : '0');
    setConsentedState(v);
  };
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [goalId, setGoalId] = useState<string>(pref('practiceGoal', 'score'));
  const [targetMin, setTargetMin] = useState<number>(pref('practiceTarget', 2));
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const room = useRoom(code, 'presenter-cam', (m: ServerMsg) => {
    if (m.type === 'nudge') setNudge(m.nudge);
  });
  const p = usePresenterPipeline({ socket: room.socket, active: consented, webSpeech: pref('webSpeech', false) });
  const rec = useRecorder(room.socket, room.session, p.stream, 'presenter');
  const elapsed = useSessionClock(room.session, room.socket);
  const s = room.session;
  const tick = room.tick;
  const goal = GOALS.find((g) => g.id === goalId) ?? GOALS[0];
  // Keep the room on screen after the run ends (the server stops simulating it).
  const lastAudience = useRef(tick?.audience ?? null);
  if (tick?.audience) lastAudience.current = tick.audience;
  const roomSample = tick?.audience ?? (s?.status === 'ended' ? lastAudience.current : null);

  useEffect(() => {
    api.history().then(setHistory).catch(() => {});
  }, [s?.status]);

  // When the run ends, wait for the report (score + goal check).
  const reportFor = useRef<string | null>(null);
  useEffect(() => {
    if (s?.status !== 'ended' || reportFor.current === s.id) return;
    reportFor.current = s.id;
    let stop = false;
    const poll = async () => {
      const r = await fetch(`/api/sessions/${s.id}/report`).then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r?.status === 'ready') {
        setReport(r.report);
        api.history().then(setHistory).catch(() => {});
      } else window.setTimeout(poll, 1500);
    };
    poll();
    return () => {
      stop = true;
    };
  }, [s?.status, s?.id]);

  const liveVals = {
    wpm: tick?.speech.wpm ?? null,
    fpm: tick?.speech.fillersPerMin ?? 0,
    eye: tick?.presenter?.present ? tick.presenter.eyeContact : null,
    room: tick?.audience?.attention ?? null,
    score: tick?.score?.score ?? null,
  };
  const liveGoal = s?.status === 'live' ? goal.live(liveVals) : null;
  const practice = useMemo(() => history.filter((h) => h.mode === 'practice' && h.score != null && h.status === 'ended'), [history]);
  const best = practice.reduce<number | null>((a, h) => (a == null || (h.score ?? 0) > a ? h.score : a), null);
  const streak = dayStreak(practice.map((h) => h.startedAt ?? h.createdAt));

  return (
    <div className="shell">
      {!consented && <ConsentGate kind="practice" onAccept={() => setConsented(true)} />}
      <TopBar title="Practice">
        <LiveIndicators camera={p.phase === 'running'} mic={!!p.micRef.current} recording={rec.recording} />
      </TopBar>
      <main id="main" className="practice-layout">
        <section className="stack">
          <div className="panel" style={{ padding: 'var(--sp-3)' }}>
            <VirtualRoom sample={roomSample} speaking={tick?.presenter?.speaking} />
            <div className="row practice-strip">
              <span className="display num" style={{ fontSize: '1.6rem' }}>
                {roomSample?.attention != null ? `${Math.round(roomSample.attention * 100)}%` : '—'}
              </span>
              <span className="dim">of your virtual audience is with you</span>
              <span style={{ flex: 1 }} />
              {s?.status === 'live' && (
                <span className={`chip ${liveGoal == null ? '' : liveGoal ? 'chip-good' : 'chip-warn'}`} aria-live="polite">
                  <span className="dot" aria-hidden="true" />
                  Goal: {goal.label} · {liveGoal == null ? 'measuring' : liveGoal ? 'on track' : 'off track'}
                </span>
              )}
            </div>
            {s?.status === 'live' && (
              <div className="meter" style={{ marginTop: 10 }} aria-label={`Run time ${fmtTime(elapsed)} of ${targetMin} minutes`}>
                <span style={{ width: `${Math.min(100, (elapsed / (targetMin * 60_000)) * 100)}%`, background: elapsed > targetMin * 60_000 ? 'var(--good)' : undefined }} />
              </div>
            )}
          </div>

          {s?.status === 'ended' ? (
            <RunResult report={report} goal={goal} best={best} streak={streak} onNext={() => nav('/practice', { replace: true })} sessionId={s.id} />
          ) : (
            <>
              {s && <SessionControls session={s} socket={room.socket} uploading={rec.uploading} />}
              {s?.status === 'lobby' && (
                <div className="panel stack">
                  <h2>Set up this run</h2>
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <label className="field" style={{ flex: 2, minWidth: 220 }}>
                      Goal
                      <select
                        value={goalId}
                        onChange={(e) => {
                          setGoalId(e.target.value);
                          setPref('practiceGoal', e.target.value);
                        }}
                      >
                        {GOALS.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field" style={{ flex: 1, minWidth: 140 }}>
                      Target length
                      <select
                        value={targetMin}
                        onChange={(e) => {
                          setTargetMin(Number(e.target.value));
                          setPref('practiceTarget', Number(e.target.value));
                        }}
                      >
                        {[1, 2, 3, 5, 10].map((m) => (
                          <option key={m} value={m}>
                            {m} min
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="dim">
                    {p.calib.state === 'done'
                      ? 'Calibrated. Press Start session and present to your virtual room.'
                      : 'Step into frame and talk normally for 15 seconds to calibrate, then press Start session.'}
                  </p>
                </div>
              )}
            </>
          )}
          <PresenterStats sample={p.sample} speech={tick?.speech ?? null} score={tick?.score ?? null} />
        </section>

        <aside className="stack">
          <NudgeCard nudge={nudge} compact />
          <div className="video-wrap" style={{ aspectRatio: '16 / 10' }}>
            <video ref={p.videoRef} className="mirror" playsInline muted aria-label="Your camera preview (mirrored)" />
            {p.phase === 'loading' && <div className="video-msg">Loading vision models…</div>}
            {p.error && <div className="video-msg video-msg-err">{p.error}</div>}
            {p.calib.state === 'running' && <div className="video-msg">Calibrating… {p.calib.remaining}s</div>}
          </div>
          <div className="panel stack">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <h2>Your progress</h2>
            </div>
            <div className="stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <Stat label="Runs" value={practice.length} />
              <Stat label="Best" value={best ?? '—'} />
              <Stat label="Streak" value={streak} unit={streak === 1 ? 'day' : 'days'} />
            </div>
            <ProgressBars runs={practice.slice(0, 10).reverse()} currentId={s?.id} />
          </div>
        </aside>
      </main>
    </div>
  );
}

function RunResult({ report, goal, best, streak, onNext, sessionId }: { report: Report | null; goal: Goal; best: number | null; streak: number; onNext: () => void; sessionId: string }) {
  if (!report)
    return (
      <div className="panel building" role="status">
        <span className="spinner" aria-hidden="true" />
        <div>
          <h2>Scoring your run…</h2>
          <p className="dim">Same engine as a live session.</p>
        </div>
      </div>
    );
  const met = goal.final(report);
  const score = report.summary.score;
  const pb = score != null && best != null && score >= best;
  return (
    <section className="panel run-result" aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">Run complete</p>
          <h2 className="display" style={{ fontSize: '3rem' }}>
            {score ?? '—'}
            <span className="faint" style={{ fontSize: '1rem' }}>
              {' '}
              / 100
            </span>
          </h2>
          <div className="row" style={{ gap: 6 }}>
            <span className={`chip ${met ? 'chip-good' : met === false ? 'chip-warn' : ''}`}>
              {met ? '✓ Goal met' : met === false ? '✗ Goal missed' : 'Goal not measurable'}: {goal.label}
            </span>
            {pb && <span className="chip chip-good">★ Personal best</span>}
            {streak > 0 && <span className="chip">{streak}-day streak</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-primary btn-lg" onClick={onNext} autoFocus>
            Next run
          </button>
          <Link className="btn btn-lg" to={`/report/${sessionId}`}>
            Full report
          </Link>
        </div>
      </div>
      <p className="report-headline" style={{ fontSize: 'var(--fs-md)' }}>
        {report.coaching.headline}
      </p>
      {report.coaching.improvements[0] && (
        <p className="dim">
          <strong style={{ color: 'var(--text)' }}>Next focus: </strong>
          {report.coaching.improvements[0].detail}
        </p>
      )}
    </section>
  );
}

function ProgressBars({ runs, currentId }: { runs: HistoryRow[]; currentId?: string }) {
  if (runs.length < 2) return <p className="empty">Complete two runs to see your trend.</p>;
  const W = 320,
    H = 110,
    gap = 6,
    bw = (W - gap * (runs.length - 1)) / runs.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`Scores of your last ${runs.length} practice runs: ${runs.map((r) => r.score).join(', ')}`} style={{ width: '100%', height: 'auto' }}>
      {runs.map((r, i) => {
        const h = ((r.score ?? 0) / 100) * H;
        const x = i * (bw + gap);
        const cur = r.id === currentId || i === runs.length - 1;
        return (
          <g key={r.id}>
            <path d={`M${x},${H}V${H - h + 4}q0,-4 4,-4h${Math.max(0, bw - 8)}q4,0 4,4V${H}z`} fill={cur ? 'var(--chart-2)' : 'var(--text-faint)'} />
            {(cur || i === 0) && (
              <text x={x + bw / 2} y={H - h - 5} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">
                {r.score}
              </text>
            )}
            <title>{`${new Date(r.createdAt).toLocaleString()}: ${r.score}`}</title>
          </g>
        );
      })}
      <text x="0" y={H + 15} fontSize="10" fill="var(--text-faint)">
        oldest
      </text>
      <text x={W} y={H + 15} fontSize="10" fill="var(--text-faint)" textAnchor="end">
        latest
      </text>
    </svg>
  );
}

/** Consecutive calendar days (ending today or yesterday) with at least one run. */
function dayStreak(times: number[]): number {
  const days = new Set(times.map((t) => new Date(t).toDateString()));
  let d = new Date();
  if (!days.has(d.toDateString())) d = new Date(d.getTime() - 86_400_000);
  let n = 0;
  while (days.has(d.toDateString())) {
    n++;
    d = new Date(d.getTime() - 86_400_000);
  }
  return n;
}
