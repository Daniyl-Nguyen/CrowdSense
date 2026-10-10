// Opt-in recording: MediaRecorder → 5 MB parts → presigned multipart upload (S3 or local fallback).
// Runs only while the session is live AND the operator has turned recording on.
import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@shared/types.ts';
import type { RoomSocket } from '../lib/socket.ts';
import { api } from '../lib/api.ts';

const PART_BYTES = 5 * 1024 * 1024; // S3's minimum part size (except the last part)

const uploadHeaders = (): Record<string, string> => {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('recordingToken');
  return token ? { 'x-recording-token': token } : {};
};

function pickMime(hasAudio: boolean): string {
  const opts = hasAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return opts.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

class Upload {
  private parts: { PartNumber: number; ETag: string }[] = [];
  private buffer: Blob[] = [];
  private bytes = 0;
  private next = 1;
  private queue: Promise<void> = Promise.resolve();
  failed: string | null = null;

  constructor(
    private sessionId: string,
    private recId: string,
  ) {}

  push(b: Blob) {
    this.buffer.push(b);
    this.bytes += b.size;
    if (this.bytes >= PART_BYTES) this.flush();
  }

  private flush() {
    if (!this.bytes) return;
    const blob = new Blob(this.buffer);
    const n = this.next++;
    this.buffer = [];
    this.bytes = 0;
    this.queue = this.queue.then(() => this.put(n, blob));
  }

  private async put(n: number, blob: Blob) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { url } = await api.post<{ url: string }>(`/api/sessions/${this.sessionId}/recordings/${this.recId}/part`, { partNumber: n }, uploadHeaders());
        const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const etag = r.headers.get('ETag');
        if (!etag) throw new Error('No ETag (S3 bucket CORS must expose ETag; run npm run s3:setup)');
        this.parts.push({ PartNumber: n, ETag: etag });
        return;
      } catch (e) {
        if (attempt === 2) this.failed = (e as Error).message;
        else await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
      }
    }
  }

  async finish(durationMs: number) {
    this.flush();
    await this.queue;
    await api.post(`/api/sessions/${this.sessionId}/recordings/${this.recId}/complete`, { parts: this.failed ? [] : this.parts, durationMs }, uploadHeaders());
  }
}

export function useRecorder(socket: RoomSocket | null, session: SessionInfo | null, stream: MediaStream | null, role: 'presenter' | 'audience') {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const want = !!session && session.status === 'live' && session.recording && !!stream;
  const sessionId = session?.id;

  useEffect(() => {
    if (!want || !stream || !sessionId) return;
    let rec: MediaRecorder | null = null;
    let upload: Upload | null = null;
    let started = 0;
    let cancelled = false;
    const mime = pickMime(stream.getAudioTracks().length > 0);
    (async () => {
      try {
        rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 64_000 });
        // Start first (accurate sync offset); hold chunks until the upload exists.
        const early: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (!e.data.size) return;
          if (upload) upload.push(e.data);
          else early.push(e.data);
        };
        rec.start(1000);
        started = performance.now();
        const startOffsetMs = socketRef.current?.sessionTime() ?? 0;
        const created = await api.post<{ id: string }>(`/api/sessions/${sessionId}/recordings`, {
          role,
          mime: (rec.mimeType || mime || 'video/webm').split(';')[0],
          startOffsetMs,
        }, uploadHeaders());
        upload = new Upload(sessionId, created.id);
        for (const b of early) upload.push(b);
        if (cancelled) {
          const u = upload;
          rec.onstop = () => { void u.finish(performance.now() - started).catch(() => {}); };
          if (rec.state !== 'inactive') rec.stop();
          else void u.finish(performance.now() - started).catch(() => {});
          return;
        }
        setRecording(true);
        setError(null);
      } catch (e) {
        if (rec && rec.state !== 'inactive') rec.stop();
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      setRecording(false);
      if (!rec || rec.state === 'inactive') return;
      if (!upload) {
        rec.stop();
        return;
      }
      const u = upload;
      const duration = performance.now() - started;
      setUploading(true);
      rec.onstop = async () => {
        try {
          await u.finish(duration);
          if (u.failed) setError(u.failed);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setUploading(false);
        }
      };
      rec.stop();
    };
  }, [want, stream, sessionId, role]);

  return { recording, uploading, error };
}
