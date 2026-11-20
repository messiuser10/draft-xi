/**
 * Socket.IO: one room per game. A client sends `game:subscribe` with a join code and gets a full
 * `game:snapshot` back, then small `game:event`s. Reconnecting clients simply subscribe again.
 * The session cookie identifies the viewer; anonymous sockets may spectate.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { type AuthService, type AuthUser, SESSION_COOKIE } from '../auth/service';
import { type GameEvent, type GameSnapshot, joinCodeSchema } from '../contracts';
import { AppError } from '../errors';
import type { GameHub, GameService } from '../games/service';

export interface ServerToClientEvents {
  'game:snapshot': (snapshot: GameSnapshot) => void;
  'game:event': (event: GameEvent & { gameId: number }) => void;
}

export type Ack<T> = (result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } }) => void;

export interface ClientToServerEvents {
  'game:subscribe': (code: string, ack?: Ack<{ gameId: number }>) => void;
  'game:unsubscribe': (code: string) => void;
  'time:sync': (ack: Ack<{ serverTime: number }>) => void;
}

interface SocketData {
  user: AuthUser | null;
  /** Games this socket watches, by id. */
  games: Set<number>;
  /** Subscribe and unsubscribe run one at a time per socket, so a quick unsubscribe/subscribe pair cannot interleave. */
  queue: Promise<void>;
}

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const room = (gameId: number) => `game:${gameId}`;

export function createRealtime(
  httpServer: HttpServer,
  auth: AuthService,
  games: GameService,
  parseCookie: (header: string) => Record<string, string | undefined>,
): { io: IoServer; hub: GameHub } {
  const io: IoServer = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    // Same origin in production; Vite proxies the socket in development.
    cors: { origin: false },
  });

  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    auth
      .resolve(cookies[SESSION_COOKIE])
      .then((user) => {
        socket.data.user = user;
        socket.data.games = new Set();
        socket.data.queue = Promise.resolve();
        next();
      })
      .catch((err: unknown) => next(err instanceof Error ? err : new Error('Auth failed')));
  });

  const sendSnapshot = async (socket: IoSocket, gameId: number) => {
    socket.emit('game:snapshot', await games.snapshot(gameId, socket.data.user));
  };

  const enqueue = (socket: IoSocket, task: () => Promise<void>) => {
    socket.data.queue = socket.data.queue.then(task).catch(() => undefined);
  };

  io.on('connection', (socket) => {
    socket.on('game:subscribe', (rawCode, ack) => {
      enqueue(socket, async () => {
        try {
          const code = joinCodeSchema.parse(rawCode);
          const game = await games.getByCode(code);
          if (!socket.data.games.has(game.id)) {
            socket.data.games.add(game.id);
            await socket.join(room(game.id));
            await games.trackConnection(game.id, socket.data.user, 1);
          }
          await sendSnapshot(socket, game.id);
          ack?.({ ok: true, data: { gameId: game.id } });
        } catch (err) {
          ack?.({ ok: false, error: errorOf(err) });
        }
      });
    });

    socket.on('game:unsubscribe', (rawCode) => {
      enqueue(socket, async () => {
        const parsed = joinCodeSchema.safeParse(rawCode);
        if (!parsed.success) return;
        const game = await games.getByCode(parsed.data).catch(() => null);
        if (!game || !socket.data.games.delete(game.id)) return;
        await socket.leave(room(game.id));
        await games.trackConnection(game.id, socket.data.user, -1);
      });
    });

    socket.on('time:sync', (ack) => {
      if (typeof ack === 'function') ack({ ok: true, data: { serverTime: Date.now() } });
    });

    socket.on('disconnect', () => {
      for (const gameId of socket.data.games) {
        void games.trackConnection(gameId, socket.data.user, -1).catch(() => undefined);
      }
      socket.data.games.clear();
    });
  });

  const hub: GameHub = {
    emit: (gameId, event) => {
      io.to(room(gameId)).emit('game:event', { ...event, gameId });
    },
    resync: (gameId) => {
      void (async () => {
        const sockets = await io.in(room(gameId)).fetchSockets();
        for (const s of sockets) {
          s.emit('game:snapshot', await games.snapshot(gameId, s.data.user));
        }
      })().catch(() => undefined);
    },
  };

  return { io, hub };
}

function errorOf(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  if (err && typeof err === 'object' && 'issues' in err) return { code: 'invalid_input', message: 'Invalid game code' };
  return { code: 'internal', message: 'Something went wrong' };
}
