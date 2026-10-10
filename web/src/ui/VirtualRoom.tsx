// Practice Mode's virtual audience: stylized listeners whose pose shows their engagement state.
// State is never color-only: head pose + props (phone, zZ, ?) + the shared state glyph badge.
import type { AudienceFace, AudienceSample } from '@shared/types.ts';
import { STATE_LABEL, StateGlyph } from './components.tsx';

const W = 900,
  H = 440;
const SHIRTS = ['#4a5a78', '#6b4f6e', '#3f6a64', '#7a5c3c', '#5b5f8a', '#6e4a4a', '#3d5f80', '#6a6a48', '#584a72', '#4a6e52', '#7a4f62', '#4d5d6d'];
const SKIN = ['#e9c7a5', '#c99a72', '#8d5f3e', '#f1d3b8', '#a87452', '#d9ae8a', '#6e4630', '#e2b994', '#b9845c', '#f0cfae', '#94603f', '#cfa07a'];

export function VirtualRoom({ sample, speaking }: { sample: AudienceSample | null; speaking?: boolean }) {
  const faces = [...(sample?.faces ?? [])].sort((a, b) => a.y - b.y); // back rows first (painter's order)
  const att = sample?.attention;
  return (
    <figure className="vroom" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Virtual audience. ${att != null ? `${Math.round(att * 100)}% engaged.` : 'Waiting for you to start.'}`}>
        <defs>
          <radialGradient id="vr-spot" cx="50%" cy="100%" r="80%">
            <stop offset="0" stopColor="var(--spot)" stopOpacity={speaking ? 0.22 : 0.12} />
            <stop offset="1" stopColor="var(--spot)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} rx="22" fill="var(--ink-2)" />
        <rect width={W} height={H} rx="22" fill="url(#vr-spot)" style={{ transition: 'all 600ms' }} />
        {[0.24, 0.5, 0.86].map((y, i) => (
          <rect key={i} x="30" y={y * (H - 60) + 52} width={W - 60} height="14" rx="7" fill="var(--ink-3)" opacity={0.6 + i * 0.15} />
        ))}
        {faces.map((f) => (
          <Listener key={f.id} f={f} />
        ))}
        {!faces.length && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--text-faint)" fontSize="18">
            Your audience takes their seats when you start a run.
          </text>
        )}
      </svg>
      <figcaption className="sr-only">
        {faces.map((f) => `Listener ${f.id}: ${STATE_LABEL[f.state]}${f.confusion ? ', confused' : ''}${f.smile ? ', smiling' : ''}.`).join(' ')}
      </figcaption>
    </figure>
  );
}

function Listener({ f }: { f: AudienceFace }) {
  const scale = 0.7 + f.size * 0.55;
  const x = 60 + f.x * (W - 120);
  const y = 40 + f.y * (H - 110);
  const i = (f.id - 1) % SHIRTS.length;
  const head =
    f.state === 'down'
      ? 'translate(0px, 9px) rotate(0deg)'
      : f.state === 'away'
        ? `translate(${f.id % 2 ? 6 : -6}px, 0px) rotate(${f.id % 2 ? 14 : -14}deg)`
        : f.state === 'drowsy'
          ? 'translate(2px, 6px) rotate(12deg)'
          : 'translate(0px, 0px) rotate(0deg)';
  return (
    <g style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }} className="listener">
      {/* body */}
      <path d="M-30 62 q0 -34 30 -34 q30 0 30 34 z" fill={SHIRTS[i]} />
      {/* head */}
      <g className="lhead" style={{ transform: head }}>
        <circle cy="8" r="20" fill={SKIN[i]} />
        <path d={`M-20 4 q0 -24 20 -24 q20 0 20 24 q-6 -12 -20 -12 q-14 0 -20 12z`} fill="#2a2420" opacity={0.85} />
        {f.state === 'drowsy' ? (
          <>
            <path d="M-11 10 h7 M4 10 h7" stroke="#2a2420" strokeWidth="2.4" strokeLinecap="round" />
            <text x="18" y="-14" fontSize="14" fontWeight="800" fill="var(--text-dim)" className="zz">
              z
            </text>
          </>
        ) : f.state === 'down' ? (
          <path d="M-11 13 q3.5 2 7 0 M4 13 q3.5 2 7 0" stroke="#2a2420" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        ) : (
          <>
            <circle cx="-7" cy="8" r="2.6" fill="#2a2420" className="eye" />
            <circle cx="7" cy="8" r="2.6" fill="#2a2420" className="eye" />
          </>
        )}
        {f.smile ? (
          <path d="M-7 17 q7 7 14 0" stroke="#2a2420" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        ) : f.confusion ? (
          <path d="M-6 19 q3 -3 6 0 q3 3 6 0" stroke="#2a2420" strokeWidth="2" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M-5 18 h10" stroke="#2a2420" strokeWidth="2" strokeLinecap="round" opacity={f.state === 'attentive' ? 1 : 0.6} />
        )}
      </g>
      {f.state === 'down' && (
        <g>
          <rect x="-9" y="36" width="18" height="11" rx="2.5" fill="#101418" stroke="var(--line-strong)" />
          <rect x="-6" y="38.5" width="12" height="6" rx="1" fill="var(--st-attentive)" opacity=".75" className="phone-glow" />
        </g>
      )}
      {f.confusion && (
        <g transform="translate(22,-26)">
          <circle r="11" fill="var(--ink-1)" stroke="var(--line-strong)" />
          <text y="5" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">
            ?
          </text>
        </g>
      )}
      <g transform="translate(-26,-22)">
        <circle r="8" fill="var(--ink-1)" />
        <g transform="translate(-6,-6)">
          <StateGlyph state={f.state} size={12} />
        </g>
      </g>
    </g>
  );
}
