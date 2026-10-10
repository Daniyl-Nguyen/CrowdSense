// Audience phone: anonymous reactions, no sign-up. One tap per 10 s (enforced server-side too).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReactionKind, ServerMsg } from '@shared/types.ts';
import { REACTION_RATE_LIMIT_MS } from '@shared/thresholds.ts';
import { useRoom } from '../lib/socket.ts';
import { REACTIONS } from '../ui/reactions.tsx';
import { BrandMark } from '../ui/components.tsx';

export default function Join() {
  const [params, setParams] = useSearchParams();
  const code = params.get('s')?.toUpperCase() ?? null;
  const [entry, setEntry] = useState('');
  if (!code)
    return (
      <div className="phone">
        <header className="phone-head">
          <BrandMark size={32} />
          <h1>Join a room</h1>
        </header>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (entry.trim()) setParams({ s: entry.trim().toUpperCase() });
          }}
        >
          <label className="field">
            Room code
            <input type="text" value={entry} onChange={(e) => setEntry(e.target.value)} maxLength={8} autoCapitalize="characters" autoFocus className="code-input" />
          </label>
          <button className="btn btn-primary btn-lg" type="submit">
            Join
          </button>
        </form>
      </div>
    );
  return <Reactions code={code} />;
}

function Reactions({ code }: { code: string }) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sent, setSent] = useState<ReactionKind | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const room = useRoom(code, 'phone', (m: ServerMsg) => {
    if (m.type === 'reaction.limited') setUntil(Date.now() + m.retryInMs);
  });
  useEffect(() => {
    if (until <= now) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [until, now]);
  const wait = Math.max(0, until - now);

  function send(kind: ReactionKind, text?: string) {
    if (wait > 0 || !room.socket) return;
    room.socket.send({ type: 'reaction', kind, text });
    setUntil(Date.now() + REACTION_RATE_LIMIT_MS);
    setNow(Date.now());
    setSent(kind);
    navigator.vibrate?.(30);
    window.setTimeout(() => setSent(null), 1800);
  }

  const status = room.session?.status;
  return (
    <div className="phone">
      <header className="phone-head">
        <BrandMark size={32} />
        <div>
          <h1 style={{ fontSize: '1.3rem' }}>{room.session?.title ?? 'Connecting…'}</h1>
          <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            Room {code} · {status === 'live' ? 'live now' : status === 'ended' ? 'ended' : 'starting soon'} · anonymous
          </p>
        </div>
      </header>
      {room.error && <p style={{ color: 'var(--alert)' }}>{room.error}</p>}
      <div className="react-grid" role="group" aria-label="Send an anonymous reaction">
        {(Object.keys(REACTIONS) as ReactionKind[]).map((k) => (
          <button
            key={k}
            className="react-btn"
            data-kind={k}
            disabled={wait > 0 || status === 'ended'}
            aria-pressed={sent === k}
            onClick={() => (k === 'question' ? setAsking(true) : send(k))}
          >
            {REACTIONS[k].icon}
            <span className="react-label">{REACTIONS[k].label}</span>
            <span className="react-hint">{REACTIONS[k].hint}</span>
          </button>
        ))}
      </div>
      <div className="phone-status" role="status" aria-live="polite">
        {sent ? (
          <strong>Sent: {REACTIONS[sent].label}. Thanks!</strong>
        ) : wait > 0 ? (
          <span>
            Next reaction in <span className="num">{Math.ceil(wait / 1000)}s</span>
          </span>
        ) : (
          <span className="dim">Tap to let the speaker know, privately and anonymously.</span>
        )}
        {wait > 0 && (
          <div className="meter" style={{ marginTop: 8 }} aria-hidden="true">
            <span style={{ width: `${(wait / REACTION_RATE_LIMIT_MS) * 100}%`, transition: 'none' }} />
          </div>
        )}
      </div>
      {asking && (
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            send('question', question);
            setQuestion('');
            setAsking(false);
          }}
        >
          <label className="field">
            Your question (optional, anonymous)
            <textarea rows={3} maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} autoFocus />
          </label>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={wait > 0}>
              Send question
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'auto' }}>
        No account, no name. Your phone gets a random ID that only rate-limits taps.
      </p>
    </div>
  );
}
