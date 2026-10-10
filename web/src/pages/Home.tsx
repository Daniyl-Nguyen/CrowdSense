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
    <div className="shell home-shell">
      <TopBar>
        <span className="studio-tagline">Your presentation studio</span>
        <ThemeToggle />
      </TopBar>
      <main id="main" className="home-main">
        <section className="hero">
          <SessionPreview />
          <div className="hero-copy">
            <p className="eyebrow">A calmer way to present</p>
            <h1 className="hero-title">Find your voice.<br />Feel the room.</h1>
            <p className="hero-sub">Stay connected to your audience with gentle, real-time coaching. Practice your delivery, find your rhythm, and make every word count.</p>
            <div className="row hero-actions">
              <button className="btn btn-primary btn-lg" onClick={() => create('live')} disabled={!!busy}>
                {busy === 'live' ? 'Creating…' : 'Start a live session'}
              </button>
              <Link className="btn btn-lg" to="/practice">Practice solo</Link>
            </div>
            <p className="hero-note">No account needed. Your camera stays in your browser.</p>
            <details className="quick-setup">
              <summary>Using two webcams on one laptop?</summary>
              <button className="linklike" onClick={() => create('quick')} disabled={!!busy}>Open all three views at once</button>
            </details>
            {error && <p role="alert" style={{ color: 'var(--alert)' }}>{error}</p>}
          </div>
        </section>
        <form className="panel home-join" onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) nav(`/join?s=${code.trim().toUpperCase()}`);
        }}>
          <div className="stack">
            <h2>Here for someone else’s talk?</h2>
            <p className="dim">Join the audience with your room code. No sign-up.</p>
          </div>
          <div className="join-controls">
            <label className="sr-only" htmlFor="join-code">Room code</label>
            <input id="join-code" type="text" placeholder="ROOM CODE" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} autoCapitalize="characters" required />
            <button className="btn btn-primary" type="submit">Join</button>
          </div>
        </form>
        <section className="home-bottom">
          <div className="stack home-history">
            <h2>Your recent sessions</h2>
            <div className="panel">
              {history == null ? <p className="dim">Loading your sessions…</p> : history.length === 0 ? (
                <div className="stack"><h3>Your progress starts here.</h3><p className="dim">Complete your first session to see your insights and replay.</p></div>
              ) : (
                <ul className="history">{history.slice(0, 8).map((h) => (
                  <li key={h.id}><Link to={h.hasReport ? `/report/${h.id}` : '#'} aria-disabled={!h.hasReport}>
                    <span><strong>{h.title}</strong><span className="history-date faint">{new Date(h.createdAt).toLocaleString()}</span></span>
                    <span className="history-score num">{h.score != null ? h.score : h.status}</span>
                  </Link></li>
                ))}</ul>
              )}
            </div>
          </div>
          <aside className="stack home-privacy">
            <h2>Your space to improve.</h2>
            <p className="dim">Video analysis stays on your device. No face recognition. Recording is always your choice.</p>
            <p className="eyebrow">Private by design</p>
          </aside>
        </section>
      </main>
    </div>
  );
}

function SessionPreview() {
  return (
    <aside className="panel session-preview" aria-label="Illustrative session preview">
      <div className="preview-header"><h2>Your room, at a glance</h2><span className="preview-live">● LIVE</span></div>
      <div className="preview-score"><span className="display num">84%</span><p>of the room<br />is with you</p></div>
      <div className="preview-room" aria-label="Example audience engagement map">
        <span>Front of room</span>
        {[1, 2, 3].map((row) => <img key={row} src={`/design/audience-row-${row}.svg`} width="192" height="12" alt="" />)}
        <p>● Attentive &nbsp; ○ Looking away</p>
      </div>
      <div className="preview-coaching"><span>One small adjustment</span><p>Pause. Let your last point land.</p></div>
      <p className="preview-caption">Illustrative preview · engagement estimates</p>
    </aside>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light');
  return (
    <button
      className="btn btn-sm theme-toggle"
      aria-pressed={theme === 'dark'}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
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
      {theme === 'light' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
