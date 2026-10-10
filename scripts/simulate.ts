// Drives a full room with no cameras: synthetic presenter + audience + phone reactions + speech.
// Useful for building/testing the dashboard, monitor, report and replay without hardware.
//   npm run simulate            → creates a session, prints the dashboard URL, runs 3 minutes
//   npm run simulate -- ABCD 120 → joins existing room ABCD for 120 s
import WebSocket from 'ws';
import type { AudienceFace, ClientMsg, PresenterSample } from '../shared/types.ts';
import { aggregateAudience } from '../shared/audience.ts';

const API = `http://localhost:${process.env.PORT ?? 8787}`;
const [codeArg, secsArg] = process.argv.slice(2);
const SECS = Number(secsArg ?? 180);

const LINES = [
  'So, um, today I want to talk about how we read a room while presenting.',
  'The idea is basically simple: you watch the audience, and they tell you what is working.',
  'Uh, here is the first chart, which, like, shows attention over time.',
  'You can see the drop right here, when I started reading off the slide.',
  'Now, you know, the fix is to stop and ask a question.',
  'Let me show you the room map, which uses anonymous dots instead of video.',
  'Each dot is an engagement estimate from head pose, not emotion reading.',
  'Um, so the right side of the room drifted for about a minute there.',
  'And that is when the monitor told me to look over there.',
  'To wrap up: one nudge at a time, and a report you can learn from.',
];

async function main() {
  let code = codeArg?.toUpperCase();
  if (!code) {
    const r = await fetch(`${API}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ presenterId: 'simulated-presenter-01', mode: 'live', title: 'Simulated talk' }),
    });
    code = (await r.json()).code as string;
  }
  console.log(`Room ${code}. Dashboard: http://localhost:5173/dashboard?s=${code}`);
  const connect = (role: string, id: string) =>
    new Promise<WebSocket>((resolve) => {
      const ws = new WebSocket(`${API.replace('http', 'ws')}/ws`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', role, code, clientId: id }));
        resolve(ws);
      });
    });
  const send = (ws: WebSocket, m: ClientMsg) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const pres = await connect('presenter-cam', 'sim-presenter');
  const aud = await connect('audience-cam', 'sim-audience');
  const phones = await Promise.all([1, 2, 3].map((i) => connect('phone', `sim-phone-${i}`)));

  send(pres, { type: 'presenter.baseline', baseline: { torsoRatio: 0.6, shoulderAngle: 0, faceToShoulder: 0.5, headYaw: 0, headPitch: 0, volumeDb: -28, noiseDb: -60, capturedAt: Date.now() } });
  await new Promise((r) => setTimeout(r, 1000));
  send(pres, { type: 'control', action: 'start' });

  // 16 seats; the right side drifts mid-talk, then recovers.
  const seats = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, x: 0.1 + (i % 4) * 0.27, y: 0.2 + Math.floor(i / 4) * 0.22 }));
  let screenRun = 0;
  for (let s = 0; s < SECS; s++) {
    const t = s * 1000;
    const phase = s / SECS;
    const lookingAtScreen = phase > 0.3 && phase < 0.45;
    screenRun = lookingAtScreen ? screenRun + 1 : 0;
    const p: PresenterSample = {
      t,
      present: true,
      slouch: phase > 0.6 && phase < 0.7 ? 0.2 : 0.03,
      shoulderTilt: 2,
      forwardHead: 0.05,
      sway: phase > 0.75 && phase < 0.85 ? 0.7 : 0.15,
      pacing: 1,
      fidget: 0.1,
      gaze: lookingAtScreen ? 'screen' : 'audience',
      gazeSide: Math.sin(s / 6) * 0.6,
      eyeContact: lookingAtScreen ? 0.1 : 0.85,
      screenGazeSec: screenRun,
      smile: 0.3,
      expressiveness: 0.4,
      volumeDb: phase > 0.5 && phase < 0.6 ? -37 : -28,
      volumeRel: phase > 0.5 && phase < 0.6 ? -9 : 0,
      speaking: s % 9 !== 8,
      silenceSec: s % 9 === 8 ? 1 : 0,
    };
    send(pres, { type: 'presenter.sample', sample: p });
    const faces: AudienceFace[] = seats.map((seat) => {
      const right = seat.x > 0.66;
      const drift = (right && phase > 0.35 && phase < 0.6) || (lookingAtScreen && Math.random() < 0.4);
      const r = Math.random();
      return { ...seat, size: 0.5 + seat.y * 0.5, state: drift ? (r < 0.6 ? 'down' : 'away') : r < 0.06 ? 'away' : 'attentive', confusion: false, smile: !drift && r > 0.8 };
    });
    send(aud, { type: 'audience.sample', sample: aggregateAudience(t, faces, 'simulated') });
    if (s % 6 === 5) send(pres, { type: 'speech.webspeech', text: LINES[Math.floor(s / 6) % LINES.length], t1: t });
    if (Math.abs(phase - 0.4) < 0.003) phones.forEach((ph) => send(ph, { type: 'reaction', kind: 'lost' }));
    if (Math.abs(phase - 0.7) < 0.003) send(phones[0], { type: 'reaction', kind: 'question', text: 'How accurate is the head-pose estimate at the back of the room?' });
    if (Math.abs(phase - 0.9) < 0.003) phones.forEach((ph) => send(ph, { type: 'reaction', kind: 'love' }));
    await new Promise((r) => setTimeout(r, 1000));
  }
  send(pres, { type: 'control', action: 'end' });
  console.log(`Ended. Report: http://localhost:5173/report/${(await (await fetch(`${API}/api/sessions/live/${code}`)).json()).id}`);
  setTimeout(() => process.exit(0), 1500);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
