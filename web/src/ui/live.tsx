import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DeliveryScore, PresenterSample, SessionInfo, SpeechStats } from '@shared/types.ts';
import { PRESENTER, SPEECH } from '@shared/thresholds.ts';
import type { RoomSocket } from '../lib/socket.ts';
import { Stat, fmtTime, type Level } from './components.tsx';

const lvl = (bad: boolean, warn: boolean): Level => (bad ? 'alert' : warn ? 'warn' : 'good');

const GAZE_LABEL = { audience: 'Audience', screen: 'Screen', away: 'Away', unknown: 'n/a' } as const;

export function PresenterStats({
  sample: s,
  speech,
  score,
}: {
  sample: PresenterSample | null;
  speech: SpeechStats | null;
  score: DeliveryScore | null;
}) {
  if (!s) return <div className="panel empty">Waiting for the presenter camera…</div>;
  if (!s.present) return <div className="panel empty">Presenter not in frame.</div>;
  const postureBad = s.slouch > PRESENTER.slouch || s.shoulderTilt > PRESENTER.tiltDeg || s.forwardHead > PRESENTER.forwardHead;
  const postureWarn = s.slouch > PRESENTER.slouch * 0.6 || s.shoulderTilt > PRESENTER.tiltDeg * 0.6;
  const moveBad = s.sway > PRESENTER.swayHigh || s.fidget > PRESENTER.fidgetHigh || s.pacing > PRESENTER.pacingHigh;
  const wpm = speech?.wpm ?? null;
  return (
    <div className="stats" aria-label="Your live delivery metrics">
      <Stat
        label="Delivery score"
        value={score ? score.score : '—'}
        unit="/100"
        level={score ? lvl(score.score < 50, score.score < 70) : undefined}
      />
      <Stat
        label="Eye contact"
        value={Math.round(s.eyeContact * 100)}
        unit="%"
        hint={`Looking at: ${GAZE_LABEL[s.gaze]}${s.screenGazeSec > 3 ? ` · ${s.screenGazeSec}s` : ''}`}
        level={lvl(s.screenGazeSec > 25, s.eyeContact < 0.5)}
      />
      <Stat
        label="Volume vs baseline"
        value={s.speaking ? `${s.volumeRel > 0 ? '+' : ''}${s.volumeRel.toFixed(0)}` : '—'}
        unit="dB"
        hint={s.speaking ? 'Speaking' : `Silent ${s.silenceSec}s`}
        level={s.speaking ? lvl(s.volumeRel < -6, s.volumeRel < -3) : undefined}
      />
      <Stat
        label="Pace"
        value={wpm ?? '—'}
        unit="wpm"
        hint={speech?.paceSource === 'none' ? 'Needs ~8s of speech' : `via ${speech?.paceSource}`}
        level={wpm == null ? undefined : lvl(wpm > SPEECH.wpmFast || wpm < SPEECH.wpmSlow, wpm > SPEECH.wpmIdealHigh || wpm < SPEECH.wpmIdealLow)}
      />
      <Stat
        label="Fillers"
        value={speech ? speech.fillersPerMin.toFixed(1) : '—'}
        unit="/min"
        hint={speech ? `${speech.fillerTotal} total${speech.lastFiller ? ` · last "${speech.lastFiller}"` : ''}` : undefined}
        level={speech ? lvl(speech.fillersPerMin > SPEECH.fillersPerMinHigh, speech.fillersPerMin > 3) : undefined}
      />
      <Stat
        label="Posture"
        value={postureBad ? 'Check' : 'Good'}
        hint={`slouch ${Math.round(s.slouch * 100)}% · tilt ${s.shoulderTilt.toFixed(0)}° · head ${Math.round(s.forwardHead * 100)}%`}
        level={lvl(postureBad, postureWarn)}
      />
      <Stat
        label="Movement"
        value={moveBad ? 'Busy' : 'Calm'}
        hint={`sway ${s.sway.toFixed(2)} · pace ${s.pacing.toFixed(1)} · hands ${s.fidget.toFixed(2)}`}
        level={lvl(moveBad, s.sway > PRESENTER.swayHigh * 0.6)}
      />
      <Stat label="Expressiveness" value={Math.round(s.expressiveness * 100)} unit="%" hint={`smile ${Math.round(s.smile * 100)}%`} />
    </div>
  );
}

export function useSessionClock(session: SessionInfo | null, socket: RoomSocket | null) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  if (!session?.startedAt || !socket) return 0;
  const end = session.endedAt ?? socket.serverNow();
  return end - session.startedAt;
}

export function SessionControls({
  session,
  socket,
  uploading,
  showRecording = true,
}: {
  session: SessionInfo;
  socket: RoomSocket | null;
  uploading?: boolean;
  showRecording?: boolean;
}) {
  const elapsed = useSessionClock(session, socket);
  const [confirmEnd, setConfirmEnd] = useState(false);
  return (
    <div className="panel row" style={{ justifyContent: 'space-between' }}>
      <div className="row">
        {session.status === 'lobby' && (
          <button className="btn btn-primary btn-lg" onClick={() => socket?.send({ type: 'control', action: 'start' })}>
            Start session
          </button>
        )}
        {session.status === 'live' &&
          (confirmEnd ? (
            <>
              <button className="btn btn-danger btn-lg" onClick={() => socket?.send({ type: 'control', action: 'end' })}>
                Yes, end and build report
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmEnd(false)}>
                Keep going
              </button>
            </>
          ) : (
            <button className="btn btn-danger btn-lg" onClick={() => setConfirmEnd(true)}>
              End session
            </button>
          ))}
        {session.status === 'ended' && (
          <Link className="btn btn-primary btn-lg" to={`/report/${session.id}`}>
            Open report
          </Link>
        )}
        <span className="display num" style={{ fontSize: '1.8rem' }} aria-label="Elapsed time">
          {fmtTime(elapsed)}
        </span>
        <span className={`chip ${session.status === 'live' ? 'chip-alert' : ''}`}>
          <span className="dot" aria-hidden="true" />
          {session.status === 'lobby' ? 'Lobby' : session.status === 'live' ? 'Live' : 'Ended'}
        </span>
        {uploading && <span className="chip chip-warn">Uploading recording…</span>}
      </div>
      {showRecording && session.status !== 'ended' && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={session.recording}
            onChange={(e) => socket?.send({ type: 'control', action: 'recording', value: e.target.checked })}
          />
          <span>
            Record video
            <span className="faint" style={{ display: 'block', fontWeight: 400, fontSize: 'var(--fs-xs)' }}>
              Off by default. Everyone sees REC.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
