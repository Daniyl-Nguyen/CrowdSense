import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Nudge, ServerMsg, TranscriptSegment } from '@shared/types.ts';
import { NUDGE, PRESENTER, SPEECH } from '@shared/thresholds.ts';
import { useRoom } from '../lib/socket.ts';
import { pref, setPref } from '../lib/ids.ts';
import { usePresenterPipeline } from '../vision/usePresenterPipeline.ts';
import { webSpeechSupported } from '../audio/webspeech.ts';
import { ConsentGate, LiveIndicators, NudgeCard, TopBar, useDevices } from '../ui/components.tsx';
import { PresenterStats, SessionControls } from '../ui/live.tsx';
import { drawPresenterOverlay } from '../vision/draw.ts';
import { useRecorder } from '../rec/useRecorder.ts';

export function PresenterNode({ code }: { code: string }) {
  const [consented, setConsented] = useState(false);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [cameraId, setCameraId] = useState<string | undefined>(pref('presenterCam', undefined));
  const [micId, setMicId] = useState<string | undefined>(pref('presenterMic', undefined));
  const [webSpeech, setWebSpeech] = useState<boolean>(pref('webSpeech', false));
  const [showOverlay, setShowOverlay] = useState(true);
  const room = useRoom(code, 'presenter-cam', (m: ServerMsg) => {
    if (m.type === 'nudge') setNudge(m.nudge);
    if (m.type === 'transcript') setTranscript((t) => [...t.slice(-30), m.segment]);
  });
  const p = usePresenterPipeline({ socket: room.socket, active: consented, cameraId, micId, webSpeech });
  const cams = useDevices('videoinput', p.phase);
  const mics = useDevices('audioinput', p.phase);
  const rec = useRecorder(room.socket, room.session, p.stream, 'presenter');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Whisper unavailable → default the browser speech fallback on.
  useEffect(() => {
    if (room.config && room.config.whisper !== 'ready' && room.config.whisper !== 'loading' && webSpeechSupported())
      setWebSpeech(pref('webSpeech', true));
  }, [room.config]);

  useEffect(() => {
    if (!showOverlay || p.phase !== 'running') return;
    let raf = 0;
    const draw = () => {
      const v = p.videoRef.current,
        c = canvasRef.current,
        a = p.analyzerRef.current;
      if (v && c && a) drawPresenterOverlay(c, v, a.lastDraw);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [showOverlay, p.phase]);

  const s = p.sample;
  const tick = room.tick;
  const last = transcript.at(-1);

  return (
    <div className="shell">
      {!consented && <ConsentGate kind="presenter" onAccept={() => setConsented(true)} />}
      <TopBar title={`Presenter camera · ${code}`}>
        <LiveIndicators camera={p.phase === 'running'} mic={!!p.micRef.current} recording={rec.recording} />
        <Link className="btn btn-sm" to={`/monitor?s=${code}`} target="_blank">
          Open monitor
        </Link>
        <Link className="btn btn-sm" to={`/dashboard?s=${code}`} target="_blank">
          Dashboard
        </Link>
      </TopBar>
      <main id="main" className="presenter-layout">
        <section className="stack" aria-label="Confidence monitor">
          <NudgeCard nudge={nudge} />
          {room.session && <SessionControls session={room.session} socket={room.socket} uploading={rec.uploading} />}
          <PresenterStats sample={s} speech={tick?.speech ?? null} score={tick?.score ?? null} />
          <div className="panel" aria-live="off">
            <div className="panel-head">
              <h2>Transcript</h2>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {room.config?.whisper === 'ready' ? 'Whisper (on your server)' : webSpeech ? 'Browser speech' : 'Off'}
              </span>
            </div>
            <p className="dim" style={{ minHeight: '3em' }}>
              {last ? last.text : p.interim || <span className="faint">Words appear here once the session is live.</span>}
            </p>
          </div>
        </section>

        <aside className="stack" aria-label="Camera and calibration">
          <div className="video-wrap">
            <video ref={p.videoRef} className="mirror" playsInline muted aria-label="Your camera preview (mirrored)" />
            <canvas ref={canvasRef} className="mirror" aria-hidden="true" hidden={!showOverlay} />
            {p.phase === 'loading' && <div className="video-msg">Loading vision models…</div>}
            {p.error && <div className="video-msg video-msg-err">{p.error}</div>}
          </div>
          <Calibration calib={p.calib} onRecalibrate={p.recalibrate} />
          <div className="panel stack">
            <h2 style={{ fontSize: '1rem' }}>Devices</h2>
            <label className="field">
              Camera
              <select
                value={cameraId ?? ''}
                onChange={(e) => {
                  setCameraId(e.target.value || undefined);
                  setPref('presenterCam', e.target.value || undefined);
                }}
              >
                <option value="">Default camera</option>
                {cams.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Microphone
              <select
                value={micId ?? ''}
                onChange={(e) => {
                  setMicId(e.target.value || undefined);
                  setPref('presenterMic', e.target.value || undefined);
                }}
              >
                <option value="">Default microphone</option>
                {mics.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
              Show pose overlay
            </label>
            {webSpeechSupported() && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={webSpeech}
                  onChange={(e) => {
                    setWebSpeech(e.target.checked);
                    setPref('webSpeech', e.target.checked);
                  }}
                />
                <span>
                  Low-latency pace via browser speech
                  <span className="faint" style={{ display: 'block', fontWeight: 400, fontSize: 'var(--fs-xs)' }}>
                    Uses your browser vendor's speech service
                  </span>
                </span>
              </label>
            )}
            <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              Targets: pace {SPEECH.wpmIdealLow}–{SPEECH.wpmIdealHigh} wpm, fewer than {SPEECH.fillersPerMinHigh} fillers/min,
              volume within 6 dB of baseline, screen glances under {NUDGE.hold.screenGaze}s.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Calibration({ calib, onRecalibrate }: { calib: ReturnType<typeof usePresenterPipeline>['calib']; onRecalibrate: () => void }) {
  return (
    <div className="panel" role="status" aria-live="polite">
      <div className="panel-head">
        <h2>Calibration</h2>
        <button className="btn btn-sm" onClick={onRecalibrate}>
          Recalibrate
        </button>
      </div>
      {calib.state === 'waiting' && (
        <p className="dim">Step into frame so your face and shoulders are visible. Calibration starts automatically.</p>
      )}
      {calib.state === 'running' && (
        <div className="stack">
          <p>
            <strong className="display" style={{ fontSize: '2.4rem', color: 'var(--spot-text)' }}>
              {calib.remaining}s
            </strong>{' '}
            Stand tall, look at your audience, and talk normally.
          </p>
          <div className="meter">
            <span style={{ width: `${(1 - calib.remaining / PRESENTER.calibrationSec) * 100}%` }} />
          </div>
        </div>
      )}
      {calib.state === 'done' && (
        <p>
          <span className="chip chip-good">
            <span className="dot" /> Baseline captured
          </span>{' '}
          {calib.warning && <span className="dim">{calib.warning}</span>}
          {!calib.warning && <span className="dim">Everything is now judged against your own baseline.</span>}
        </p>
      )}
      {calib.state === 'failed' && <p style={{ color: 'var(--alert)' }}>{calib.message}</p>}
    </div>
  );
}
