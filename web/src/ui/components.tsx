import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FaceState, Nudge, NudgeCategory } from '@shared/types.ts';
import { NUDGE } from '@shared/thresholds.ts';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-symbol" style={{ fontSize: size }} aria-hidden="true">◉</span>
  );
}

export function TopBar({ children, title }: { children?: ReactNode; title?: string }) {
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Link to="/" className="brand" aria-label="Read the Room home">
        <BrandMark />
        <span>Read the Room</span>
      </Link>
      {title && (
        <span className="dim" style={{ fontWeight: 700 }}>
          / {title}
        </span>
      )}
      <span className="spacer" />
      {children}
    </header>
  );
}

/** Shown before any camera turns on. Nothing starts until the user agrees. */
export function ConsentGate({
  kind,
  onAccept,
  children,
}: {
  kind: 'presenter' | 'audience' | 'practice';
  onAccept: () => void;
  children?: ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="dialog">
        <p className="eyebrow">Before the camera turns on</p>
        <h1 id="consent-title" style={{ marginTop: 8 }}>
          {kind === 'audience' ? 'This camera faces the audience' : 'This camera faces you'}
        </h1>
        <ul>
          <li>
            <strong>All video analysis runs in this browser.</strong> Video is never streamed to other devices.
          </li>
          <li>
            <strong>Only anonymous numbers leave this device</strong>, such as head direction, posture angles,
            and loudness.
          </li>
          {kind === 'audience' ? (
            <li>
              <strong>No face recognition or identification.</strong> Faces become anonymous dots with numeric IDs
              that reset every session. The room should be told the camera is on.
            </li>
          ) : (
            <li>
              <strong>Your voice is transcribed</strong> on the session's own server (Whisper) to measure pace and
              filler words.
            </li>
          )}
          <li>
            <strong>Recording is off by default.</strong> It only starts if the operator turns it on, and a red
            REC indicator is shown on every camera.
          </li>
          <li>
            These are <strong>engagement estimates</strong> from head pose and expressions. They are not
            emotion detection or mind reading.
          </li>
        </ul>
        {children}
        <div className="row" style={{ marginTop: 16 }}>
          <button ref={btn} className="btn btn-primary btn-lg" onClick={onAccept}>
            I understand, turn on camera
          </button>
          <Link className="btn btn-ghost" to="/">
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}

export function LiveIndicators({ camera, mic, recording }: { camera: boolean; mic?: boolean; recording: boolean }) {
  return (
    <div className="live-indicators" role="status" aria-live="polite">
      {camera && (
        <span className="ind ind-cam">
          <span className="dot" aria-hidden="true" />
          Camera on{mic ? ' · Mic on' : ''}
        </span>
      )}
      {recording && (
        <span className="ind ind-rec">
          <span className="dot" aria-hidden="true" />
          REC
        </span>
      )}
    </div>
  );
}

export const CATEGORY_LABEL: Record<NudgeCategory, string> = {
  audience: 'Audience',
  delivery: 'Delivery',
  posture: 'Posture',
  praise: 'Nice',
};

const CATEGORY_ICON: Record<NudgeCategory, ReactNode> = {
  audience: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="9" r="3" fill="currentColor" />
      <circle cx="18" cy="9" r="3" fill="currentColor" />
      <circle cx="12" cy="7" r="3" fill="currentColor" />
      <path d="M2 20c0-4 8-4 8 0M14 20c0-4 8-4 8 0M7 18c0-4 10-4 10 0" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  ),
  delivery: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  ),
  posture: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="4" r="2.5" fill="currentColor" />
      <path d="M12 7v9M7 10h10M12 16l-4 6M12 16l4 6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  ),
  praise: (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  ),
};

/** The single, glanceable nudge. Fades after NUDGE.displaySec. */
export function NudgeCard({ nudge, compact = false, idle }: { nudge: Nudge | null; compact?: boolean; idle?: ReactNode }) {
  const [visible, setVisible] = useState<Nudge | null>(null);
  useEffect(() => {
    if (!nudge) return;
    setVisible(nudge);
    const id = window.setTimeout(() => setVisible(null), NUDGE.displaySec * 1000);
    return () => window.clearTimeout(id);
  }, [nudge]);
  return (
    <div aria-live="assertive" aria-atomic="true">
      {visible ? (
        <div
          className="nudge"
          data-cat={visible.category}
          key={visible.id}
          style={compact ? { minHeight: 160, padding: 24 } : undefined}
        >
          <span className="nudge-cat">
            {CATEGORY_ICON[visible.category]} {CATEGORY_LABEL[visible.category]}
          </span>
          <span className="nudge-text" style={compact ? { fontSize: 'clamp(1.6rem, 1rem + 2.5vw, 2.6rem)' } : undefined}>
            {visible.text}
          </span>
          <span className="nudge-why">Why: {visible.why}</span>
          <span className="nudge-timer" style={{ animationDuration: `${NUDGE.displaySec}s` }} aria-hidden="true" />
        </div>
      ) : (
        <div className="nudge-idle" style={compact ? { minHeight: 160 } : undefined}>
          {idle ?? (
          <div>
            <p className="display" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text)' }}>
              All clear
            </p>
            <p>Coaching appears here, one nudge at a time.</p>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

export type Level = 'good' | 'warn' | 'alert' | undefined;
export function Stat({
  label,
  value,
  unit,
  hint,
  level,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  level?: Level;
}) {
  return (
    <div className="stat" data-level={level}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
      {level && <span className="sr-only">{level === 'good' ? 'on target' : level === 'warn' ? 'watch' : 'needs attention'}</span>}
    </div>
  );
}

export function Meter({ value, mark, color, label }: { value: number; mark?: number; color?: string; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%`, background: color }} />
      {mark != null && <span className="mark" style={{ left: `${mark * 100}%` }} />}
    </div>
  );
}

export const STATE_LABEL: Record<FaceState, string> = {
  attentive: 'Attentive',
  down: 'Looking down',
  away: 'Looking away',
  drowsy: 'Eyes closed',
};

/** Non-color cue per state: circle, down-triangle, ring, dash. */
export function StateGlyph({ state, size = 12 }: { state: FaceState; size?: number }) {
  const c = `var(--st-${state})`;
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" aria-hidden="true">
      {state === 'attentive' && <circle cx="6" cy="6" r="5" fill={c} />}
      {state === 'down' && <path d="M1 2h10L6 11z" fill={c} />}
      {state === 'away' && <circle cx="6" cy="6" r="4" fill="none" stroke={c} strokeWidth="2.4" />}
      {state === 'drowsy' && <rect x="1" y="4.5" width="10" height="3" rx="1.5" fill={c} />}
    </svg>
  );
}

export function StateLegend() {
  return (
    <div className="legend" aria-label="Legend">
      {(Object.keys(STATE_LABEL) as FaceState[]).map((s) => (
        <span key={s}>
          <StateGlyph state={s} /> {STATE_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

export function useDevices(kind: 'videoinput' | 'audioinput', refreshKey: unknown) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((d) => setDevices(d.filter((x) => x.kind === kind)))
        .catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, [kind, refreshKey]);
  return devices;
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Toasts({ items }: { items: { id: string; text: string; sub?: string }[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <strong>{t.text}</strong>
          {t.sub && <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}
