import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AudienceSample } from '@shared/types.ts';
import { VirtualAudience } from '@shared/virtualAudience.ts';
import { useRoom } from '../lib/socket.ts';
import { pref, setPref } from '../lib/ids.ts';
import { createFaceLandmarker, type FaceLandmarker } from '../vision/mediapipe.ts';
import { YuNet } from '../vision/yunet.ts';
import { AudienceAnalyzer, GRIDS, type Grid, type TrackBox } from '../vision/audience.ts';
import { drawAudienceOverlay } from '../vision/draw.ts';
import { ConsentGate, LiveIndicators, Stat, TopBar, useDevices } from '../ui/components.tsx';
import { RoomMap, ZoneHeatmap } from '../ui/room.tsx';
import { useRecorder } from '../rec/useRecorder.ts';

type Source = { kind: 'camera'; deviceId?: string } | { kind: 'file'; url: string; name: string } | { kind: 'demo' } | { kind: 'simulated' };

const DEMO_URL = '/demo/audience-loop.mp4';

let models: Promise<[YuNet, FaceLandmarker]> | null = null;
const loadModels = () =>
  (models ??= Promise.all([YuNet.create(), createFaceLandmarker({ numFaces: 1, mode: 'IMAGE' })]).catch((e) => {
    models = null;
    throw e;
  }));

export function AudienceNode({ code }: { code: string }) {
  const [consented, setConsented] = useState(false);
  const [source, setSource] = useState<Source>({ kind: 'camera', deviceId: pref('audienceCam', undefined) });
  const [grid, setGrid] = useState<Grid>(() => {
    const g = pref<string>('audienceGrid', '1x1');
    return (GRIDS.some((x) => x.id === g) ? g : '1x1') as Grid;
  });
  const [flip, setFlip] = useState<boolean>(pref('audienceFlip', false));
  const [blur, setBlur] = useState(true);
  const [hideVideo, setHideVideo] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<AudienceSample | null>(null);
  const [fps, setFps] = useState(0);
  const [calibrated, setCalibrated] = useState(false);
  const [hasDemo, setHasDemo] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const room = useRoom(code, 'audience-cam');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AudienceAnalyzer | null>(null);
  const tickRef = useRef(room.tick);
  tickRef.current = room.tick;
  const cams = useDevices('videoinput', phase);
  const rec = useRecorder(room.socket, room.session, stream, 'audience');

  useEffect(() => {
    fetch(DEMO_URL, { method: 'HEAD' })
      .then((r) => setHasDemo(r.ok && (r.headers.get('content-type') ?? '').startsWith('video')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (analyzerRef.current) analyzerRef.current.grid = grid;
    setPref('audienceGrid', grid);
  }, [grid]);
  useEffect(() => {
    if (analyzerRef.current) analyzerRef.current.flipX = flip;
    setPref('audienceFlip', flip);
  }, [flip]);

  useEffect(() => {
    if (!consented) return;
    let cancelled = false;
    let timer = 0;
    let secTimer = 0;
    let camStream: MediaStream | null = null;
    const video = videoRef.current!;
    setPhase('loading');
    setError(null);
    setSample(null);

    // Simulated room: the shared virtual audience reacts to the live presenter metrics.
    if (source.kind === 'simulated') {
      const sim = new VirtualAudience(`sim-${code}`);
      secTimer = window.setInterval(() => {
        const s = room.socket;
        const tk = tickRef.current;
        const t = s ? s.sessionTime() : 0;
        const fallback = { wpm: null, fillersPerMin: 0, fillerTotal: 0, wordTotal: 0, paceSource: 'none' as const, lastFiller: null };
        const smp = sim.step(t, tk?.presenter ?? null, tk?.speech ?? fallback, tk?.score ?? null);
        smp.source = 'simulated';
        s?.send({ type: 'audience.sample', sample: smp });
        setSample(smp);
      }, 1000);
      setPhase('running');
      return () => {
        cancelled = true;
        window.clearInterval(secTimer);
      };
    }

    (async () => {
      try {
        if (source.kind === 'camera') {
          camStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: source.deviceId ? { exact: source.deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } },
          });
          if (cancelled) return camStream.getTracks().forEach((t) => t.stop());
          video.srcObject = camStream;
          setStream(camStream);
        } else {
          video.srcObject = null;
          video.src = source.kind === 'demo' ? DEMO_URL : source.url;
          video.loop = true;
        }
        video.muted = true;
        await video.play();
        if (source.kind !== 'camera') {
          const cap = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
          if (cap) setStream(cap);
        }
        const [yunet, lm] = await loadModels();
        if (cancelled) return;
        const analyzer = new AudienceAnalyzer(yunet, lm);
        analyzer.grid = grid;
        analyzer.flipX = flip;
        analyzerRef.current = analyzer;
        if (import.meta.env.DEV) (window as any).__rtrAudience = analyzer;
        setPhase('running');
        let boxes: TrackBox[] = [];
        const loop = async () => {
          if (cancelled) return;
          try {
            boxes = await analyzer.process(video, performance.now());
            if (canvasRef.current && !cancelled) drawAudienceOverlay(canvasRef.current, video, boxes);
          } catch (e) {
            console.warn('[audience] frame failed', e);
          }
          timer = window.setTimeout(loop, 20);
        };
        loop();
        secTimer = window.setInterval(() => {
          const s = room.socket;
          const smp = analyzer.summarize(s ? s.sessionTime() : 0, performance.now(), source.kind === 'camera' ? 'camera' : 'video');
          s?.send({ type: 'audience.sample', sample: smp });
          setSample(smp);
          setFps(analyzer.fps);
          setCalibrated(analyzer.roomPitch != null);
        }, 1000);
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        setError(err?.name === 'NotAllowedError' ? 'Camera permission was denied.' : `Could not start: ${err?.message ?? e}`);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(secTimer);
      camStream?.getTracks().forEach((t) => t.stop());
      setStream(null);
      analyzerRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.srcObject = null;
    };
    // grid/flip are applied live via refs; no restart needed for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consented, source, code, room.socket]);

  const sourceValue = source.kind === 'camera' ? `cam:${source.deviceId ?? ''}` : source.kind;

  return (
    <div className="shell">
      {!consented && <ConsentGate kind="audience" onAccept={() => setConsented(true)} />}
      <TopBar title={`Audience camera · ${code}`}>
        <LiveIndicators camera={phase === 'running' && source.kind !== 'simulated'} recording={rec.recording} />
        <Link className="btn btn-sm" to={`/dashboard?s=${code}`} target="_blank">
          Dashboard
        </Link>
      </TopBar>
      <main id="main" className="audience-layout">
        <section className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Room map</h2>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                Engagement estimates from head pose. Not emotion detection.
              </span>
            </div>
            <RoomMap sample={sample} />
          </div>
          <div className="stats">
            <Stat label="People tracked" value={sample?.count ?? '—'} />
            <Stat
              label="Attentive"
              value={sample?.attention != null ? Math.round(sample.attention * 100) : '—'}
              unit="%"
              level={sample?.attention == null ? undefined : sample.attention < 0.5 ? 'alert' : sample.attention < 0.7 ? 'warn' : 'good'}
            />
            <Stat label="Looking down" value={sample ? Math.round(sample.down * 100) : '—'} unit="%" />
            <Stat label="Looking away" value={sample ? Math.round(sample.away * 100) : '—'} unit="%" />
            <Stat label="Analysis rate" value={source.kind === 'simulated' ? 'sim' : fps.toFixed(1)} unit={source.kind === 'simulated' ? '' : 'fps'} hint="Summaries are sent once per second" />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Zones</h2>
            </div>
            <ZoneHeatmap zones={sample?.zones ?? null} />
          </div>
        </section>
        <aside className="stack">
          <div className={`video-wrap ${hideVideo || source.kind === 'simulated' ? 'video-hidden' : ''}`}>
            <video ref={videoRef} playsInline muted style={{ filter: blur ? 'blur(10px)' : undefined }} aria-label="Audience camera preview, for aiming only" />
            <canvas ref={canvasRef} aria-hidden="true" />
            {phase === 'loading' && <div className="video-msg">Loading face model…</div>}
            {source.kind === 'simulated' && <div className="video-msg">Simulated room: no camera in use</div>}
            {error && <div className="video-msg video-msg-err">{error}</div>}
          </div>
          <div className="panel stack">
            <h2 style={{ fontSize: '1rem' }}>Source</h2>
            <label className="field">
              Audience source
              <select
                value={sourceValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'demo') setSource({ kind: 'demo' });
                  else if (v === 'simulated') setSource({ kind: 'simulated' });
                  else if (v.startsWith('cam:')) {
                    const id = v.slice(4) || undefined;
                    setPref('audienceCam', id);
                    setSource({ kind: 'camera', deviceId: id });
                  }
                }}
              >
                <option value="cam:">Default camera</option>
                {cams.map((d, i) => (
                  <option key={d.deviceId} value={`cam:${d.deviceId}`}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
                {hasDemo && <option value="demo">Demo crowd video (loop)</option>}
                <option value="simulated">Simulated room (reacts to the presenter)</option>
                {source.kind === 'file' && <option value="file">File: {source.name}</option>}
              </select>
            </label>
            <label className="field">
              Or loop a video file
              <input
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setSource({ kind: 'file', url: URL.createObjectURL(f), name: f.name });
                }}
              />
            </label>
            <label className="field">
              Face detection coverage
              <select value={grid} onChange={(e) => setGrid(e.target.value as Grid)}>
                {GRIDS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={blur} onChange={(e) => setBlur(e.target.checked)} />
              Blur preview
            </label>
            <label className="toggle">
              <input type="checkbox" checked={hideVideo} onChange={(e) => setHideVideo(e.target.checked)} />
              Hide video (boxes only)
            </label>
            <label className="toggle">
              <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
              Swap left/right (if the camera is behind the audience)
            </label>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className={`chip ${calibrated ? 'chip-good' : 'chip-warn'}`}>
                <span className="dot" />
                {calibrated ? 'Room calibrated' : 'Calibrating room…'}
              </span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  analyzerRef.current?.recalibrate();
                  setCalibrated(false);
                }}
              >
                Recalibrate
              </button>
            </div>
            <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              Place this camera beside the presenter, facing the room. For the first few seconds, the room's typical head
              angle becomes the "attentive" baseline. The preview stays on this device and only anonymous counts are
              sent.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
