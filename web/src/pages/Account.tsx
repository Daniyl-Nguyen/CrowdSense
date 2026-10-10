import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { TopBar } from '../ui/components.tsx';

type User = { sub: string; email: string };
type Video = { id: string; sessionId: string; title: string; createdAt: number; role: string; status: string; durationMs: number | null; url: string | null };
export default function Account() {
  const [params] = useSearchParams();
  const [auth, setAuth] = useState<{ user: User | null; configured: boolean } | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(params.has('error') ? 'Sign-in could not be completed. Please try again and verify your email.' : '');
  useEffect(() => { api.get<{ user: User | null; configured: boolean }>('/api/auth/me').then(setAuth).catch(e => { setError(e.message); setLoading(false); }); }, []);
  useEffect(() => {
    if (!auth) return;
    if (!auth.user) { setLoading(false); return; }
    let active = true;
    const refresh = () => api.get<{ videos: Video[] }>('/api/me/videos').then(data => { if (active) { setVideos(data.videos); setLoading(false); } }).catch(e => { if (active) { setError(e.message); setLoading(false); } });
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => { active = false; clearInterval(timer); };
  }, [auth]);
  const next = params.get('next') || '/account';
  const login = '/api/auth/login?next=' + encodeURIComponent(next);
  return <div className="shell">
    <TopBar title="Your account" />
    <main id="main" className="stack" style={{ padding: '48px 0', gap: 28 }}>
      {error && <p role="alert" style={{ color: 'var(--alert)' }}>{error}</p>}
      {!auth ? <p>Loading your account…</p> : !auth.user ? <section className="panel stack" style={{ maxWidth: 660, padding: 40, gap: 20 }}>
        <p className="eyebrow">Your own presentation library</p>
        <h1>Keep your best takes.</h1>
        <p className="dim">Create an account to save your recordings privately, revisit your sessions, and watch your progress from any device.</p>
        {auth.configured ? <div className="row"><a className="btn btn-primary" href={login + '&signup=1'}>Create account</a><a className="btn" href={login}>Sign in</a></div> : <p>Account sign-in hasn’t been configured on this server.</p>}
        <p className="faint">Already registered? Sign in above. You can reset a forgotten password on the sign-in page.</p>
      </section> : <>
        <div className="row" style={{ flexWrap: 'wrap' }}><div className="stack"><p className="eyebrow">Private library</p><h1>My videos</h1><p className="dim">{auth.user.email}</p></div><span className="spacer" /><Link className="btn btn-primary" to="/">New session</Link><button className="btn" onClick={async () => { try { const result = await api.post<{url: string}>('/api/auth/logout', {}); window.location.assign(result.url); } catch (e) { setError((e as Error).message); } }}>Sign out</button></div>
        <p className="dim">Turn on Record video during a session. After stopping, keep each camera tab open until its upload finishes. Recordings appear here automatically.</p>
        {next !== '/account' && <a className="btn btn-primary" style={{ alignSelf: 'flex-start' }} href={/^\/(?!\/)[\w/?=&%-]*$/.test(next) ? next : '/'}>Continue to your session</a>}
        {loading ? <p>Loading videos…</p> : videos.length === 0 ? <div className="panel stack" style={{ padding: 32 }}><h2>Your first recording starts here.</h2><p className="dim">Start a session, connect a camera, and enable recording from your signed-in dashboard.</p><Link className="btn" style={{ alignSelf: 'flex-start' }} to="/">Start presenting</Link></div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24 }}>
          {videos.map(video => <article className="panel stack" key={video.id} style={{ padding: 20, gap: 12 }}>
            {video.url ? <video controls preload="metadata" src={video.url} style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 12, background: '#15121d' }} /> : <div className="empty" style={{ aspectRatio: '16 / 9' }}>{video.status === 'failed' ? 'Upload failed' : 'Recording / uploading…'}</div>}
            <h2>{video.title}</h2><p className="dim">{video.role === 'presenter' ? 'Presenter camera' : 'Audience camera'} · {new Date(video.createdAt).toLocaleDateString()}{video.durationMs ? ` · ${Math.round(video.durationMs / 1000)}s` : ''}</p>
            <p className="faint">{video.status === 'ready' ? 'Saved privately' : video.status}</p>
            {video.url && <div className="row"><Link className="btn" to={`/replay/${video.sessionId}`}>Synced replay</Link><a className="btn" href={video.url} target="_blank" rel="noreferrer">Open video ↗</a></div>}
          </article>)}
        </div>}
      </>}
    </main>
  </div>;
}
