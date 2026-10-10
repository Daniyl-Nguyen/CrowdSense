// Shared domain types for browser nodes and the server.
// Everything here is anonymized metrics: no images, no embeddings, no identities.

export type NodeRole = 'presenter-cam' | 'audience-cam' | 'monitor' | 'dashboard' | 'phone';
export type SessionMode = 'live' | 'practice';
export type SessionStatus = 'lobby' | 'live' | 'ended';

/** Captured during the 15 s calibration. Every presenter metric is judged relative to this. */
export interface PresenterBaseline {
  torsoRatio: number; // (shoulderMidY - noseY) / shoulderWidth
  shoulderAngle: number; // degrees
  faceToShoulder: number; // faceWidth / shoulderWidth
  headYaw: number; // degrees, toward the audience
  headPitch: number; // degrees, toward the audience
  volumeDb: number; // speaking level, dBFS
  noiseDb: number; // noise floor, dBFS
  capturedAt: number; // epoch ms
}

export type PresenterGaze = 'audience' | 'screen' | 'away' | 'unknown';

/** One per second from the presenter camera node. */
export interface PresenterSample {
  t: number; // session ms
  present: boolean;
  slouch: number; // fraction below baseline torso ratio; + = slouching
  shoulderTilt: number; // |deg| deviation from baseline
  forwardHead: number; // fraction increase of face/shoulder ratio vs baseline
  sway: number; // 0..1
  pacing: number; // shoulder-widths travelled per 10 s
  fidget: number; // 0..1
  gaze: PresenterGaze;
  gazeSide: number; // -1 = presenter's left … +1 = presenter's right
  eyeContact: number; // 0..1 fraction of the last second looking toward the audience
  screenGazeSec: number; // consecutive seconds looking down at the screen/notes
  smile: number; // 0..1
  expressiveness: number; // 0..1
  volumeDb: number; // dBFS while speaking, -100 when silent
  volumeRel: number; // dB relative to baseline (0 when silent)
  speaking: boolean;
  silenceSec: number; // consecutive seconds of silence
}

export interface SpeechStats {
  wpm: number | null; // rolling 30 s articulation rate
  fillersPerMin: number; // rolling 60 s
  fillerTotal: number;
  wordTotal: number;
  paceSource: 'whisper' | 'webspeech' | 'none';
  lastFiller: string | null;
}

export type FaceState = 'attentive' | 'down' | 'away' | 'drowsy';

/** Anonymous per-session track. `id` is a counter, never derived from appearance. */
export interface AudienceFace {
  id: number;
  x: number; // 0..1, presenter's left → right
  y: number; // 0..1, back → front of room
  size: number; // relative face size 0..1
  state: FaceState;
  confusion: boolean;
  smile: boolean;
}

export type ZoneId =
  | 'back-left'
  | 'back-center'
  | 'back-right'
  | 'front-left'
  | 'front-center'
  | 'front-right';

export interface ZoneStat {
  id: ZoneId;
  count: number;
  attentive: number;
  down: number;
  away: number;
  drowsy: number;
  attention: number | null; // 0..1
}

/** One per second from the audience camera node (or the virtual audience in practice). */
export interface AudienceSample {
  t: number;
  source: 'camera' | 'video' | 'virtual' | 'simulated';
  faces: AudienceFace[];
  count: number;
  attention: number | null; // 0..1 of tracked faces
  down: number; // fractions 0..1
  away: number;
  drowsy: number;
  confusion: number;
  smile: number;
  zones: ZoneStat[];
}

export type ReactionKind = 'lost' | 'fast' | 'love' | 'question';
export type ReactionCounts = Record<ReactionKind, number>;

export interface ScoreParts {
  eyeContact: number;
  pace: number;
  fillers: number;
  volume: number;
  posture: number;
  movement: number;
}
export interface DeliveryScore {
  score: number; // 0..100
  parts: ScoreParts; // each 0..1
}

/** Merged 1 Hz state broadcast by the server. */
export interface LiveTick {
  t: number;
  status: SessionStatus;
  presenter: PresenterSample | null;
  speech: SpeechStats;
  audience: AudienceSample | null;
  reactions: ReactionCounts; // last 60 s
  score: DeliveryScore | null;
}

export type NudgeCategory = 'audience' | 'delivery' | 'posture' | 'praise';
export type NudgeKind =
  | 'lost-taps'
  | 'fast-taps'
  | 'attention-drop'
  | 'side-drift'
  | 'zone-down'
  | 'speak-up'
  | 'slow-down'
  | 'speed-up'
  | 'fillers'
  | 'screen-gaze'
  | 'one-sided'
  | 'slouch'
  | 'tilt'
  | 'forward-head'
  | 'sway'
  | 'pacing'
  | 'fidget'
  | 'smile'
  | 'praise';

export interface Nudge {
  id: string;
  t: number;
  kind: NudgeKind;
  category: NudgeCategory;
  text: string; // the instruction, short
  why: string; // the metric that triggered it, always shown
  priority: number;
}

export type SpikeKind = 'attention-drop' | 'confusion' | 'lost-taps';
export interface Spike {
  id: string;
  t: number;
  kind: SpikeKind;
  severity: number; // 0..1
  text: string;
  transcript?: string; // what was being said around t
  presenter?: string; // what the presenter was doing
}

export interface TranscriptSegment {
  id: string;
  t0: number;
  t1: number;
  text: string;
  words: number;
  fillers: number;
  source: 'whisper' | 'webspeech';
}

export interface SessionInfo {
  id: string;
  code: string;
  mode: SessionMode;
  status: SessionStatus;
  title: string;
  presenterId: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  recording: boolean;
  baseline: PresenterBaseline | null;
  nodes: { presenter: number; audience: number; phones: number; monitors: number; dashboards: number };
}

export interface ServerConfig {
  whisper: 'ready' | 'loading' | 'off' | 'error';
  storage: 'neon' | 'local';
  blobs: 's3' | 'local';
  coach: 'bedrock' | 'anthropic' | 'template';
  lanUrls: string[];
  ffmpeg: boolean;
  extras: { gemini: boolean; tts: boolean; rekognition: boolean };
}

// ---- WebSocket protocol ----------------------------------------------------

export type ClientMsg =
  | { type: 'hello'; role: NodeRole; code: string; clientId: string }
  | { type: 'ping'; c: number }
  | { type: 'presenter.sample'; sample: PresenterSample }
  | { type: 'presenter.baseline'; baseline: PresenterBaseline }
  | { type: 'audience.sample'; sample: AudienceSample }
  | { type: 'speech.webspeech'; text: string; t1: number }
  | { type: 'reaction'; kind: ReactionKind; text?: string }
  | { type: 'control'; action: 'start' | 'end' }
  | { type: 'control'; action: 'recording'; value: boolean };

export type ServerMsg =
  | { type: 'welcome'; session: SessionInfo; serverTime: number; config: ServerConfig }
  | { type: 'pong'; c: number; s: number }
  | { type: 'session'; session: SessionInfo }
  | { type: 'tick'; tick: LiveTick }
  | { type: 'nudge'; nudge: Nudge }
  | { type: 'spike'; spike: Spike }
  | { type: 'transcript'; segment: TranscriptSegment }
  | { type: 'reaction'; kind: ReactionKind; t: number; text?: string }
  | { type: 'reaction.limited'; retryInMs: number }
  | { type: 'report.ready'; sessionId: string }
  | { type: 'error'; message: string };

/** Binary audio frame header (presenter → server), little-endian:
 *  [0..8)  float64 session-ms at chunk start
 *  [8..12) float32 seconds of actual speech in the chunk
 *  [12..16) uint32 sample rate (16000)
 *  [16..)  int16 mono PCM */
export const AUDIO_HEADER_BYTES = 16;
