// A Room is one session: its connected nodes, live state, engines, and batched persistence.
import type { WebSocket } from 'ws';
import type {
  AudienceSample,
  ClientMsg,
  LiveTick,
  NodeRole,
  PresenterSample,
  ReactionCounts,
  ReactionKind,
  ServerMsg,
  SessionInfo,
  Spike,
} from '../shared/types.ts';
import { AUDIO_HEADER_BYTES } from '../shared/types.ts';
import { NudgeEngine } from '../shared/nudges.ts';
import { SpikeDetector } from '../shared/spikes.ts';
import { deliveryScore } from '../shared/scoring.ts';
import { describePresenter } from '../shared/describe.ts';
import { REACTION_RATE_LIMIT_MS } from '../shared/thresholds.ts';
import { VirtualAudience } from '../shared/virtualAudience.ts';
import { SpeechTracker } from './speech.ts';
import { transcriber } from './ai/whisper.ts';
import type { Repo, SampleRow, SessionRow } from './db/repo.ts';
import { config } from './config.ts';

interface Client {
  ws: WebSocket;
  role: NodeRole;
  clientId: string;
}

export class Room {
  clients = new Set<Client>();
  private presenter: { s: PresenterSample; at: number } | null = null;
  private audience: { s: AudienceSample; at: number } | null = null;
  private speech: SpeechTracker;
  private nudges = new NudgeEngine(config.demoSpeed);
  private spikes = new SpikeDetector();
  private virtual: VirtualAudience | null;
  private reactions: { t: number; kind: ReactionKind }[] = [];
  private lastReactionBy = new Map<string, number>();
  private lastAudioAt = 0;
  private pending: SampleRow[] = [];
  private timer: NodeJS.Timeout;
  recording = false;
  onEnded?: (room: Room) => void;

  constructor(
    public row: SessionRow,
    private repo: Repo,
  ) {
    this.speech = new SpeechTracker(transcriber.status === 'ready' ? 'whisper' : 'webspeech');
    this.virtual = row.mode === 'practice' ? new VirtualAudience(row.id) : null;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get id() {
    return this.row.id;
  }

  /** Session clock: ms since start (or since creation while in the lobby). */
  now(): number {
    return Date.now() - (this.row.startedAt ?? this.row.createdAt);
  }

  info(): SessionInfo {
    const count = (r: NodeRole) => [...this.clients].filter((c) => c.role === r).length;
    return {
      id: this.row.id,
      code: this.row.code,
      mode: this.row.mode,
      status: this.row.status,
      title: this.row.title,
      presenterId: this.row.presenterId,
      createdAt: this.row.createdAt,
      startedAt: this.row.startedAt,
      endedAt: this.row.endedAt,
      recording: this.recording,
      baseline: this.row.baseline,
      nodes: {
        presenter: count('presenter-cam'),
        audience: count('audience-cam'),
        phones: count('phone'),
        monitors: count('monitor'),
        dashboards: count('dashboard'),
      },
    };
  }

  send(c: Client, msg: ServerMsg) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg, filter?: (c: Client) => boolean) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.ws.readyState === 1 && (!filter || filter(c))) c.ws.send(data);
  }

  join(c: Client) {
    this.clients.add(c);
    this.broadcast({ type: 'session', session: this.info() });
  }

  leave(c: Client) {
    this.clients.delete(c);
    this.broadcast({ type: 'session', session: this.info() });
  }

  private get live() {
    return this.row.status === 'live';
  }

  async handle(c: Client, msg: ClientMsg) {
    switch (msg.type) {
      case 'ping':
        return this.send(c, { type: 'pong', c: msg.c, s: Date.now() });
      case 'presenter.sample':
        this.presenter = { s: msg.sample, at: Date.now() };
        if (msg.sample.speaking && this.live) this.speech.markSpeaking(this.now());
        return;
      case 'presenter.baseline':
        this.row.baseline = msg.baseline;
        await this.repo.upsertSession(this.row);
        return this.broadcast({ type: 'session', session: this.info() });
      case 'audience.sample':
        if (!this.virtual) this.audience = { s: msg.sample, at: Date.now() };
        return;
      case 'speech.webspeech': {
        if (!this.live) return;
        this.speech.setPrimary(this.speechPrimary());
        const t1 = this.now();
        const seg = this.speech.add('webspeech', Math.max(0, t1 - 4000), t1, msg.text);
        if (seg) {
          this.broadcast({ type: 'transcript', segment: seg });
          await this.repo.insertTranscript(this.id, seg);
        }
        return;
      }
      case 'reaction':
        return this.react(c, msg.kind, msg.text);
      case 'control':
        if (msg.action === 'start') return this.start();
        if (msg.action === 'end') return this.end();
        if (msg.action === 'recording') {
          this.recording = msg.value;
          return this.broadcast({ type: 'session', session: this.info() });
        }
    }
  }

  private speechPrimary(): 'whisper' | 'webspeech' {
    return transcriber.status === 'ready' && Date.now() - this.lastAudioAt < 15_000 ? 'whisper' : 'webspeech';
  }

  private async react(c: Client, kind: ReactionKind, text?: string) {
    const last = this.lastReactionBy.get(c.clientId) ?? 0;
    const wait = REACTION_RATE_LIMIT_MS - (Date.now() - last);
    if (wait > 0) return this.send(c, { type: 'reaction.limited', retryInMs: wait });
    this.lastReactionBy.set(c.clientId, Date.now());
    const t = this.now();
    this.reactions.push({ t, kind });
    const clean = text?.trim().slice(0, 200) || undefined;
    this.broadcast({ type: 'reaction', kind, t, text: clean });
    if (this.live) await this.repo.insertReaction(this.id, { t, kind, clientId: c.clientId, text: clean });
  }

  /** Binary audio chunk from the presenter node → Whisper. */
  async audio(buf: Buffer) {
    if (!this.live || transcriber.status === 'off' || transcriber.status === 'error') return;
    if (buf.byteLength <= AUDIO_HEADER_BYTES) return;
    this.lastAudioAt = Date.now();
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const t0 = view.getFloat64(0, true);
    const speechSec = view.getFloat32(8, true);
    const rate = view.getUint32(12, true);
    const n = (buf.byteLength - AUDIO_HEADER_BYTES) / 2;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = view.getInt16(AUDIO_HEADER_BYTES + i * 2, true) / 32768;
    if (rate !== 16000) return;
    const text = await transcriber.transcribe(pcm);
    if (!text || !this.live) return;
    this.speech.setPrimary(this.speechPrimary());
    const seg = this.speech.add('whisper', t0, t0 + (n / 16000) * 1000, text, speechSec);
    if (seg) {
      this.broadcast({ type: 'transcript', segment: seg });
      await this.repo.insertTranscript(this.id, seg);
    }
  }

  private reactionCounts(t: number): ReactionCounts {
    const out: ReactionCounts = { lost: 0, fast: 0, love: 0, question: 0 };
    for (const r of this.reactions) if (t - r.t < 60_000) out[r.kind]++;
    return out;
  }

  private tick() {
    const t = this.now();
    const fresh = Date.now();
    const presenter = this.presenter && fresh - this.presenter.at < 3000 ? this.presenter.s : null;
    const speech = this.speech.stats(t);
    const score = deliveryScore(presenter, speech);
    if (this.virtual && this.live) this.audience = { s: this.virtual.step(t, presenter, speech, score), at: fresh };
    const audience = this.audience && fresh - this.audience.at < 6000 ? this.audience.s : null;
    this.reactions = this.reactions.filter((r) => t - r.t < 120_000);
    const tick: LiveTick = {
      t,
      status: this.row.status,
      presenter,
      speech,
      audience,
      reactions: this.reactionCounts(t),
      score,
    };
    this.broadcast({ type: 'tick', tick });
    if (!this.live) return;

    const lostTaps = this.reactions.filter((r) => r.kind === 'lost').map((r) => r.t);
    const fastTaps = this.reactions.filter((r) => r.kind === 'fast').map((r) => r.t);
    const fired = this.spikes.update(t, audience, lostTaps);
    for (const s of fired) this.spike(s, presenter, speech);
    const drop = fired.find((s) => s.kind === 'attention-drop');
    const nudge = this.nudges.evaluate({
      t,
      presenter,
      speech,
      audience,
      lostTaps,
      fastTaps,
      attentionDrop: drop ? { points: drop.severity * 0.6 } : null,
    });
    if (nudge) {
      this.broadcast({ type: 'nudge', nudge });
      void this.repo.insertTips(this.id, [{ t, kind: nudge.kind, text: nudge.text, why: nudge.why, origin: 'live' }]);
    }

    // Batched persistence: one row per second, never per frame.
    const { status: _s, ...row } = tick;
    this.pending.push(row);
    const batch = this.pending;
    this.pending = [];
    void this.repo.insertSamples(this.id, batch).catch((e) => {
      console.warn('[db] sample write failed, will retry', e?.message);
      this.pending.unshift(...batch);
    });
  }

  private spike(s: Spike, p: PresenterSample | null, sp: ReturnType<SpeechTracker['stats']>) {
    s.presenter = describePresenter(p, sp);
    s.transcript = this.speech.around(s.t);
    this.broadcast({ type: 'spike', spike: s });
    void this.repo.insertSpike(this.id, s);
    // Whisper lags a few seconds behind; fill in the words around the moment once they arrive.
    setTimeout(() => {
      s.transcript = this.speech.around(s.t);
      this.broadcast({ type: 'spike', spike: s });
      void this.repo.insertSpike(this.id, s);
    }, 7000);
  }

  async start() {
    if (this.row.status !== 'lobby') return;
    this.row.status = 'live';
    this.row.startedAt = Date.now();
    await this.repo.upsertSession(this.row);
    this.broadcast({ type: 'session', session: this.info() });
  }

  async end() {
    if (this.row.status !== 'live') return;
    this.row.status = 'ended';
    this.row.endedAt = Date.now();
    this.recording = false;
    await this.repo.upsertSession(this.row);
    this.broadcast({ type: 'session', session: this.info() });
    this.onEnded?.(this);
  }

  speechSummary() {
    return { fillerCounts: this.speech.fillerCounts, fillerTotal: this.speech.fillerTotal, wordTotal: this.speech.wordTotal };
  }

  dispose() {
    clearInterval(this.timer);
    for (const c of this.clients) c.ws.close();
  }
}
