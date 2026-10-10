// Room map (anonymous dots, never video) and zone heatmap. Presenter's perspective:
// you stand at the bottom edge looking up the room, so your left is the map's left.
import type { AudienceSample, ZoneStat } from '@shared/types.ts';
import { ZONE_LABEL } from '@shared/audience.ts';
import { STATE_LABEL, StateGlyph, StateLegend } from './components.tsx';

const W = 600,
  H = 360,
  PAD = 28,
  STAGE = 44;

export function RoomMap({ sample, showLegend = true }: { sample: AudienceSample | null; showLegend?: boolean }) {
  const faces = sample?.faces ?? [];
  const fx = (x: number) => PAD + x * (W - PAD * 2);
  const fy = (y: number) => PAD + y * (H - PAD * 2 - STAGE);
  const zoneAtt = (id: string) => sample?.zones.find((z) => z.id === id)?.attention;
  const summary = sample
    ? `${sample.count} people tracked. ${sample.attention != null ? Math.round(sample.attention * 100) : 0}% attentive, ${Math.round(sample.down * 100)}% looking down, ${Math.round(sample.away * 100)}% looking away.`
    : 'No audience data yet.';
  return (
    <figure className="roommap" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Room map. ${summary}`}>
        <rect x={PAD / 2} y={PAD / 2} width={W - PAD} height={H - PAD - STAGE + PAD / 2} rx="18" fill="var(--ink-2)" stroke="var(--line)" />
        {[1, 2].map((i) => (
          <line key={i} x1={PAD + (i * (W - 2 * PAD)) / 3} x2={PAD + (i * (W - 2 * PAD)) / 3} y1={PAD / 2} y2={H - STAGE} stroke="var(--line)" strokeDasharray="3 6" />
        ))}
        <line x1={PAD / 2} x2={W - PAD / 2} y1={fy(0.5)} y2={fy(0.5)} stroke="var(--line)" strokeDasharray="3 6" />
        {faces.map((f) => {
          const x = fx(f.x),
            y = fy(f.y);
          const r = 7 + f.size * 6;
          const c = `var(--st-${f.state})`;
          return (
            <g key={f.id} className="dot" style={{ transform: `translate(${x}px, ${y}px)` }}>
              {f.state === 'attentive' && <circle r={r} fill={c} />}
              {f.state === 'down' && <path d={`M${-r} ${-r * 0.75} h${2 * r} l${-r} ${r * 1.7} z`} fill={c} />}
              {f.state === 'away' && <circle r={r * 0.82} fill="none" stroke={c} strokeWidth="3.5" />}
              {f.state === 'drowsy' && <rect x={-r} y={-r * 0.3} width={2 * r} height={r * 0.6} rx={r * 0.3} fill={c} />}
              {f.confusion && (
                <text y={-r - 4} textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--text)">
                  ?
                </text>
              )}
              <title>{`#${f.id}: ${STATE_LABEL[f.state]}${f.confusion ? ', confusion-like expression' : ''}`}</title>
            </g>
          );
        })}
        {(['back-left', 'back-center', 'back-right', 'front-left', 'front-center', 'front-right'] as const).map((id, i) => {
          const a = zoneAtt(id);
          const col = i % 3,
            row = i < 3 ? 0 : 1;
          return (
            <text key={id} className="zone-label" x={PAD + ((col + 0.5) * (W - 2 * PAD)) / 3} y={row ? fy(0.5) + 18 : PAD + 8} textAnchor="middle" fontSize="13" fill="var(--text-faint)" fontWeight="700">
              {ZONE_LABEL[id]}
              {a != null ? ` · ${Math.round(a * 100)}%` : ''}
            </text>
          );
        })}
        <rect x={W / 2 - 90} y={H - STAGE + 6} width="180" height="30" rx="15" fill="var(--spot)" opacity=".16" />
        <text x={W / 2} y={H - STAGE + 26} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--spot)">
          You (stage)
        </text>
        {!faces.length && (
          <text x={W / 2} y={H / 2 - 20} textAnchor="middle" fill="var(--text-faint)" fontSize="16">
            {sample ? 'No faces in view' : 'Waiting for the audience camera…'}
          </text>
        )}
      </svg>
      {showLegend && (
        <figcaption style={{ marginTop: 8 }}>
          <StateLegend />
          <span className="sr-only">{summary}</span>
        </figcaption>
      )}
    </figure>
  );
}

export function ZoneHeatmap({ zones }: { zones: ZoneStat[] | null }) {
  const order = ['back-left', 'back-center', 'back-right', 'front-left', 'front-center', 'front-right'];
  const list = order.map((id) => zones?.find((z) => z.id === id)).filter(Boolean) as ZoneStat[];
  return (
    <div className="heatmap" role="table" aria-label="Attention by zone">
      {list.length === 0 && <p className="empty">No zones yet.</p>}
      {list.map((z) => {
        const a = z.attention;
        const pct = a == null ? null : Math.round(a * 100);
        const low = a != null && a < 0.5;
        return (
          <div
            key={z.id}
            role="row"
            className="heat-cell"
            data-low={low || undefined}
            style={{
              background: a == null ? 'var(--ink-2)' : `color-mix(in oklab, var(--st-attentive) ${Math.round(15 + a * 60)}%, var(--ink-2))`,
            }}
          >
            <span role="cell" className="heat-label">
              {ZONE_LABEL[z.id]}
            </span>
            <span role="cell" className="heat-value num">
              {pct == null ? '—' : `${pct}%`}
              {low && <span aria-label="low attention"> ⚠</span>}
            </span>
            <span role="cell" className="heat-sub">
              {z.count ? (
                <>
                  {z.count} {z.count === 1 ? 'person' : 'people'}
                  {z.down ? (
                    <>
                      {' · '}
                      <StateGlyph state="down" size={10} /> {z.down}
                    </>
                  ) : null}
                </>
              ) : (
                'empty'
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
