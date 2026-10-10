// Recording arrives in M6. Until then this reports "not recording".
import type { SessionInfo } from '@shared/types.ts';
import type { RoomSocket } from '../lib/socket.ts';

export function useRecorder(_socket: RoomSocket | null, _session: SessionInfo | null, _stream: MediaStream | null, _role: 'presenter' | 'audience') {
  return { recording: false, uploading: false, error: null as string | null };
}
