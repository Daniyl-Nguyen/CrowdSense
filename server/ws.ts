import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { ClientMsg, NodeRole } from '../shared/types.ts';
import type { Hub } from './hub.ts';
import type { Room } from './room.ts';
import { serverConfig } from './status.ts';

const ROLES: NodeRole[] = ['presenter-cam', 'audience-cam', 'monitor', 'dashboard', 'phone'];

export function attachWs(server: Server, hub: Hub) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
  wss.on('connection', (ws) => {
    let room: Room | undefined;
    let client: Parameters<Room['join']>[0] | undefined;
    ws.on('message', async (data, isBinary) => {
      try {
        if (isBinary) {
          if (room && client?.role === 'presenter-cam') await room.audio(data as Buffer);
          return;
        }
        const msg = JSON.parse(String(data)) as ClientMsg;
        if (msg.type === 'hello') {
          if (!ROLES.includes(msg.role)) throw new Error('bad role');
          room = hub.find(msg.code);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: `No session with code ${msg.code}` }));
            return ws.close();
          }
          client = { ws, role: msg.role, clientId: String(msg.clientId).slice(0, 64) };
          ws.send(JSON.stringify({ type: 'welcome', session: room.info(), serverTime: Date.now(), config: serverConfig() }));
          room.join(client);
          return;
        }
        if (!room || !client) return;
        // Phones can only react; only operator nodes may control the session.
        if (client.role === 'phone' && msg.type !== 'reaction' && msg.type !== 'ping') return;
        await room.handle(client, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: (e as Error).message }));
      }
    });
    ws.on('close', () => {
      if (room && client) room.leave(client);
    });
  });
}
