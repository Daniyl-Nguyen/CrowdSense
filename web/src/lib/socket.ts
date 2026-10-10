import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, LiveTick, NodeRole, ServerConfig, ServerMsg, SessionInfo } from '@shared/types.ts';
import { clientId } from './ids.ts';

type Handler = (msg: ServerMsg) => void;

/** One WebSocket per node. Reconnects with backoff and keeps a server clock offset (NTP-style). */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private retry = 0;
  private closed = false;
  private pingTimer: number | undefined;
  private bestRtt = Infinity;
  offset = 0; // serverTime - clientTime
  session: SessionInfo | null = null;
  config: ServerConfig | null = null;
  connected = false;

  constructor(
    public code: string,
    public role: NodeRole,
  ) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw({ type: 'hello', role: this.role, code: this.code, clientId: clientId() });
      this.ping();
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 10_000);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      if (msg.type === 'welcome') {
        this.session = msg.session;
        this.config = msg.config;
        this.connected = true;
        if (this.offset === 0) this.offset = msg.serverTime - Date.now();
      } else if (msg.type === 'session') this.session = msg.session;
      else if (msg.type === 'pong') {
        const now = Date.now();
        const rtt = now - msg.c;
        if (rtt <= this.bestRtt * 1.5) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = msg.s - (msg.c + rtt / 2);
        }
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      window.clearInterval(this.pingTimer);
      for (const h of this.handlers) h({ type: 'error', message: 'disconnected' });
      if (this.closed) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
  }

  private ping() {
    this.raw({ type: 'ping', c: Date.now() });
  }

  private raw(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  send(msg: ClientMsg) {
    this.raw(msg);
  }

  sendBinary(buf: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 4_000_000) this.ws.send(buf);
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  /** Session-relative ms for a client epoch timestamp (defaults to now). */
  sessionTime(clientEpoch = Date.now()): number {
    const s = this.session;
    const base = s?.startedAt ?? s?.createdAt ?? this.serverNow();
    return clientEpoch + this.offset - base;
  }

  close() {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

export interface RoomState {
  socket: RoomSocket | null;
  session: SessionInfo | null;
  config: ServerConfig | null;
  tick: LiveTick | null;
  connected: boolean;
  error: string | null;
}

/** React binding: connects a node to a room and exposes session + latest tick. */
export function useRoom(code: string | null, role: NodeRole, onMsg?: Handler): RoomState {
  const [state, setState] = useState<RoomState>({
    socket: null,
    session: null,
    config: null,
    tick: null,
    connected: false,
    error: null,
  });
  const cb = useRef(onMsg);
  cb.current = onMsg;
  useEffect(() => {
    if (!code) return;
    const sock = new RoomSocket(code, role);
    setState((s) => ({ ...s, socket: sock }));
    const off = sock.on((msg) => {
      cb.current?.(msg);
      switch (msg.type) {
        case 'welcome':
          setState((s) => ({ ...s, session: msg.session, config: msg.config, connected: true, error: null }));
          break;
        case 'session':
          setState((s) => ({ ...s, session: msg.session }));
          break;
        case 'tick':
          setState((s) => ({ ...s, tick: msg.tick }));
          break;
        case 'error':
          setState((s) => ({ ...s, connected: sock.connected, error: msg.message === 'disconnected' ? null : msg.message }));
          break;
      }
    });
    return () => {
      off();
      sock.close();
    };
  }, [code, role]);
  return state;
}
