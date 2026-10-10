// Attention + delivery score over session time. One shared 0–100 axis, two validated series,
// legend + direct end labels, spike markers, crosshair tooltip, and a table view.
import { useMemo, useRef, useState } from 'react';
import type { Spike } from '@shared/types.ts';
import { fmtTime } from './components.tsx';

export interface TimelinePoint {
  t: number;
  attention: number | null; // 0..1
  score: number | null; // 0..100
}

const H = 220,
  PADL = 40,
  PADR = 64,
  PADT = 16,
  PADB = 28;

export function Timeline({
  points,
  spikes = [],
  windowMs,
  playhead,
  onSeek,
  height = H,
  spanMs,
}: {
  points: TimelinePoint[];
  spikes?: Spike[];
  windowMs?: number; // show only the last N ms (live view)
  playhead?: number;
  onSeek?: (t: number) => void;
  height?: number;
  spanMs?: number; // full length for a finished session
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const W = 800;
  // Live view grows from a 2-minute frame up to `windowMs`, then scrolls.
  const end = spanMs ?? Math.max(points.at(-1)?.t ?? 0, windowMs ? Math.min(windowMs, 120_000) : 60_000);
  const start = windowMs ? Math.max(0, end - windowMs) : 0;
  const vis = points.filter((p) => p.t >= start);
  const x = (t: number) => PADL + ((t - start) / Math.max(1, end - start)) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - v / 100) * (height - PADT - PADB);

  const path = (get: (p: TimelinePoint) => number | null) => {
    let d = '';
    let pen = false;
    for (const p of vis) {
      const v = get(p);
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const att = (p: TimelinePoint) => (p.attention == null ? null : p.attention * 100);
  const sc = (p: TimelinePoint) => p.score;
  const lastAtt = [...vis].reverse().find((p) => p.attention != null);
  const lastSc = [...vis].reverse().find((p) => p.score != null);

  const ticks = useMemo(() => {
    const span = end - start;
    const step = span > 20 * 60_000 ? 300_000 : span > 6 * 60_000 ? 120_000 : span > 2 * 60_000 ? 30_000 : 15_000;
    const out: number[] = [];
    for (let t = Math.ceil(start / step) * step; t <= end; t += step) out.push(t);
    return out;
  }, [start, end]);

  const nearest = (clientX: number) => {
    const svg = ref.current;
    if (!svg || !vis.length) return null;
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const t = start + ((sx - PADL) / (W - PADL - PADR)) * (end - start);
    return { t: Math.max(start, Math.min(end, t)), p: vis.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)) };
  };
  const hp = hover != null ? vis.reduce((a, b) => (Math.abs(b.t - hover) < Math.abs(a.t - hover) ? b : a), vis[0]) : null;
  const visSpikes = spikes.filter((s) => s.t >= start && s.t <= end);

  // Direct end labels, nudged apart if they'd collide.
  let la = lastAtt?.attention != null ? y(lastAtt.attention * 100) : null;
  let ls = lastSc?.score != null ? y(lastSc.score) : null;
  if (la != null && ls != null && Math.abs(la - ls) < 16) {
    const mid = (la + ls) / 2;
    [la, ls] = la < ls ? [mid - 8, mid + 8] : [mid + 8, mid - 8];
  }

  return (
    <div className="timeline">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="legend" aria-hidden={table}>
          <span>
            <svg width="18" height="4" aria-hidden="true">
              <rect width="18" height="3" rx="1.5" fill="var(--chart-1)" />
            </svg>
            Attention (% of room)
          </span>
          <span>
            <svg width="18" height="4" aria-hidden="true">
              <rect width="18" height="3" rx="1.5" fill="var(--chart-2)" />
            </svg>
            Delivery score
          </span>
          {visSpikes.length > 0 && (
            <span>
              <svg width="10" height="10" aria-hidden="true">
                <path d="M0 0h10L5 9z" fill="var(--alert)" />
              </svg>
              Spike (lost moment)
            </span>
          )}
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">Attention and delivery score over time</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Attention</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {vis
                .filter((_, i) => i % 5 === 0)
                .map((p) => (
                  <tr key={p.t}>
                    <td className="num">{fmtTime(p.t)}</td>
                    <td className="num">{p.attention == null ? '—' : `${Math.round(p.attention * 100)}%`}</td>
                    <td className="num">{p.score ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${height}`}
          className="timeline-svg"
          role="img"
          aria-label={`Timeline. Latest attention ${lastAtt?.attention != null ? Math.round(lastAtt.attention * 100) + '%' : 'unknown'}, latest score ${lastSc?.score ?? 'unknown'}. ${visSpikes.length} spikes shown.`}
          onPointerMove={(e) => setHover(nearest(e.clientX)?.p.t ?? null)}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const n = nearest(e.clientX);
            if (n && onSeek) onSeek(n.t);
          }}
          style={{ cursor: onSeek ? 'pointer' : undefined }}
        >
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={PADL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-faint)">
                {v}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--text-faint)">
              {fmtTime(t)}
            </text>
          ))}
          {visSpikes.map((s) => (
            <g key={s.id} className="spike-mark">
              <line x1={x(s.t)} x2={x(s.t)} y1={PADT} y2={height - PADB} stroke="var(--alert)" strokeWidth="1.5" strokeDasharray="3 3" />
              <path d={`M${x(s.t) - 6} ${PADT - 2}h12l-6 9z`} fill="var(--alert)" />
              <title>{`${fmtTime(s.t)}: ${s.text}`}</title>
            </g>
          ))}
          <path d={path(sc)} fill="none" stroke="var(--chart-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(att)} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {la != null && lastAtt && (
            <>
              <circle cx={x(lastAtt.t)} cy={y(lastAtt.attention! * 100)} r="4" fill="var(--chart-1)" stroke="var(--ink-1)" strokeWidth="2" />
              <text x={x(lastAtt.t) + 8} y={la + 4} fontSize="12" fontWeight="700" fill="var(--text)">
                {Math.round(lastAtt.attention! * 100)}%
              </text>
            </>
          )}
          {ls != null && lastSc && (
            <>
              <circle cx={x(lastSc.t)} cy={y(lastSc.score!)} r="4" fill="var(--chart-2)" stroke="var(--ink-1)" strokeWidth="2" />
              <text x={x(lastSc.t) + 8} y={ls + 4} fontSize="12" fontWeight="700" fill="var(--text-dim)">
                {lastSc.score}
              </text>
            </>
          )}
          {playhead != null && playhead >= start && playhead <= end && (
            <line x1={x(playhead)} x2={x(playhead)} y1={PADT} y2={height - PADB} stroke="var(--text)" strokeWidth="2" />
          )}
          {hp && (
            <g pointerEvents="none">
              <line x1={x(hp.t)} x2={x(hp.t)} y1={PADT} y2={height - PADB} stroke="var(--text-faint)" strokeWidth="1" />
              <g transform={`translate(${Math.min(x(hp.t) + 10, W - PADR - 140)}, ${PADT + 4})`}>
                <rect width="140" height="58" rx="8" fill="var(--ink-2)" stroke="var(--line-strong)" />
                <text x="10" y="18" fontSize="12" fill="var(--text-faint)">
                  {fmtTime(hp.t)}
                </text>
                <text x="10" y="35" fontSize="12" fill="var(--text)">
                  Attention {hp.attention == null ? '—' : `${Math.round(hp.attention * 100)}%`}
                </text>
                <text x="10" y="51" fontSize="12" fill="var(--text)">
                  Score {hp.score ?? '—'}
                </text>
              </g>
            </g>
          )}
          {!vis.length && (
            <text x={W / 2} y={height / 2} textAnchor="middle" fill="var(--text-faint)" fontSize="14">
              The timeline starts when the session goes live.
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
