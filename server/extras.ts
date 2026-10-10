// Mount point for routes added in later milestones (recordings, reports, replay).
import type { Express } from 'express';
import type { Hub } from './hub.ts';

export async function mountExtras(_app: Express, _hub: Hub) {}
