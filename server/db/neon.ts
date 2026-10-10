// Neon Postgres repository using the `postgres` driver. Neon is the system of record.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import type { Spike, TranscriptSegment } from '../../shared/types.ts';
import type { ReactionRow, RecordingRow, Repo, SampleRow, SessionRow, TipRow } from './repo.ts';

const num = (v: unknown) => (v == null ? null : Number(v));
const salt = crypto.randomBytes(16).toString('hex');

export class NeonRepo implements Repo {
  kind = 'neon' as const;
  private sql: postgres.Sql;

  constructor(url: string) {
    const local = /localhost|127\.0\.0\.1/.test(url);
    this.sql = postgres(url, {
      ssl: local ? false : 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }

  async init() {
    const schema = fs.readFileSync(path.resolve('server/db/schema.sql'), 'utf8');
    await this.sql.unsafe(schema);
  }

  async upsertSession(s: SessionRow) {
    await this.sql`insert into presenters (id, created_at) values (${s.presenterId}, ${Date.now()}) on conflict (id) do nothing`;
    await this.sql`
      insert into sessions (id, presenter_id, code, mode, title, status, created_at, started_at, ended_at, baseline, summary, score, report_key)
      values (${s.id}, ${s.presenterId}, ${s.code}, ${s.mode}, ${s.title}, ${s.status}, ${s.createdAt}, ${s.startedAt}, ${s.endedAt},
              ${s.baseline ? this.sql.json(s.baseline as never) : null}, ${s.summary ? this.sql.json(s.summary as never) : null}, ${s.score}, ${s.reportKey})
      on conflict (id) do update set
        status = excluded.status, title = excluded.title, started_at = excluded.started_at, ended_at = excluded.ended_at,
        baseline = excluded.baseline, summary = excluded.summary, score = excluded.score, report_key = excluded.report_key`;
  }

  private toSession(r: postgres.Row): SessionRow {
    return {
      id: r.id,
      presenterId: r.presenter_id,
      code: r.code,
      mode: r.mode,
      title: r.title,
      status: r.status,
      createdAt: Number(r.created_at),
      startedAt: num(r.started_at),
      endedAt: num(r.ended_at),
      baseline: r.baseline,
      summary: r.summary,
      score: r.score,
      reportKey: r.report_key,
    };
  }

  async getSession(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [r] = await this.sql`select * from sessions where id = ${id}`;
    return r ? this.toSession(r) : null;
  }

  async listSessions(presenterId: string, limit = 20) {
    const rows = await this.sql`select * from sessions where presenter_id = ${presenterId} order by created_at desc limit ${limit}`;
    return rows.map((r) => this.toSession(r));
  }

  async insertSamples(sessionId: string, rows: SampleRow[]) {
    if (!rows.length) return;
    const values = rows.map((r) => ({ session_id: sessionId, t_ms: Math.round(r.t), data: r }));
    await this.sql`insert into metric_samples ${this.sql(values as never, 'session_id', 't_ms', 'data')} on conflict do nothing`;
  }

  async getSamples(sessionId: string) {
    const rows = await this.sql`select data from metric_samples where session_id = ${sessionId} order by t_ms`;
    return rows.map((r) => r.data as SampleRow);
  }

  async insertTranscript(sessionId: string, seg: TranscriptSegment) {
    await this.sql`
      insert into transcript_segments (session_id, id, t_start_ms, t_end_ms, text, words, fillers, source)
      values (${sessionId}, ${seg.id}, ${Math.round(seg.t0)}, ${Math.round(seg.t1)}, ${seg.text}, ${seg.words}, ${seg.fillers}, ${seg.source})
      on conflict do nothing`;
  }

  async getTranscript(sessionId: string) {
    const rows = await this.sql`select * from transcript_segments where session_id = ${sessionId} order by t_start_ms`;
    return rows.map((r) => ({ id: r.id, t0: r.t_start_ms, t1: r.t_end_ms, text: r.text, words: r.words, fillers: r.fillers, source: r.source }) as TranscriptSegment);
  }

  async insertReaction(sessionId: string, r: ReactionRow) {
    const hash = crypto.createHash('sha256').update(salt + r.clientId).digest('hex').slice(0, 16);
    await this.sql`insert into reaction_events (session_id, t_ms, kind, client_hash, text) values (${sessionId}, ${Math.round(r.t)}, ${r.kind}, ${hash}, ${r.text ?? null})`;
  }

  async getReactions(sessionId: string) {
    const rows = await this.sql`select * from reaction_events where session_id = ${sessionId} order by t_ms`;
    return rows.map((r) => ({ t: r.t_ms, kind: r.kind, clientId: r.client_hash, text: r.text ?? undefined }) as ReactionRow);
  }

  async insertSpike(sessionId: string, s: Spike) {
    await this.sql`
      insert into spike_events (session_id, id, t_ms, kind, severity, text, transcript, presenter)
      values (${sessionId}, ${s.id}, ${Math.round(s.t)}, ${s.kind}, ${s.severity}, ${s.text}, ${s.transcript ?? null}, ${s.presenter ?? null})
      on conflict (session_id, id) do update set transcript = excluded.transcript, presenter = excluded.presenter`;
  }

  async getSpikes(sessionId: string) {
    const rows = await this.sql`select * from spike_events where session_id = ${sessionId} order by t_ms`;
    return rows.map(
      (r) => ({ id: r.id, t: r.t_ms, kind: r.kind, severity: r.severity, text: r.text, transcript: r.transcript ?? undefined, presenter: r.presenter ?? undefined }) as Spike,
    );
  }

  async insertTips(sessionId: string, tips: TipRow[]) {
    if (!tips.length) return;
    if (tips.some((t) => t.origin === 'report')) await this.sql`delete from coaching_tips where session_id = ${sessionId} and origin = 'report'`;
    const values = tips.map((t) => ({ session_id: sessionId, t_ms: t.t == null ? null : Math.round(t.t), kind: t.kind, text: t.text, why: t.why, origin: t.origin }));
    await this.sql`insert into coaching_tips ${this.sql(values as never, 'session_id', 't_ms', 'kind', 'text', 'why', 'origin')}`;
  }

  async getTips(sessionId: string) {
    const rows = await this.sql`select * from coaching_tips where session_id = ${sessionId} order by id`;
    return rows.map((r) => ({ t: r.t_ms, kind: r.kind, text: r.text, why: r.why, origin: r.origin }) as TipRow);
  }

  async upsertRecording(r: RecordingRow) {
    await this.sql`
      insert into recordings (id, session_id, role, s3_key, upload_id, status, start_offset_ms, duration_ms, mime, final_key)
      values (${r.id}, ${r.sessionId}, ${r.role}, ${r.key}, ${r.uploadId}, ${r.status}, ${Math.round(r.startOffsetMs)}, ${r.durationMs}, ${r.mime}, ${r.finalKey})
      on conflict (id) do update set status = excluded.status, upload_id = excluded.upload_id, duration_ms = excluded.duration_ms, final_key = excluded.final_key`;
  }

  async getRecordings(sessionId: string) {
    const rows = await this.sql`select * from recordings where session_id = ${sessionId}`;
    return rows.map(
      (r) =>
        ({
          id: r.id,
          sessionId: r.session_id,
          role: r.role,
          key: r.s3_key,
          uploadId: r.upload_id,
          status: r.status,
          startOffsetMs: r.start_offset_ms,
          durationMs: r.duration_ms,
          mime: r.mime,
          finalKey: r.final_key,
        }) as RecordingRow,
    );
  }
}
