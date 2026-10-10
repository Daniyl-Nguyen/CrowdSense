import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type HistoryRow } from '../lib/api.ts';
import { TopBar } from '../ui/components.tsx';

export function Home() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    api.history().then(setHistory).catch(() => setHistory([]));
  }, []);

  async function create(kind: 'live' | 'quick') {
    setBusy(kind);
    setError(null);
    try {
      const s = await api.createSession('live');
      if (kind === 'quick') {
        // One laptop: open the audience cam and dashboard in new tabs, presenter cam here.
        window.open(`/camera?role=audience&s=${s.code}`, '_blank');
        window.open(`/dashboard?s=${s.code}`, '_blank');
        nav(`/camera?role=presenter&s=${s.code}`);
      } else nav(`/dashboard?s=${s.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="shell">
      <TopBar>
        <ThemeToggle />
      </TopBar>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Live presentation coaching</p>
            <h1 className="hero-title">
              Read the <span className="spot">room</span>
              <br />
              while you speak.
            </h1>
            <p className="hero-sub">
              One camera on you and one on your audience, both analyzed privately in the browser. You get one quiet
              nudge at a time, then a report and a synced replay afterward.
            </p>
            <div className="row" style={{ marginTop: 'var(--sp-5)' }}>
              <button className="btn btn-primary btn-lg" onClick={() => create('live')} disabled={!!busy}>
                {busy === 'live' ? 'Creating…' : 'Start a live session'}
              </button>
              <Link className="btn btn-lg" to="/practice">
                Practice solo
              </Link>
            </div>
            <p className="faint" style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
              One laptop, two webcams?{' '}
              <button className="linklike" onClick={() => create('quick')} disabled={!!busy}>
                Open all three views at once
              </button>
            </p>
            {error && <p style={{ color: 'var(--alert)' }}>{error}</p>}
          </div>
          <HeroArt />
        </section>

        <section className="home-grid">
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) nav(`/join?s=${code.trim().toUpperCase()}`);
            }}
          >
            <h2>In the audience?</h2>
            <p className="dim">Enter the room code to send anonymous reactions. No sign-up.</p>
            <div className="row">
              <label className="sr-only" htmlFor="join-code">
                Room code
              </label>
              <input
                id="join-code"
                type="text"
                placeholder="ROOM"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={8}
                autoCapitalize="characters"
                style={{ flex: 1, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em', textTransform: 'uppercase' }}
              />
              <button className="btn btn-primary" type="submit">
                Join
              </button>
            </div>
          </form>

          <div className="panel stack">
            <h2>Your past sessions</h2>
            {history == null ? (
              <p className="empty">Loading…</p>
            ) : history.length === 0 ? (
              <p className="empty">No sessions yet. Your history is tied to this browser only, with no account.</p>
            ) : (
              <ul className="history">
                {history.slice(0, 8).map((h) => (
                  <li key={h.id}>
                    <Link to={h.hasReport ? `/report/${h.id}` : '#'} aria-disabled={!h.hasReport}>
                      <span>
                        <strong>{h.title}</strong>
                        <span className="faint"> · {new Date(h.createdAt).toLocaleString()}</span>
                      </span>
                      <span className="history-score num">{h.score != null ? h.score : h.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel stack">
            <h2>Privacy by design</h2>
            <ul className="checklist">
              <li>Vision runs on-device. Video never streams to other devices.</li>
              <li>No face recognition. Anonymous dots with per-session IDs.</li>
              <li>Recording is opt-in and always shows a REC indicator.</li>
              <li>Results are engagement estimates, not emotion reading.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  return (
    <button
      className="btn btn-sm"
      aria-pressed={theme === 'light'}
      onClick={() => {
        const next = theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('rtr.theme', JSON.stringify(next));
        } catch {
          /* ignore */
        }
        setTheme(next);
      }}
    >
      {theme === 'light' ? 'Dark stage' : 'Projector (light)'}
    </button>
  );
}

function HeroArt() {
  // A stylized room map: anonymous dots in rows under a spotlight.
  const dots: { x: number; y: number; s: 'attentive' | 'down' | 'away' }[] = [];
  const pattern = 'aaadaaaawaaadaaaaaa';
  let k = 0;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5 - (row === 0 ? 1 : 0); col++) {
      const c = pattern[k++ % pattern.length];
      dots.push({ x: 60 + col * 70 + (row === 0 ? 35 : 0) + (row % 2) * 8, y: 120 + row * 58, s: c === 'd' ? 'down' : c === 'w' ? 'away' : 'attentive' });
    }
  return (
    <svg className="hero-art" viewBox="0 0 420 380" role="img" aria-label="Illustration: a room map with anonymous dots for audience members">
      <defs>
        <radialGradient id="spot" cx="50%" cy="0%" r="90%">
          <stop offset="0" stopColor="var(--spot)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--spot)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M210 0 L410 380 H10 Z" fill="url(#spot)" />
      <rect x="20" y="90" width="380" height="260" rx="22" fill="none" stroke="var(--line-strong)" strokeDasharray="4 6" />
      <line x1="146" y1="96" x2="146" y2="344" stroke="var(--line)" />
      <line x1="273" y1="96" x2="273" y2="344" stroke="var(--line)" />
      {dots.map((d, i) => (
        <g key={i} className="hero-dot" style={{ animationDelay: `${i * 90}ms` }}>
          {d.s === 'attentive' && <circle cx={d.x} cy={d.y} r="11" fill="var(--st-attentive)" />}
          {d.s === 'down' && <path d={`M${d.x - 11} ${d.y - 8} h22 l-11 19 z`} fill="var(--st-down)" />}
          {d.s === 'away' && <circle cx={d.x} cy={d.y} r="9" fill="none" stroke="var(--st-away)" strokeWidth="4" />}
        </g>
      ))}
      <rect x="150" y="30" width="120" height="34" rx="17" fill="var(--ink-2)" stroke="var(--line-strong)" />
      <text x="210" y="52" textAnchor="middle" fill="var(--text)" fontFamily="var(--font-display)" fontWeight="700" fontSize="15">
        You · 84% with you
      </text>
    </svg>
  );
}
