import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Report as ReportT, PastSession } from '@shared/report.ts';
import { SPEECH } from '@shared/thresholds.ts';
import { SCORE_WEIGHTS } from '@shared/scoring.ts';
import type { ScoreParts } from '@shared/types.ts';
import { api } from '../lib/api.ts';
import { Stat, TopBar, fmtTime, type Level } from '../ui/components.tsx';
import { Timeline } from '../ui/Timeline.tsx';
import { REACTIONS } from '../ui/reactions.tsx';

const PROVIDER_LABEL = { bedrock: 'Claude on Amazon Bedrock', anthropic: 'Claude (Anthropic API)', template: 'Rule-based coach (no AI key set)' };
const pct = (v: number | null | undefined) => (v == null ? '—' : Math.round(v * 100));
const lvl = (bad: boolean, warn: boolean): Level => (bad ? 'alert' : warn ? 'warn' : 'good');

export default function Report() {
  const { id = '' } = useParams();
  const [report, setReport] = useState<ReportT | null>(null);
  const [status, setStatus] = useState<'loading' | 'building' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [regen, setRegen] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    let tries = 0;
    const poll = async () => {
      try {
        const r = await fetch(`/api/sessions/${id}/report`);
        // Server restarting / proxy hiccup: retry rather than fail.
        if (r.status >= 500 && ++tries < 15) {
          timer = window.setTimeout(poll, 2000);
          return;
        }
        const body = await r.json();
        if (stop) return;
        if (body.status === 'ready') {
          setReport(body.report);
          setStatus('ready');
          return;
        }
        if (r.status === 202) {
          setStatus('building');
          timer = window.setTimeout(poll, 2000);
          return;
        }
        setError(body.error ?? 'Report unavailable');
        setStatus('error');
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
      }
    };
    poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  if (status !== 'ready' || !report)
    return (
      <div className="shell">
        <TopBar title="Report" />
        <main id="main" className="panel" role="status" aria-live="polite">
          {status === 'error' ? (
            <>
              <h1>Report not available</h1>
              <p className="dim" style={{ margin: '12px 0' }}>
                {error}
              </p>
              <Link className="btn" to="/">
                Home
              </Link>
            </>
          ) : (
            <div className="building">
              <span className="spinner" aria-hidden="true" />
              <div>
                <h1>Writing your report…</h1>
                <p className="dim">Crunching metrics, matching lost moments to the transcript, and asking the coach for tips.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    );

  const r = report;
  const s = r.summary;
  const prev = r.history[0];
  const delta = prev?.score != null && s.score != null ? s.score - prev.score : null;
  const fillerTop = Object.entries(s.fillerBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="shell">
      <TopBar title="Report">
        <Link className="btn btn-sm btn-primary" to={`/replay/${r.sessionId}`}>
          Synced replay
        </Link>
        <Link className="btn btn-sm" to="/practice">
          Practice again
        </Link>
      </TopBar>
      <main id="main" className="stack report">
        <section className="report-hero panel">
          <div>
            <p className="eyebrow">
              {r.mode === 'practice' ? 'Practice run' : 'Live session'} ·{' '}
              {r.startedAt ? new Date(r.startedAt).toLocaleString() : ''} · {fmtTime(r.durationSec * 1000)}
            </p>
            <h1 style={{ marginTop: 8 }}>{r.title}</h1>
            <p className="report-headline">{r.coaching.headline}</p>
          </div>
          <div className="score-hero" aria-label={`Delivery score ${s.score ?? 'not available'} out of 100`}>
            <ScoreRing value={s.score} />
            {delta != null && (
              <span className={`chip ${delta >= 0 ? 'chip-good' : 'chip-alert'}`}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs last session
              </span>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="coach-h">
          <div className="panel-head">
            <h2 id="coach-h">Coaching</h2>
            <span className="row" style={{ gap: 8 }}>
              <span className="chip">{PROVIDER_LABEL[r.coaching.provider]}</span>
              <button
                className="btn btn-sm"
                disabled={regen}
                onClick={async () => {
                  setRegen(true);
                  try {
                    const res = await api.post<{ report: ReportT }>(`/api/sessions/${r.sessionId}/report/regenerate`, {});
                    setReport(res.report);
                  } finally {
                    setRegen(false);
                  }
                }}
              >
                {regen ? 'Regenerating…' : 'Regenerate'}
              </button>
            </span>
          </div>
          <div className="coach-grid">
            <div className="stack">
              <h3>Work on</h3>
              <ol className="tips">
                {r.coaching.improvements.map((t, i) => (
                  <li key={i}>
                    <strong>{t.title}</strong>
                    <p className="dim">{t.detail}</p>
                    <div className="row" style={{ gap: 8 }}>
                      {t.evidence && <span className="chip">{t.evidence}</span>}
                      {t.t != null && (
                        <Link className="btn btn-sm" to={`/replay/${r.sessionId}?t=${Math.max(0, t.t - 8000)}`}>
                          Watch {fmtTime(t.t)}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="stack">
              <h3>Keep doing</h3>
              <ul className="checklist">
                {r.coaching.strengths.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <div className="drill">
                <p className="eyebrow">Drill for next time</p>
                <p>{r.coaching.drill}</p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="stats-h">
          <h2 id="stats-h" className="sr-only">
            Key metrics
          </h2>
          <div className="stats">
            <Stat label="Room attention (avg)" value={pct(s.attentionAvg)} unit="%" hint={s.attentionMin != null ? `low ${pct(s.attentionMin)}% · ~${Math.round(s.peopleAvg ?? 0)} people` : 'no audience feed'} level={s.attentionAvg == null ? undefined : lvl(s.attentionAvg < 0.55, s.attentionAvg < 0.7)} />
            <Stat label="Eye contact" value={pct(s.eyeContactPct)} unit="%" hint={`longest screen stare ${s.screenGazeLongestSec}s`} level={s.eyeContactPct == null ? undefined : lvl(s.eyeContactPct < 0.5, s.eyeContactPct < 0.7)} />
            <Stat label="Pace (avg)" value={s.wpmAvg ?? '—'} unit="wpm" hint={`fast ${pct(s.fastPct)}% of the time`} level={s.wpmAvg == null ? undefined : lvl(s.wpmAvg > SPEECH.wpmFast || s.wpmAvg < SPEECH.wpmSlow, s.wpmAvg > SPEECH.wpmIdealHigh || s.wpmAvg < SPEECH.wpmIdealLow)} />
            <Stat label="Fillers" value={s.fillersPerMin} unit="/min" hint={fillerTop.length ? fillerTop.map(([w, n]) => `${w} ×${n}`).join(' · ') : `${s.fillerTotal} total`} level={lvl(s.fillersPerMin > SPEECH.fillersPerMinHigh, s.fillersPerMin > 3)} />
            <Stat label="Volume vs baseline" value={s.volumeRelAvg == null ? '—' : `${s.volumeRelAvg > 0 ? '+' : ''}${s.volumeRelAvg.toFixed(1)}`} unit="dB" hint={`quiet ${pct(s.quietPct)}% of speech`} level={lvl(s.quietPct > 0.3, s.quietPct > 0.15)} />
            <Stat label="Posture" value={`${pct(Math.max(s.posture.slouchPct, s.posture.forwardHeadPct, s.posture.tiltPct))}`} unit="% off" hint={`slouch ${pct(s.posture.slouchPct)}% · head ${pct(s.posture.forwardHeadPct)}% · tilt ${pct(s.posture.tiltPct)}%`} level={lvl(s.posture.slouchPct > 0.3, s.posture.slouchPct > 0.15)} />
            <Stat label="Movement" value={`${pct(Math.max(s.posture.swayPct, s.posture.fidgetPct, s.posture.pacingPct))}`} unit="% busy" hint={`sway ${pct(s.posture.swayPct)}% · hands ${pct(s.posture.fidgetPct)}% · pacing ${pct(s.posture.pacingPct)}%`} />
            <Stat label="Long pauses" value={s.longPauses} hint={`${s.wordTotal} words spoken`} />
          </div>
        </section>

        <section className="panel" aria-labelledby="tl-h">
          <div className="panel-head">
            <h2 id="tl-h">The session, second by second</h2>
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              Click to open the replay at that moment
            </span>
          </div>
          <TimelineLink report={r} />
        </section>

        <div className="report-grid">
          <section className="panel" aria-labelledby="spikes-h">
            <div className="panel-head">
              <h2 id="spikes-h">Lost moments</h2>
              <span className="faint">{r.spikes.length}</span>
            </div>
            {r.spikes.length === 0 ? (
              <p className="empty">No lost moments detected. Nice.</p>
            ) : (
              <ul className="spike-list">
                {r.spikes.map((sp) => (
                  <li key={sp.id} className="spike-card">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>
                        <span className="num">{fmtTime(sp.t)}</span> · {sp.text}
                      </strong>
                      <Link className="btn btn-sm" to={`/replay/${r.sessionId}?t=${Math.max(0, sp.t - 8000)}`}>
                        Replay
                      </Link>
                    </div>
                    {sp.attentionBefore != null && sp.attentionAfter != null && (
                      <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                        Attention {pct(sp.attentionBefore)}% → {pct(sp.attentionAfter)}%
                      </p>
                    )}
                    {sp.transcript && <blockquote>“{sp.transcript.slice(-240)}”</blockquote>}
                    {sp.presenter && <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>You were: {sp.presenter}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="hist-h">
            <div className="panel-head">
              <h2 id="hist-h">Compared with your past sessions</h2>
            </div>
            <History current={r} />
          </section>

          <section className="panel" aria-labelledby="parts-h">
            <div className="panel-head">
              <h2 id="parts-h">Score breakdown</h2>
            </div>
            {s.scoreParts ? <Parts parts={s.scoreParts} /> : <p className="empty">No presenter data.</p>}
          </section>

          <section className="panel" aria-labelledby="aud-h">
            <div className="panel-head">
              <h2 id="aud-h">From the audience</h2>
            </div>
            <div className="react-counts">
              {(Object.keys(REACTIONS) as (keyof typeof REACTIONS)[]).map((k) => (
                <div key={k} className="react-count" data-kind={k}>
                  <span aria-hidden="true">{REACTIONS[k].icon}</span>
                  <span className="num display">{s.reactions[k]}</span>
                  <span className="faint">{REACTIONS[k].label}</span>
                </div>
              ))}
            </div>
            {s.questions.some((q) => q.text) && (
              <>
                <h3 style={{ margin: '16px 0 8px' }}>Questions</h3>
                <ul className="feed">
                  {s.questions
                    .filter((q) => q.text)
                    .map((q, i) => (
                      <li key={i}>
                        <span className="faint num">{fmtTime(q.t)}</span> {q.text}
                      </li>
                    ))}
                </ul>
              </>
            )}
            {Object.keys(s.nudgeCounts).length > 0 && (
              <>
                <h3 style={{ margin: '16px 0 8px' }}>Live nudges you got</h3>
                <div className="row" style={{ gap: 6 }}>
                  {Object.entries(s.nudgeCounts).map(([k, n]) => (
                    <span key={k} className="chip">
                      {k} ×{n}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
        <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          Attention and expression values are engagement estimates from head pose and facial movement. They are not emotion
          detection, and they get less reliable at distance and in low light.
        </p>
      </main>
    </div>
  );
}

function TimelineLink({ report }: { report: ReportT }) {
  const nav = useNavigate();
  return <Timeline points={report.timeline} spikes={report.spikes} onSeek={(t) => nav(`/replay/${report.sessionId}?t=${Math.round(t)}`)} />;
}

function ScoreRing({ value }: { value: number | null }) {
  const R = 52,
    C = 2 * Math.PI * R;
  const v = value ?? 0;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
      <circle cx="70" cy="70" r={R} fill="none" stroke="var(--ink-3)" strokeWidth="12" />
      <circle
        cx="70"
        cy="70"
        r={R}
        fill="none"
        stroke="var(--spot)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(v / 100) * C} ${C}`}
        transform="rotate(-90 70 70)"
        className="ring-arc"
      />
      <text x="70" y="78" textAnchor="middle" fontSize="40" fontWeight="800" fill="var(--text)" fontFamily="var(--font-display)">
        {value ?? '—'}
      </text>
      <text x="70" y="100" textAnchor="middle" fontSize="12" fill="var(--text-faint)">
        / 100
      </text>
    </svg>
  );
}

const PART_LABEL: Record<keyof ScoreParts, string> = {
  eyeContact: 'Eye contact',
  pace: 'Pace',
  fillers: 'Fillers',
  volume: 'Volume',
  posture: 'Posture',
  movement: 'Movement',
};

function Parts({ parts }: { parts: ScoreParts }) {
  return (
    <ul className="parts">
      {(Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]).map((k) => {
        const earned = Math.round(parts[k] * SCORE_WEIGHTS[k]);
        return (
          <li key={k}>
            <span>{PART_LABEL[k]}</span>
            <div className="meter" role="meter" aria-label={`${PART_LABEL[k]} ${earned} of ${SCORE_WEIGHTS[k]}`} aria-valuenow={earned} aria-valuemin={0} aria-valuemax={SCORE_WEIGHTS[k]}>
              <span style={{ width: `${parts[k] * 100}%` }} />
            </div>
            <span className="num faint">
              {earned}/{SCORE_WEIGHTS[k]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Score across sessions: one series, current bar highlighted, plus a metric table with deltas. */
function History({ current }: { current: ReportT }) {
  const rows: (PastSession & { current?: boolean })[] = [
    ...[...current.history].reverse(),
    {
      id: current.sessionId,
      title: current.title,
      date: current.startedAt ?? current.generatedAt,
      mode: current.mode,
      score: current.summary.score,
      attentionAvg: current.summary.attentionAvg,
      wpmAvg: current.summary.wpmAvg,
      fillersPerMin: current.summary.fillersPerMin,
      eyeContactPct: current.summary.eyeContactPct,
      current: true,
    },
  ];
  if (rows.length < 2) return <p className="empty">This is your first session in this browser. Your next one will be compared against it.</p>;
  const prev = rows[rows.length - 2];
  const cur = rows[rows.length - 1];
  const W = 420,
    H = 150,
    bw = Math.min(44, (W - 20) / rows.length - 8);
  const d = (a: number | null, b: number | null, scale = 1, digits = 0, better: 'up' | 'down' = 'up') => {
    if (a == null || b == null) return null;
    const v = (a - b) * scale;
    const good = better === 'up' ? v >= 0 : v <= 0;
    return (
      <span style={{ color: Math.abs(v) < 0.5 ? 'var(--text-faint)' : good ? 'var(--good)' : 'var(--alert)' }}>
        {v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(digits)}
      </span>
    );
  };
  return (
    <div className="stack">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Delivery score over your last ${rows.length} sessions`} style={{ width: '100%', height: 'auto' }}>
        <line x1="0" x2={W} y1={H - 22} y2={H - 22} stroke="var(--chart-grid)" />
        {rows.map((row, i) => {
          const x = 10 + i * ((W - 20) / rows.length) + ((W - 20) / rows.length - bw) / 2;
          const h = ((row.score ?? 0) / 100) * (H - 40);
          const y = H - 22 - h;
          return (
            <g key={row.id}>
              <path d={`M${x},${H - 22}V${y + 4}q0,-4 4,-4h${bw - 8}q4,0 4,4V${H - 22}z`} fill={row.current ? 'var(--chart-2)' : 'var(--text-faint)'} />
              {(row.current || row === prev) && (
                <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">
                  {row.score ?? '—'}
                </text>
              )}
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-faint)">
                {row.current ? 'Now' : new Date(row.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
              <title>{`${row.title}: score ${row.score ?? '—'}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">This session compared with the previous one</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Last time</th>
              <th scope="col">Now</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Score</th>
              <td className="num">{prev.score ?? '—'}</td>
              <td className="num">{cur.score ?? '—'}</td>
              <td className="num">{d(cur.score, prev.score)}</td>
            </tr>
            <tr>
              <th scope="row">Attention</th>
              <td className="num">{pct(prev.attentionAvg)}%</td>
              <td className="num">{pct(cur.attentionAvg)}%</td>
              <td className="num">{d(cur.attentionAvg, prev.attentionAvg, 100)}</td>
            </tr>
            <tr>
              <th scope="row">Eye contact</th>
              <td className="num">{pct(prev.eyeContactPct)}%</td>
              <td className="num">{pct(cur.eyeContactPct)}%</td>
              <td className="num">{d(cur.eyeContactPct, prev.eyeContactPct, 100)}</td>
            </tr>
            <tr>
              <th scope="row">Pace (wpm)</th>
              <td className="num">{prev.wpmAvg ?? '—'}</td>
              <td className="num">{cur.wpmAvg ?? '—'}</td>
              <td className="num">{d(cur.wpmAvg, prev.wpmAvg, 1, 0, 'down')}</td>
            </tr>
            <tr>
              <th scope="row">Fillers/min</th>
              <td className="num">{prev.fillersPerMin ?? '—'}</td>
              <td className="num">{cur.fillersPerMin ?? '—'}</td>
              <td className="num">{d(cur.fillersPerMin, prev.fillersPerMin, 1, 1, 'down')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
