import { useEffect, useState, type ReactNode } from 'react';
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

  const startLabel = busy === 'live' ? 'Creating…' : 'Start a live session';

  return (
    <div className="home-page">
      <div className="home-wrap">
        <TopBar
          nav={
            <>
              <Link to="/account">My Videos</Link>
              <a href="#how">How it Works</a>
              <a href="#modes">Features</a>
              <a href="#join">Join a Session</a>
            </>
          }
        >
          <ThemeToggle />
        </TopBar>
      </div>

      <main id="main">
        <div className="home-wrap">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <h1 id="hero-title" className="hero-title">Find your voice.<br />Feel the room.</h1>
              <p className="hero-tagline">A Calmer Way to Present.</p>
            </div>
            <DotCluster />
          </section>

          <p className="hero-panel">
            Stay connected to your audience with gentle, real-time coaching. Practice your delivery, find your rhythm, and make every word count.
          </p>

          <div className="hero-actions">
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => create('live')} disabled={!!busy}>{startLabel}</button>
              <Link className="btn btn-outline btn-lg" to="/practice">Practice solo</Link>
            </div>
            <p className="hero-note">Sign in to save your sessions. Record only when you choose.</p>
            <details className="quick-setup">
              <summary>Using two webcams on one laptop?</summary>
              <button className="linklike" onClick={() => create('quick')} disabled={!!busy}>Open all three views at once</button>
            </details>
            {error && <p role="alert" className="home-error">{error}</p>}
          </div>
        </div>

        <section id="modes" className="mode-band" aria-labelledby="modes-h">
          <Wave />
          <div className="mode-band-body">
            <div className="home-wrap">
              <p id="modes-h" className="mode-eyebrow">Choose your mode</p>
              <div className="mode-grid">
                <ModeCard
                  icon={<CameraIcon />}
                  title="Live Session"
                  subtitle="With a real audience"
                  body="Host a session with live attendees. Share a room code and get real-time feedback on your pacing, engagement, and delivery as you speak."
                  points={['Real-time audience reactions from phones', 'Room map and Confidence Monitor nudges', 'Post-session report and synced replay']}
                  action={<button className="btn btn-light" onClick={() => create('live')} disabled={!!busy}>{startLabel}</button>}
                />
                <ModeCard
                  icon={<MicIcon />}
                  title="Solo Practice"
                  subtitle="Just you and your camera"
                  body="Rehearse at your own pace in front of a virtual audience that reacts to your delivery, then get calm, actionable coaching notes."
                  points={['Eye contact and posture prompts', 'Pacing and filler-word highlights', 'Saved recordings in My Videos']}
                  action={<Link className="btn btn-light" to="/practice">Practice solo</Link>}
                />
              </div>
            </div>
          </div>
          <Wave flip />
        </section>

        <div className="home-wrap home-sections">
          <section id="how" className="how" aria-labelledby="how-h">
            <div className="section-head">
              <h2 id="how-h">How CrowdSense works</h2>
              <p className="dim">From your first practice to your next presentation, build confidence in three simple steps.</p>
            </div>
            <ol className="how-grid">
              <li className="how-card">
                <span className="how-step">Step 1</span>
                <h3>Set up your space</h3>
                <p>Allow camera and microphone access. CrowdSense calibrates to your posture and voice before you begin.</p>
              </li>
              <li className="how-card">
                <span className="how-step">Step 2</span>
                <h3>Speak naturally</h3>
                <p>Host a live session or rehearse solo. CrowdSense watches quietly and shows one gentle nudge at a time.</p>
              </li>
              <li className="how-card">
                <span className="how-step">Step 3</span>
                <h3>Review your coaching</h3>
                <p>Get a clear summary after your session: pacing insights, engagement notes, and next steps to keep improving.</p>
              </li>
            </ol>
          </section>

          <form
            id="join"
            className="join-box"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) nav(`/join?s=${code.trim().toUpperCase()}`);
            }}
          >
            <div className="stack">
              <p className="eyebrow">Room code</p>
              <h2>Join a live session</h2>
              <p className="dim">Enter the code your host shared with you. No account needed.</p>
            </div>
            <div className="join-controls">
              <label className="sr-only" htmlFor="join-code">Room code</label>
              <input id="join-code" type="text" placeholder="Room code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} autoCapitalize="characters" required />
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
              <p className="eyebrow">Private by design</p>
              <h2>Your space to improve.</h2>
              <p className="dim">Video analysis stays on your device. No face recognition. Recording is always your choice.</p>
            </aside>
          </section>
        </div>
      </main>

      <footer className="home-footer">
        <div className="home-wrap">
          <div className="footer-top">
            <div className="stack footer-brand">
              <span className="brand">CrowdSense</span>
              <span className="footer-tag">A calmer way to present.</span>
            </div>
            <nav className="footer-links" aria-label="Footer">
              <a href="#modes">Features</a>
              <a href="#how">How it Works</a>
              <Link to="/account">My Videos</Link>
              <a href="#join">Join a Session</a>
            </nav>
          </div>
          <div className="footer-bottom mono">
            <span>© CrowdSense {new Date().getFullYear()} · All Rights Reserved</span>
            <span>Made for speakers, by speakers.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ModeCard({ icon, title, subtitle, body, points, action }: { icon: ReactNode; title: string; subtitle: string; body: string; points: string[]; action: ReactNode }) {
  return (
    <article className="mode-card">
      <div className="mode-title">
        <span className="mode-icon" aria-hidden="true">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <p className="mode-body">{body}</p>
      <ul className="mode-points">{points.map((p) => <li key={p}>{p}</li>)}</ul>
      {action}
    </article>
  );
}

/** Decorative audience: a tilted grid of dots, some attentive (solid) and some drifting (soft). */
function DotCluster() {
  const soft = new Set(['0-0', '1-0', '2-1', '2-3', '3-4', '4-2', '4-4', '5-0', '5-3', '6-1', '1-5', '3-6']);
  const dots: { x: number; y: number; soft: boolean; i: number }[] = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 7; c++) {
      if ((r === 0 && c === 6) || (r === 6 && c === 0)) continue;
      dots.push({ x: 40 + c * 34 + r * -6, y: 40 + r * 34 + c * 8, soft: soft.has(`${r}-${c}`), i: r + c });
    }
  return (
    <svg className="dot-cluster" viewBox="0 0 280 320" aria-hidden="true">
      {dots.map((d) => (
        <circle key={`${d.x}-${d.y}`} className="hero-dot" cx={d.x} cy={d.y} r={12} fill={d.soft ? 'var(--brand-soft)' : 'var(--brand)'} style={{ animationDelay: `${d.i * 40}ms` }} />
      ))}
    </svg>
  );
}

function Wave({ flip = false }: { flip?: boolean }) {
  return (
    <svg className={flip ? 'wave wave-bottom' : 'wave'} viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 28 C 300 4 560 4 840 16 C 1080 26 1280 30 1440 18 L1440 56 L0 56 Z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5 21 7.5v9l-5-3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
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
