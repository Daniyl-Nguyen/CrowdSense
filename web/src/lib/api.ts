import type { ServerConfig, SessionInfo, SessionMode } from '@shared/types.ts';
import { presenterId } from './ids.ts';

async function j<T>(res: Promise<Response>): Promise<T> {
  const r = await res;
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  config: () => j<ServerConfig>(fetch('/api/config')),
  createSession: async (mode: SessionMode, title?: string) => {
    const auth = await j<{user: unknown; configured: boolean}>(fetch('/api/auth/me'));
    if (auth.configured && !auth.user) {
      window.location.assign('/account?next=' + encodeURIComponent(mode === 'practice' ? '/practice' : '/dashboard'));
      throw new Error('Sign in to continue');
    }
    return j<SessionInfo>(
      fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ presenterId: presenterId(), mode, title }),
      }),
    );
  },
  liveSession: (code: string) => j<SessionInfo>(fetch(`/api/sessions/live/${encodeURIComponent(code)}`)),
  history: () => j<HistoryRow[]>(fetch(`/api/presenters/${presenterId()}/sessions`)),
  get: <T,>(path: string) => j<T>(fetch(path)),
  post: <T,>(path: string, body: unknown, headers: Record<string, string> = {}) =>
    j<T>(fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })),
};

export interface HistoryRow {
  id: string;
  title: string;
  mode: SessionMode;
  status: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  score: number | null;
  hasReport: boolean;
}

/** Base URL for links/QR codes that phones will open. Prefers a LAN/tunnel URL over localhost. */
export function shareBase(cfg: ServerConfig | null): string {
  const here = window.location.origin;
  if (!/localhost|127\.0\.0\.1/.test(here) || !cfg?.lanUrls.length) return here;
  return cfg.lanUrls[0];
}
