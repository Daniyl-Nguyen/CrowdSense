// Presenter node pipeline: camera + mic → per-frame vision → 1 Hz samples → server.
// Shared by the presenter Camera Node and Practice Mode.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresenterSample } from '@shared/types.ts';
import { AUDIO_HEADER_BYTES } from '@shared/types.ts';
import { PRESENTER } from '@shared/thresholds.ts';
import type { RoomSocket } from '../lib/socket.ts';
import { createFaceLandmarker, createPoseLandmarker, type FaceLandmarker, type PoseLandmarker } from './mediapipe.ts';
import { PresenterAnalyzer } from './presenter.ts';
import { Mic } from '../audio/mic.ts';
import { startWebSpeech } from '../audio/webspeech.ts';

let models: Promise<[FaceLandmarker, PoseLandmarker]> | null = null;
const loadModels = () =>
  (models ??= Promise.all([createFaceLandmarker({ numFaces: 1, mode: 'VIDEO' }), createPoseLandmarker()]).catch((e) => {
    models = null;
    throw e;
  }));

export type CalibState =
  | { state: 'waiting' }
  | { state: 'running'; remaining: number }
  | { state: 'done'; warning?: string }
  | { state: 'failed'; message: string };

export interface PipelineOpts {
  socket: RoomSocket | null;
  active: boolean;
  cameraId?: string;
  micId?: string;
  webSpeech: boolean;
}

export function usePresenterPipeline({ socket, active, cameraId, micId, webSpeech }: PipelineOpts) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const analyzerRef = useRef<PresenterAnalyzer | null>(null);
  const micRef = useRef<Mic | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState<PresenterSample | null>(null);
  const [calib, setCalib] = useState<CalibState>({ state: 'waiting' });
  const [interim, setInterim] = useState('');
  const calibStart = useRef<number | null>(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const recalibrate = useCallback(() => {
    if (analyzerRef.current) analyzerRef.current.baseline = null;
    calibStart.current = null;
    setCalib({ state: 'waiting' });
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let raf = 0;
    let secTimer = 0;
    let video: HTMLVideoElement | null = null;
    let localStream: MediaStream | null = null;
    setPhase('loading');
    setError(null);

    (async () => {
      try {
        if (!window.isSecureContext) {
          throw new Error('Camera access requires HTTPS or localhost. On the server computer, open the dashboard at localhost and choose “Open on this device”. On another device, use an HTTPS link.');
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is unavailable in this browser. Open this page in Chrome, Edge, or Safari.');
        }
        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
        const mic = await Mic.open(micId).catch((e) => {
          console.warn('[mic] unavailable', e);
          return null;
        });
        if (cancelled) {
          localStream.getTracks().forEach((t) => t.stop());
          mic?.close();
          return;
        }
        micRef.current = mic;
        // Recording (M6) wants camera + mic in one stream.
        const combined = new MediaStream([...localStream.getVideoTracks(), ...(mic?.stream.getAudioTracks() ?? [])]);
        setStream(combined);
        video = videoRef.current!;
        video.srcObject = localStream;
        video.muted = true;
        await video.play();
        await mic?.resume();
        const [face, pose] = await loadModels();
        if (cancelled) return;
        const analyzer = new PresenterAnalyzer(face, pose);
        const existing = socketRef.current?.session?.baseline;
        if (existing) {
          analyzer.baseline = existing;
          setCalib({ state: 'done' });
        }
        analyzerRef.current = analyzer;
        if (import.meta.env.DEV) (window as any).__rtrPresenter = analyzer;

        if (mic)
          mic.onChunk = (c) => {
            const s = socketRef.current;
            if (!s || s.session?.status !== 'live') return;
            const buf = new ArrayBuffer(AUDIO_HEADER_BYTES + c.pcm.byteLength);
            const v = new DataView(buf);
            v.setFloat64(0, s.sessionTime(c.startedAt), true);
            v.setFloat32(8, c.speechSec, true);
            v.setUint32(12, 16000, true);
            new Int16Array(buf, AUDIO_HEADER_BYTES).set(c.pcm);
            s.sendBinary(buf);
          };

        let last = 0;
        const loop = () => {
          if (cancelled) return;
          const now = performance.now();
          if (now - last >= 66) {
            last = now;
            try {
              analyzer.process(video!, now);
            } catch (e) {
              console.warn('[vision] frame failed', e);
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        setPhase('running');

        secTimer = window.setInterval(() => {
          const s = socketRef.current;
          const now = performance.now();
          const audio = micRef.current?.second() ?? { volumeDb: -100, speaking: false, silenceSec: 0, levelDb: -100 };
          // Calibration: starts automatically once the presenter is in frame.
          if (!analyzer.baseline) {
            const visible = analyzer.frames.filter((f) => f.ts > now - 1000);
            const inFrame = visible.some((f) => f.pose) && visible.some((f) => f.face);
            if (calibStart.current == null && inFrame) calibStart.current = now;
            if (calibStart.current != null) {
              const remaining = Math.ceil(PRESENTER.calibrationSec - (now - calibStart.current) / 1000);
              if (remaining > 0) setCalib({ state: 'running', remaining });
              else {
                const audioCal = micRef.current?.calibration(calibStart.current) ?? { volumeDb: -30, noiseDb: -60, voicedFrames: 0 };
                const b = analyzer.computeBaseline(calibStart.current, audioCal);
                calibStart.current = null;
                if (!b) setCalib({ state: 'failed', message: 'Could not see your face and shoulders. Step back so your upper body is in frame.' });
                else {
                  analyzer.baseline = b;
                  s?.send({ type: 'presenter.baseline', baseline: b });
                  setCalib({
                    state: 'done',
                    warning: audioCal.voicedFrames < 20 ? 'We barely heard you, so volume uses a default baseline. Recalibrate while speaking.' : undefined,
                  });
                }
              }
            }
          }
          const sample = analyzer.summarize(s ? s.sessionTime() : 0, now, audio);
          s?.send({ type: 'presenter.sample', sample });
          setSample(sample);
        }, 1000);
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera or microphone permission was denied. Allow access in the address bar and reload.'
            : err?.name === 'NotFoundError'
              ? 'No camera found.'
              : `Could not start: ${err?.message ?? e}`,
        );
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(secTimer);
      localStream?.getTracks().forEach((t) => t.stop());
      micRef.current?.close();
      micRef.current = null;
      analyzerRef.current = null;
      setStream(null);
      if (video) video.srcObject = null;
    };
  }, [active, cameraId, micId]);

  // Browser speech recognition: low-latency pace signal, only while live.
  const live = socket?.session?.status === 'live';
  useEffect(() => {
    if (!active || !webSpeech || !live || !socket) return;
    return startWebSpeech(
      (text) => socket.send({ type: 'speech.webspeech', text, t1: socket.sessionTime() }),
      setInterim,
    );
  }, [active, webSpeech, live, socket]);

  return { videoRef, phase, error, sample, calib, recalibrate, analyzerRef, micRef, stream, interim };
}
