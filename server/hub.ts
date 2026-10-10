// Owns all rooms and the storage backends.
import crypto from 'node:crypto';
import type { SessionMode } from '../shared/types.ts';
import { Room } from './room.ts';
import type { Repo, SessionRow } from './db/repo.ts';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion when typed from a phone

export class Hub {
  private byCode = new Map<string, Room>();
  private byId = new Map<string, Room>();
  onEnded?: (room: Room) => void;

  constructor(public repo: Repo) {}

  private code(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)];
      if (!this.byCode.has(c)) return c;
    }
  }

  async create(presenterId: string, mode: SessionMode, title?: string): Promise<Room> {
    const row: SessionRow = {
      id: crypto.randomUUID(),
      presenterId,
      code: this.code(),
      mode,
      title: title?.trim().slice(0, 80) || (mode === 'practice' ? 'Practice run' : 'Live session'),
      status: 'lobby',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      baseline: null,
      summary: null,
      score: null,
      reportKey: null,
    };
    await this.repo.upsertSession(row);
    const room = new Room(row, this.repo);
    room.onEnded = (r) => {
      this.onEnded?.(r);
      // Keep ended rooms briefly so late uploads and report links still resolve.
      setTimeout(() => this.remove(r), 30 * 60_000).unref();
    };
    this.byCode.set(row.code, room);
    this.byId.set(row.id, room);
    return room;
  }

  get rooms(): Room[] {
    return [...this.byId.values()];
  }

  find(codeOrId: string): Room | undefined {
    return this.byCode.get(codeOrId.toUpperCase()) ?? this.byId.get(codeOrId);
  }

  private remove(r: Room) {
    r.dispose();
    this.byCode.delete(r.row.code);
    this.byId.delete(r.row.id);
  }
}
