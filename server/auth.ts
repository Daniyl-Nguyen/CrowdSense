import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { IncomingMessage } from 'node:http';
import { config } from './config.ts';

export type Account = { sub: string; email: string };
const domain = process.env.COGNITO_DOMAIN;
const clientId = process.env.COGNITO_CLIENT_ID;
export const authEnabled = !!(domain && clientId && config.publicUrl);
const origin = config.publicUrl?.replace(/\/$/, '') ?? 'http://localhost:5173';
const secure = origin.startsWith('https:');
const secretFile = path.join(config.dataDir, 'auth-secret');
fs.mkdirSync(config.dataDir, { recursive: true });
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
const secret = fs.readFileSync(secretFile);
function seal(value: object, seconds: number) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ ...value, exp: Date.now() + seconds * 1000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
function open(value: string | undefined): any {
  try {
    const data = Buffer.from(value ?? '', 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secret, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}
function cookie(req: IncomingMessage, name: string) {
  return req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
}
const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
export function account(req: IncomingMessage): Account | null {
  const value = open(cookie(req, 'rtr_account'));
  return value?.kind === 'account' && typeof value.sub === 'string' && typeof value.email === 'string' ? { sub: value.sub, email: value.email } : null;
}
export const ownerId = (user: Account) => `account:${user.sub}`;
export const owns = (req: IncomingMessage, presenterId: string) => {
  const user = account(req);
  return !!user && ownerId(user) === presenterId;
};
export function uploadToken(sessionId: string, role: string) { return seal({ kind: 'upload', sessionId, role }, 86400); }
export function canUpload(req: Request, sessionId: string, role: string, presenterId: string) {
  if (owns(req, presenterId)) return true;
  const token = open(req.get('x-recording-token'));
  return token?.kind === 'upload' && token.sessionId === sessionId && token.role === role;
}
export function authRoutes() {
  const r = Router();
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  r.get('/me', (req, res) => res.json({ user: account(req), configured: authEnabled }));
  r.get('/login', (req, res) => {
    if (!authEnabled) return res.status(503).send('Account sign-in is not configured.');
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const next = typeof req.query.next === 'string' && /^\/(?!\/)[\w/?=&%-]*$/.test(req.query.next) ? req.query.next : '/account';
    res.cookie('rtr_login', seal({ kind: 'login', state, verifier, next }, 600), { ...cookieOptions, maxAge: 600000 });
    const url = new URL(`https://${domain}/${req.query.signup === '1' ? 'signup' : 'oauth2/authorize'}`);
    url.search = new URLSearchParams({ client_id: clientId!, response_type: 'code', scope: 'openid email profile', redirect_uri: `${origin}/api/auth/callback`, state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }).toString();
    res.redirect(url.toString());
  });
  r.get('/callback', async (req, res) => {
    const login = open(cookie(req, 'rtr_login'));
    res.clearCookie('rtr_login', cookieOptions);
    if (!authEnabled || login?.kind !== 'login' || login.state !== req.query.state || typeof req.query.code !== 'string') return res.redirect('/account?error=signin');
    try {
      const response = await fetch(`https://${domain}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId!, code: req.query.code, redirect_uri: `${origin}/api/auth/callback`, code_verifier: login.verifier }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Token exchange failed');
      const tokens = await response.json() as { access_token: string };
      const identity = await fetch(`https://${domain}/oauth2/userInfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000) });
      if (!identity.ok) throw new Error('Identity lookup failed');
      const user = await identity.json() as { sub: string; email: string; email_verified: boolean | string };
      if (!user.sub || !user.email || ![true, 'true'].includes(user.email_verified)) throw new Error('Verified email required');
      res.cookie('rtr_account', seal({ kind: 'account', sub: user.sub, email: user.email }, 86400), { ...cookieOptions, maxAge: 86400000 });
      res.redirect(login.next);
    } catch { res.redirect('/account?error=signin'); }
  });
  r.post('/logout', (_req, res) => {
    res.clearCookie('rtr_account', cookieOptions);
    res.json({ url: authEnabled ? `https://${domain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(origin + '/account')}` : '/account' });
  });
  return r;
}
