// Storage interface. Neon Postgres is the system of record; LocalRepo (JSON files) is the
// zero-config fallback so `npm run dev` works with no keys.
import fs from 'node:fs';
import path from 'node:path';
import type {
  LiveTick,
  PresenterBaseline,
  ReactionKind,
  SessionMode,
  SessionStatus,
  Spike,
  TranscriptSegment,
} from '../../shared/types.ts';

export interface SessionRow {
  id: string;
  presenterId: string;
  code: string;
  mode: SessionMode;
  title: string;
  status: SessionStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  baseline: PresenterBaseline | null;
  summary: unknown | null; // the generated report
  score: number | null;
  reportKey: string | null;
}

export type SampleRow = Omit<LiveTick, 'status'>;

export interface ReactionRow {
  t: number;
  kind: ReactionKind;
  clientId: string;
  text?: string;
}

export interface TipRow {
  t: number | null; // session ms for live nudges, null for report tips
  kind: string;
  text: string;
  why: string;
  origin: 'live' | 'report';
}

export interface RecordingRow {
  id: string;
  sessionId: string;
  role: 'presenter' | 'audience';
  key: string;
  uploadId: string | null;
  status: 'recording' | 'uploaded' | 'processing' | 'ready' | 'failed';
  startOffsetMs: number;
  durationMs: number | null;
  mime: string;
  finalKey: string | null;
}

export interface Repo {
  kind: 'neon' | 'local';
  init(): Promise<void>;
  upsertSession(s: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  listSessions(presenterId: string, limit?: number): Promise<SessionRow[]>;
  insertSamples(sessionId: string, rows: SampleRow[]): Promise<void>;
  getSamples(sessionId: string): Promise<SampleRow[]>;
  insertTranscript(sessionId: string, seg: TranscriptSegment): Promise<void>;
  getTranscript(sessionId: string): Promise<TranscriptSegment[]>;
  insertReaction(sessionId: string, r: ReactionRow): Promise<void>;
  getReactions(sessionId: string): Promise<ReactionRow[]>;
  insertSpike(sessionId: string, s: Spike): Promise<void>;
  getSpikes(sessionId: string): Promise<Spike[]>;
  insertTips(sessionId: string, tips: TipRow[]): Promise<void>;
  getTips(sessionId: string): Promise<TipRow[]>;
  upsertRecording(r: RecordingRow): Promise<void>;
  getRecordings(sessionId: string): Promise<RecordingRow[]>;
}

interface LocalSession {
  session: SessionRow;
  samples: SampleRow[];
  transcript: TranscriptSegment[];
  reactions: ReactionRow[];
  spikes: Spike[];
  tips: TipRow[];
  recordings: RecordingRow[];
}

export class LocalRepo implements Repo {
  kind = 'local' as const;
  private data = new Map<string, LocalSession>();
  private dirty = new Set<string>();
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, 'sessions');
  }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as LocalSession;
        this.data.set(s.session.id, s);
      } catch {
        /* skip corrupt file */
      }
    }
    setInterval(() => this.flush(), 2000).unref();
  }

  private flush() {
    for (const id of this.dirty) {
      const s = this.data.get(id);
      if (s) fs.writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(s), () => {});
    }
    this.dirty.clear();
  }

  private get(id: string): LocalSession {
    const s = this.data.get(id);
    if (!s) throw new Error(`unknown session ${id}`);
    this.dirty.add(id);
    return s;
  }

  async upsertSession(s: SessionRow) {
    const cur = this.data.get(s.id);
    if (cur) cur.session = s;
    else this.data.set(s.id, { session: s, samples: [], transcript: [], reactions: [], spikes: [], tips: [], recordings: [] });
    this.dirty.add(s.id);
  }
  async getSession(id: string) {
    return this.data.get(id)?.session ?? null;
  }
  async listSessions(presenterId: string, limit = 20) {
    return [...this.data.values()]
      .map((d) => d.session)
      .filter((s) => s.presenterId === presenterId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  async insertSamples(id: string, rows: SampleRow[]) {
    this.get(id).samples.push(...rows);
  }
  async getSamples(id: string) {
    return this.data.get(id)?.samples ?? [];
  }
  async insertTranscript(id: string, seg: TranscriptSegment) {
    this.get(id).transcript.push(seg);
  }
  async getTranscript(id: string) {
    return this.data.get(id)?.transcript ?? [];
  }
  async insertReaction(id: string, r: ReactionRow) {
    this.get(id).reactions.push(r);
  }
  async getReactions(id: string) {
    return this.data.get(id)?.reactions ?? [];
  }
  async insertSpike(id: string, s: Spike) {
    const list = this.get(id).spikes;
    const i = list.findIndex((x) => x.id === s.id);
    if (i >= 0) list[i] = s;
    else list.push(s);
  }
  async getSpikes(id: string) {
    return this.data.get(id)?.spikes ?? [];
  }
  async insertTips(id: string, tips: TipRow[]) {
    const s = this.get(id);
    if (tips.some((t) => t.origin === 'report')) s.tips = s.tips.filter((t) => t.origin !== 'report');
    s.tips.push(...tips);
  }
  async getTips(id: string) {
    return this.data.get(id)?.tips ?? [];
  }
  async upsertRecording(r: RecordingRow) {
    const list = this.get(r.sessionId).recordings;
    const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0) list[i] = r;
    else list.push(r);
  }
  async getRecordings(id: string) {
    return this.data.get(id)?.recordings ?? [];
  }
}
