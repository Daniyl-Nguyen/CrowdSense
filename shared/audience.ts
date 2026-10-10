import type { AudienceFace, AudienceSample, ZoneId, ZoneStat } from './types.ts';

export const ZONES: ZoneId[] = [
  'back-left',
  'back-center',
  'back-right',
  'front-left',
  'front-center',
  'front-right',
];

export const ZONE_LABEL: Record<ZoneId, string> = {
  'back-left': 'Back-left',
  'back-center': 'Back-center',
  'back-right': 'Back-right',
  'front-left': 'Front-left',
  'front-center': 'Front-center',
  'front-right': 'Front-right',
};

/** x/y are already in the presenter's frame: x 0 = presenter's left, y 1 = front row. */
export function zoneOf(x: number, y: number): ZoneId {
  const col = x < 1 / 3 ? 'left' : x < 2 / 3 ? 'center' : 'right';
  const row = y >= 0.5 ? 'front' : 'back';
  return `${row}-${col}` as ZoneId;
}

export function aggregateAudience(
  t: number,
  faces: AudienceFace[],
  source: AudienceSample['source'],
): AudienceSample {
  const zones: Record<ZoneId, ZoneStat> = Object.fromEntries(
    ZONES.map((id) => [id, { id, count: 0, attentive: 0, down: 0, away: 0, drowsy: 0, attention: null }]),
  ) as Record<ZoneId, ZoneStat>;
  let attentive = 0,
    down = 0,
    away = 0,
    drowsy = 0,
    confusion = 0,
    smile = 0;
  for (const f of faces) {
    const z = zones[zoneOf(f.x, f.y)];
    z.count++;
    z[f.state]++;
    if (f.state === 'attentive') attentive++;
    else if (f.state === 'down') down++;
    else if (f.state === 'away') away++;
    else drowsy++;
    if (f.confusion) confusion++;
    if (f.smile) smile++;
  }
  for (const z of Object.values(zones)) z.attention = z.count ? z.attentive / z.count : null;
  const n = faces.length;
  return {
    t,
    source,
    faces,
    count: n,
    attention: n ? attentive / n : null,
    down: n ? down / n : 0,
    away: n ? away / n : 0,
    drowsy: n ? drowsy / n : 0,
    confusion: n ? confusion / n : 0,
    smile: n ? smile / n : 0,
    zones: ZONES.map((id) => zones[id]),
  };
}

/** Attention for one side of the room (presenter's left or right third). */
export function sideAttention(s: AudienceSample, side: 'left' | 'right'): { count: number; attention: number | null } {
  const zs = s.zones.filter((z) => z.id.endsWith(side));
  const count = zs.reduce((a, z) => a + z.count, 0);
  const att = zs.reduce((a, z) => a + z.attentive, 0);
  return { count, attention: count ? att / count : null };
}
