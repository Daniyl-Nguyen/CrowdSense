// Microphone: loudness (dBFS), speaking detection, and a voice-activity chunker that emits
// 16 kHz PCM utterances for server-side Whisper. AGC is disabled so volume changes are real.
import { percentile } from '../vision/geometry.ts';
import { PRESENTER } from '@shared/thresholds.ts';

export interface AudioSecond {
  volumeDb: number; // dBFS of speech in the last second, -100 if silent
  speaking: boolean;
  silenceSec: number;
  levelDb: number; // instantaneous level, for meters
}

export interface AudioChunk {
  pcm: Int16Array; // 16 kHz mono
  startedAt: number; // client epoch ms
  speechSec: number;
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('rtr-tap', Tap);`;

const FRAME = 320; // 20 ms at 16 kHz

export class Mic {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private levels: { ts: number; db: number }[] = [];
  private timer: number;
  private silenceStart = performance.now();
  private resampleCarry = 0;
  private resampleAcc: number[] = [];
  private pending = new Float32Array(0);
  // chunker state
  private chunk: Float32Array[] = [];
  private chunkFrames = 0;
  private chunkStart = 0;
  private trailingSilence = 0;
  private silentRun = 0;
  private longSilenceFrames = 0;
  private preroll: Float32Array[] = [];
  noiseDb = -60;
  onChunk: ((c: AudioChunk) => void) | null = null;

  private constructor(public stream: MediaStream) {
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.timer = window.setInterval(() => this.meter(), 40);
    void this.attachWorklet(src);
  }

  static async open(deviceId?: string): Promise<Mic> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    return new Mic(stream);
  }

  private async attachWorklet(src: MediaStreamAudioSourceNode) {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(this.ctx, 'rtr-tap');
      node.port.onmessage = (e) => this.onPcm(e.data as Float32Array);
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      src.connect(node).connect(sink).connect(this.ctx.destination);
    } catch (e) {
      console.warn('[mic] AudioWorklet unavailable; Whisper streaming disabled', e);
    }
  }

  resume() {
    return this.ctx.resume();
  }

  private meter() {
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    const ts = performance.now();
    this.levels.push({ ts, db });
    while (this.levels.length && this.levels[0].ts < ts - 30_000) this.levels.shift();
    // Adaptive noise floor: 10th percentile of the last 30 s.
    if (this.levels.length > 50) this.noiseDb = Math.max(-90, percentile(this.levels.map((l) => l.db), 0.1));
    if (db > this.noiseDb + PRESENTER.speakingAboveNoiseDb) this.silenceStart = ts;
  }

  private voiced(db: number) {
    return db > this.noiseDb + PRESENTER.speakingAboveNoiseDb;
  }

  second(): AudioSecond {
    const now = performance.now();
    const last = this.levels.filter((l) => l.ts > now - 1000);
    const voiced = last.filter((l) => this.voiced(l.db));
    const speaking = last.length > 0 && voiced.length / last.length > 0.25;
    return {
      volumeDb: speaking ? percentile(voiced.map((l) => l.db), 0.8) : -100,
      speaking,
      silenceSec: Math.floor((now - this.silenceStart) / 1000),
      levelDb: this.levels.at(-1)?.db ?? -100,
    };
  }

  /** Speaking level and noise floor over a window, for calibration. */
  calibration(sinceMs: number) {
    const win = this.levels.filter((l) => l.ts >= sinceMs).map((l) => l.db);
    const noise = Math.min(this.noiseDb, percentile(win, 0.1));
    const level = percentile(win, 0.75);
    const heard = win.length > 50 && level - noise > 6;
    return { volumeDb: heard ? level : -30, noiseDb: noise, voicedFrames: heard ? win.filter((d) => d > noise + 6).length : 0 };
  }

  /** Streaming average-downsampler to 16 kHz, then 20 ms framing for the VAD chunker. */
  private onPcm(input: Float32Array) {
    const ratio = this.ctx.sampleRate / 16000;
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      this.resampleAcc.push(input[i]);
      this.resampleCarry += 1;
      if (this.resampleCarry >= ratio) {
        this.resampleCarry -= ratio;
        out.push(this.resampleAcc.reduce((a, b) => a + b, 0) / this.resampleAcc.length);
        this.resampleAcc = [];
      }
    }
    const merged = new Float32Array(this.pending.length + out.length);
    merged.set(this.pending);
    merged.set(out, this.pending.length);
    let off = 0;
    for (; off + FRAME <= merged.length; off += FRAME) this.onFrame(merged.slice(off, off + FRAME));
    this.pending = merged.slice(off);
  }

  private onFrame(f: Float32Array) {
    let sum = 0;
    for (const v of f) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / f.length) + 1e-9);
    const voiced = this.voiced(db);
    if (!this.chunkFrames) {
      this.preroll.push(f);
      if (this.preroll.length > 15) this.preroll.shift(); // 300 ms
      if (!voiced) return;
      this.chunk = [...this.preroll];
      this.chunkFrames = this.chunk.length;
      this.chunkStart = Date.now() - this.chunkFrames * 20;
      this.preroll = [];
      this.trailingSilence = 0;
      this.silentRun = 0;
      this.longSilenceFrames = 0;
      return;
    }
    this.chunk.push(f);
    this.chunkFrames++;
    if (voiced) {
      if (this.silentRun > 12) this.longSilenceFrames += this.silentRun; // gaps > 240 ms aren't speech
      this.silentRun = 0;
      this.trailingSilence = 0;
    } else {
      this.silentRun++;
      this.trailingSilence++;
    }
    const sec = this.chunkFrames / 50;
    if ((sec >= 1.2 && this.trailingSilence >= 30) || sec >= 10) this.flush();
    else if (this.trailingSilence >= 50 && sec < 1.2) this.reset(); // blip, not speech
  }

  private flush() {
    const frames = this.chunkFrames;
    const speechSec = Math.max(0, (frames - this.longSilenceFrames - this.trailingSilence) / 50);
    if (speechSec >= 0.4 && this.onChunk) {
      const pcm = new Int16Array(frames * FRAME);
      let o = 0;
      for (const f of this.chunk) for (const v of f) pcm[o++] = Math.max(-32768, Math.min(32767, v * 32767));
      this.onChunk({ pcm, startedAt: this.chunkStart, speechSec });
    }
    this.reset();
  }

  private reset() {
    this.chunk = [];
    this.chunkFrames = 0;
  }

  close() {
    window.clearInterval(this.timer);
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}
