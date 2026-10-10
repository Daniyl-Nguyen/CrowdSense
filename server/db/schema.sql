-- Read the Room: Neon Postgres schema. Applied idempotently at server start.
-- Times are epoch milliseconds (bigint) or session-relative milliseconds (t_ms).

create table if not exists presenters (
  id          text primary key,            -- anonymous local ID from the browser, no PII
  created_at  bigint not null
);

create table if not exists sessions (
  id           uuid primary key,
  presenter_id text not null references presenters(id),
  code         text not null,
  mode         text not null check (mode in ('live', 'practice')),
  title        text not null,
  status       text not null check (status in ('lobby', 'live', 'ended')),
  created_at   bigint not null,
  started_at   bigint,
  ended_at     bigint,
  baseline     jsonb,
  summary      jsonb,                       -- generated report
  score        int,
  report_key   text                         -- S3 key of report JSON
);
create index if not exists sessions_presenter_idx on sessions (presenter_id, created_at desc);

-- One row per second (batched), never per frame.
create table if not exists metric_samples (
  session_id uuid not null references sessions(id) on delete cascade,
  t_ms       int  not null,
  data       jsonb not null,
  primary key (session_id, t_ms)
);

create table if not exists transcript_segments (
  session_id uuid not null references sessions(id) on delete cascade,
  id         text not null,
  t_start_ms int  not null,
  t_end_ms   int  not null,
  text       text not null,
  words      int  not null,
  fillers    int  not null,
  source     text not null,
  primary key (session_id, id)
);

create table if not exists reaction_events (
  id          bigserial primary key,
  session_id  uuid not null references sessions(id) on delete cascade,
  t_ms        int  not null,
  kind        text not null,
  client_hash text not null,                -- salted hash of the phone's random ID
  text        text
);
create index if not exists reaction_events_session_idx on reaction_events (session_id, t_ms);

create table if not exists spike_events (
  session_id uuid not null references sessions(id) on delete cascade,
  id         text not null,
  t_ms       int  not null,
  kind       text not null,
  severity   real not null,
  text       text not null,
  transcript text,
  presenter  text,
  primary key (session_id, id)
);

create table if not exists coaching_tips (
  id         bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  t_ms       int,
  kind       text not null,
  text       text not null,
  why        text not null,
  origin     text not null check (origin in ('live', 'report'))
);
create index if not exists coaching_tips_session_idx on coaching_tips (session_id);

create table if not exists recordings (
  id              text primary key,
  session_id      uuid not null references sessions(id) on delete cascade,
  role            text not null,
  s3_key          text not null,
  upload_id       text,
  status          text not null,
  start_offset_ms int  not null,
  duration_ms     int,
  mime            text not null,
  final_key       text
);
create index if not exists recordings_session_idx on recordings (session_id);
