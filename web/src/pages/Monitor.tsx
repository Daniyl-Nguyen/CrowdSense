// Confidence Monitor: the presenter-facing screen. One nudge at a time, huge and high-contrast,
// with a slim status strip. Optional spoken nudges (browser speech, or ElevenLabs if configured).
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReactionKind, ServerMsg } from '@shared/types.ts';
import { SPEECH } from '@shared/thresholds.ts';
import { useRoom } from '../lib/socket.ts';
import { pref, setPref } from '../lib/ids.ts';
import { NudgeCard, fmtTime } from '../ui/components.tsx';
import { useSessionClock } from '../ui/live.tsx';
import { useBackfill, useLiveFeed } from '../lib/feed.ts';
import { REACTIONS } from '../ui/reactions.tsx';

export default function Monitor() {
  const [params] = useSearchParams();
  const code = params.get('s')?.toUpperCase() ?? '';
  const feed = useLiveFeed();
  const [speak, setSpeak] = useState<boolean>(pref('speakNudges', false));
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const room = useRoom(code || null, 'monitor', (m: ServerMsg) => {
    feed.onMsg(m);
    if (m.type === 'nudge') {
      if (speakRef.current) void say(m.nudge.text);
    }
  });
  useBackfill(room.session, feed);
  const elapsed = useSessionClock(room.session, room.socket);
  const t = room.tick;
  const att = t?.audience?.attention;
  const p = t?.presenter;
  const wpm = t?.speech.wpm;

  useEffect(() => {
    document.title = 'Confidence Monitor · CrowdSense';
  }, []);

  return (
    <div className="monitor">
      <main id="main" className="monitor-main">
        <section className="monitor-coaching" aria-label="Live coaching">
        <NudgeCard
          nudge={feed.latestNudge}
          idle={
            <div className="monitor-idle">
              <span className="monitor-idle-num num" style={{ color: att == null ? 'var(--text-dim)' : att < 0.5 ? 'var(--alert)' : att < 0.7 ? 'var(--warn)' : 'var(--good)' }}>
                {att != null ? `${Math.round(att * 100)}%` : '—'}
              </span>
              <span className="monitor-idle-label">{att != null ? 'of the room is with you' : room.session?.status === 'live' ? 'Waiting for the audience camera' : 'Ready when you are'}</span>
              <span className="faint">No nudges right now. Keep going.</span>
            </div>
          }
        />
        </section>
        <aside className="panel monitor-feedback" aria-labelledby="monitor-feedback-title">
          <div className="stack">
            <h2 id="monitor-feedback-title">Audience reactions</h2>
            <p className="dim monitor-feedback-meta">{room.session?.nodes.phones ?? 0} connected · last 60 seconds</p>
          </div>
          <div className="react-counts" aria-label="Audience reaction counts">
            {(Object.keys(REACTIONS) as ReactionKind[]).map((kind) => (
              <div key={kind} className="react-count" data-kind={kind}>
                <span aria-hidden="true">{REACTIONS[kind].icon}</span>
                <span className="num display">{t?.reactions[kind] ?? 0}</span>
                <span className="dim">{REACTIONS[kind].label}</span>
              </div>
            ))}
          </div>
          <section className="monitor-questions" aria-labelledby="monitor-questions-title">
            <h3 id="monitor-questions-title">Latest questions</h3>
            <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Audience questions">
              {feed.questions.length ? (
                <ul className="monitor-question-list">
                  {feed.questions.slice(0, 3).map((q, i) => (
                    <li key={`${q.t}-${q.text}-${i}`}>
                      <span className="faint num">{fmtTime(q.t)}</span>
                      <p>{q.text || 'Someone has a question.'}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="dim monitor-questions-empty">Questions from audience phones will appear here.</p>}
            </div>
          </section>
        </aside>
      </main>
      <footer className="monitor-strip" aria-label="Live status">
        <Cell label="Time" value={fmtTime(elapsed)} />
        <Cell label="Room" value={att != null ? `${Math.round(att * 100)}%` : '—'} level={att == null ? undefined : att < 0.5 ? 'alert' : att < 0.7 ? 'warn' : 'good'} />
        <Cell label="Pace" value={wpm != null ? `${wpm}` : '—'} unit="wpm" level={wpm == null ? undefined : wpm > SPEECH.wpmFast ? 'alert' : wpm > SPEECH.wpmIdealHigh ? 'warn' : 'good'} />
        <Cell
          label="Volume"
          value={p?.speaking ? `${p.volumeRel > 0 ? '+' : ''}${p.volumeRel.toFixed(0)}` : '—'}
          unit="dB"
          level={p?.speaking ? (p.volumeRel < -6 ? 'alert' : p.volumeRel < -3 ? 'warn' : 'good') : undefined}
        />
        <Cell label="Fillers" value={t ? t.speech.fillersPerMin.toFixed(0) : '—'} unit="/min" level={t ? (t.speech.fillersPerMin > SPEECH.fillersPerMinHigh ? 'alert' : 'good') : undefined} />
        <span className="monitor-spacer" />
        <label className="toggle">
          <input
            type="checkbox"
            checked={speak}
            onChange={(e) => {
              setSpeak(e.target.checked);
              setPref('speakNudges', e.target.checked);
              if (e.target.checked) void say('Spoken nudges on.');
            }}
          />
          Speak nudges
        </label>
        <span className={`chip ${room.session?.status === 'live' ? 'chip-alert' : ''}`}>
          <span className="dot" aria-hidden="true" />
          {room.session?.status ?? 'connecting'} · {code}
        </span>
      </footer>
    </div>
  );
}

function Cell({ label, value, unit, level }: { label: string; value: string; unit?: string; level?: 'good' | 'warn' | 'alert' }) {
  return (
    <div className="monitor-cell" data-level={level}>
      <span className="monitor-label">{label}</span>
      <span className="monitor-value num">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

let audio: HTMLAudioElement | null = null;
/** Speak a nudge: server TTS (ElevenLabs) if available, else the browser's own voice. */
async function say(text: string) {
  try {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (r.ok && r.headers.get('content-type')?.startsWith('audio')) {
      audio?.pause();
      audio = new Audio(URL.createObjectURL(await r.blob()));
      await audio.play();
      return;
    }
  } catch {
    /* fall through */
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
}
