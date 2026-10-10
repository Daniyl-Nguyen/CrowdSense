import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { ReactionKind, ServerConfig, SessionInfo } from '@shared/types.ts';
import { useRoom } from '../lib/socket.ts';
import { api, shareBase } from '../lib/api.ts';
import { useBackfill, useLiveFeed } from '../lib/feed.ts';
import { NudgeCard, TopBar, Toasts, fmtTime, CATEGORY_LABEL } from '../ui/components.tsx';
import { PresenterStats, SessionControls } from '../ui/live.tsx';
import { RoomMap, ZoneHeatmap } from '../ui/room.tsx';
import { Timeline } from '../ui/Timeline.tsx';
import { REACTIONS } from '../ui/reactions.tsx';
import { ThemeToggle } from './Home.tsx';

export default function Dashboard() {
  const [params] = useSearchParams();
  const code = params.get('s')?.toUpperCase() ?? null;
  const nav = useNavigate();
  useEffect(() => {
    // No code: create a session and land here with it.
    if (!code) api.createSession('live').then((s) => nav(`/dashboard?s=${s.code}`, { replace: true }));
  }, [code, nav]);
  if (!code) return <div className="shell empty">Creating session…</div>;
  return <DashboardView code={code} />;
}

function DashboardView({ code }: { code: string }) {
  const feed = useLiveFeed();
  const room = useRoom(code, 'dashboard', feed.onMsg);
  useBackfill(room.session, feed);
  const [showJoin, setShowJoin] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; text: string; sub?: string }[]>([]);
  const s = room.session;
  const tick = room.tick;

  useEffect(() => {
    const sp = feed.latestSpike;
    if (!sp) return;
    setToasts((t) => [...t, { id: sp.id, text: sp.text, sub: `at ${fmtTime(sp.t)}${sp.presenter ? `. Presenter: ${sp.presenter}` : ''}` }]);
    const id = window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== sp.id)), 7000);
    return () => window.clearTimeout(id);
  }, [feed.latestSpike]);

  if (room.error && !s)
    return (
      <div className="shell">
        <TopBar title="Dashboard" />
        <main id="main" className="panel">
          <h1>Session not found</h1>
          <p className="dim" style={{ margin: '12px 0' }}>
            {room.error}. Sessions live in server memory while active.
          </p>
          <Link className="btn btn-primary" to="/">
            Back home
          </Link>
        </main>
      </div>
    );

  return (
    <div className="shell shell-wide">
      <TopBar title="Dashboard">
        <span className="room-code" aria-label={`Room code ${code}`}>
          <span className="eyebrow">Room</span> <span className="mono">{code}</span>
        </span>
        <button className="btn btn-sm" onClick={() => setShowJoin((v) => !v)} aria-expanded={showJoin || s?.status === 'lobby'}>
          {showJoin ? 'Hide join codes' : 'Join codes'}
        </button>
        <ThemeToggle />
      </TopBar>
      <main id="main" className="stack">
        {s && <SessionControls session={s} socket={room.socket} />}
        {s && (s.status === 'lobby' || showJoin) && <JoinPanel session={s} config={room.config} />}
        {s?.status === 'ended' && (
          <div className="panel row" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2>Session complete</h2>
              <p className="dim">The report (with AI coaching tips) is ready or being written now.</p>
            </div>
            <div className="row">
              <Link className="btn btn-primary btn-lg" to={`/report/${s.id}`}>
                Open report
              </Link>
              <Link className="btn btn-lg" to={`/replay/${s.id}`}>
                Replay
              </Link>
            </div>
          </div>
        )}
        <div className="dash-grid">
          <div className="dash-main">
            <section className="panel dash-timeline" aria-labelledby="tl-h">
              <div className="panel-head">
                <h2 id="tl-h">Attention over time</h2>
                <span className="display num" style={{ fontSize: '2rem' }}>
                  {tick?.audience?.attention != null ? `${Math.round(tick.audience.attention * 100)}%` : '—'}
                  <span className="faint" style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-body)', marginLeft: 8 }}>
                    attentive now
                  </span>
                </span>
              </div>
              <Timeline points={feed.points} spikes={feed.spikes} windowMs={s?.status === 'live' ? 5 * 60_000 : undefined} />
            </section>

            <section className="panel dash-room" aria-labelledby="room-h">
              <div className="panel-head">
                <h2 id="room-h">Room map</h2>
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  {tick?.audience ? `${tick.audience.count} people · ${tick.audience.source}` : 'no audience feed'}
                </span>
              </div>
              <RoomMap sample={tick?.audience ?? null} />
            </section>

            <section className="panel dash-zones" aria-labelledby="zones-h">
              <div className="panel-head">
                <h2 id="zones-h">Zones</h2>
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  engagement estimates
                </span>
              </div>
              <ZoneHeatmap zones={tick?.audience?.zones ?? null} />
            </section>

          </div>
          <div className="dash-side">
            <section className="panel dash-nudge" aria-labelledby="nudge-h">
              <div className="panel-head">
                <h2 id="nudge-h">Presenter's monitor</h2>
                <Link className="btn btn-sm btn-ghost" to={`/monitor?s=${code}`} target="_blank">
                  Full screen
                </Link>
              </div>
              <NudgeCard nudge={feed.latestNudge} compact />
            </section>

            <section className="panel dash-stats" aria-labelledby="stats-h">
              <div className="panel-head">
                <h2 id="stats-h">Presenter</h2>
              </div>
              <PresenterStats sample={tick?.presenter ?? null} speech={tick?.speech ?? null} score={tick?.score ?? null} />
            </section>

          </div>
          <section className="panel dash-react" aria-labelledby="react-h">
            <div className="panel-head">
              <h2 id="react-h">Audience phones</h2>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {s?.nodes.phones ?? 0} connected · last 60s
              </span>
            </div>
            <div className="react-counts">
              {(Object.keys(REACTIONS) as ReactionKind[]).map((k) => (
                <div key={k} className="react-count" data-kind={k}>
                  <span aria-hidden="true">{REACTIONS[k].icon}</span>
                  <span className="num display">{tick?.reactions[k] ?? 0}</span>
                  <span className="faint">{REACTIONS[k].label}</span>
                </div>
              ))}
            </div>
            <h3 style={{ margin: '16px 0 8px' }}>Questions</h3>
            {feed.questions.length === 0 ? (
              <p className="empty">No questions yet.</p>
            ) : (
              <ul className="feed">
                {feed.questions.slice(0, 6).map((q, i) => (
                  <li key={i}>
                    <span className="faint num">{fmtTime(q.t)}</span> {q.text ?? <em className="dim">(raised a hand)</em>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel dash-spikes" aria-labelledby="spikes-h">
            <div className="panel-head">
              <h2 id="spikes-h">Lost moments</h2>
            </div>
            {feed.spikes.length === 0 ? (
              <p className="empty">None yet. Sharp attention drops, confusion, or "Lost me" bursts show up here.</p>
            ) : (
              <ul className="feed">
                {[...feed.spikes].reverse().slice(0, 6).map((sp) => (
                  <li key={sp.id}>
                    <span className="faint num">{fmtTime(sp.t)}</span> <strong>{sp.text}</strong>
                    {sp.transcript && <div className="dim quote">“{sp.transcript.slice(-140)}”</div>}
                  </li>
                ))}
              </ul>
            )}
            <h3 style={{ margin: '16px 0 8px' }}>Recent nudges</h3>
            {feed.nudges.length === 0 ? (
              <p className="empty">No nudges yet.</p>
            ) : (
              <ul className="feed">
                {feed.nudges.slice(0, 5).map((n) => (
                  <li key={n.id}>
                    <span className="faint num">{fmtTime(n.t)}</span> <span className="chip">{CATEGORY_LABEL[n.category]}</span> {n.text}
                    <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {n.why}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel dash-transcript" aria-labelledby="tr-h">
            <div className="panel-head">
              <h2 id="tr-h">Transcript</h2>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {tick && tick.speech.paceSource !== 'none' ? `pace via ${tick.speech.paceSource}` : ''}
              </span>
            </div>
            <div className="transcript-ticker" aria-live="off">
              {feed.transcript.slice(-6).map((seg) => (
                <p key={seg.id}>
                  <span className="faint num">{fmtTime(seg.t0)}</span> {seg.text}
                </p>
              ))}
              {!feed.transcript.length && <p className="empty">Speech appears here during the session.</p>}
            </div>
          </section>
        </div>
      </main>
      <Toasts items={toasts} />
    </div>
  );
}

function JoinPanel({ session, config }: { session: SessionInfo; config: ServerConfig | null }) {
  const base = shareBase(config);
  const items = [
    { label: 'Presenter camera', path: `/camera?role=presenter&s=${session.code}`, count: session.nodes.presenter, hint: 'Faces you' },
    { label: 'Audience camera', path: `/camera?role=audience&s=${session.code}`, count: session.nodes.audience, hint: 'Faces the room' },
    { label: 'Audience phones', path: `/join?s=${session.code}`, count: session.nodes.phones, hint: 'Anonymous reactions' },
    { label: 'Confidence monitor', path: `/monitor?s=${session.code}`, count: session.nodes.monitors, hint: 'Screen facing you' },
  ];
  const insecure = base.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(base);
  return (
    <section className="panel" aria-labelledby="join-h">
      <div className="panel-head">
        <h2 id="join-h">Connect devices</h2>
        <IntegrationChips config={config} />
      </div>
      <div className="join-grid">
        {items.map((it) => (
          <div key={it.label} className="join-card">
            <Qr url={`${base}${it.path}`} label={it.label} />
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <strong>{it.label}</strong>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {it.hint}
              </span>
              <span className={`chip ${it.count ? 'chip-good' : ''}`} style={{ alignSelf: 'flex-start' }}>
                <span className="dot" aria-hidden="true" />
                {it.count ? `${it.count} connected` : 'waiting'}
              </span>
              <a className="join-link mono" href={it.path} target="_blank" rel="noreferrer">
                Open on this device
              </a>
            </div>
          </div>
        ))}
      </div>
      {insecure && (
        <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 12 }}>
          Phone cameras need HTTPS. Run <span className="kbd">npm run dev:lan</span> or set PUBLIC_URL to a tunnel. Reaction buttons work over plain HTTP.
        </p>
      )}
    </section>
  );
}

function Qr({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#0b0d12', light: '#ffffff' } }).then(setSrc).catch(() => {});
  }, [url]);
  return src ? <img src={src} width={120} height={120} alt={`QR code for ${label}`} className="qr" /> : <div className="qr" />;
}

function IntegrationChips({ config }: { config: ServerConfig | null }) {
  if (!config) return null;
  const chips: [string, boolean, string][] = [
    ['Whisper', config.whisper === 'ready', config.whisper],
    ['Storage', config.storage === 'neon', config.storage === 'neon' ? 'Neon' : 'local'],
    ['Recordings', config.blobs === 's3', config.blobs === 's3' ? 'S3' : 'local'],
    ['Coach', config.coach !== 'template', config.coach],
  ];
  return (
    <div className="row" style={{ gap: 6 }} aria-label="Integrations">
      {chips.map(([k, ok, v]) => (
        <span key={k} className={`chip ${ok ? 'chip-good' : 'chip-warn'}`} title={ok ? 'connected' : 'fallback in use'}>
          <span className="dot" aria-hidden="true" />
          {k}: {v}
        </span>
      ))}
    </div>
  );
}
