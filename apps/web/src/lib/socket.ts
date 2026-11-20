import type { GameEvent, GameSnapshot, ParticipantView } from '@draft-xi/server/contracts';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { play } from './sound';

type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

let socket: Socket | null = null;
const subscriptions = new Map<string, number>();

function getSocket(): Socket {
  if (socket) return socket;
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    useConnection.setState({ connected: true });
    void syncClock();
    // Resubscribe after a reconnect: the server sends a fresh snapshot for each.
    for (const code of subscriptions.keys()) subscribe(code);
  });
  socket.on('disconnect', () => useConnection.setState({ connected: false }));
  socket.on('game:snapshot', (snapshot: GameSnapshot) => {
    useGames.getState().setSnapshot(snapshot);
  });
  socket.on('game:event', (event: GameEvent & { gameId: number }) => {
    useGames.getState().apply(event);
  });
  return socket;
}

/** Opens the socket early so the header's connection indicator is accurate on every page. */
export function ensureSocket(): void {
  getSocket();
}

/** After sign-in or sign-out the cookie changes, so reconnect to be identified afresh. */
export function resetSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

function subscribe(code: string): void {
  getSocket().emit('game:subscribe', code, (ack: Ack<{ gameId: number }>) => {
    if (!ack.ok) useGames.getState().setError(code, ack.error.message);
  });
}

/** Asks the server for a fresh snapshot of a game this page already watches. */
export function resubscribe(code: string): void {
  if (subscriptions.has(code)) subscribe(code);
}

/** Lets a page update its own copy of the draft (queue, pack) after a REST call. */
export function patchDraft(code: string, patch: Partial<NonNullable<GameSnapshot['draft']>>): void {
  useGames.setState((s) => {
    const snap = s.byCode[code];
    if (!snap?.draft) return s;
    return { byCode: { ...s.byCode, [code]: { ...snap, draft: { ...snap.draft, ...patch } } } };
  });
}

async function syncClock(): Promise<void> {
  const s = getSocket();
  const sentAt = Date.now();
  const ack = (await s.timeout(5000).emitWithAck('time:sync').catch(() => null)) as Ack<{ serverTime: number }> | null;
  if (!ack?.ok) return;
  const receivedAt = Date.now();
  // Server time at the midpoint of the round trip.
  useConnection.setState({ clockOffsetMs: ack.data.serverTime - (sentAt + receivedAt) / 2 });
}

export const useConnection = create<{ connected: boolean; clockOffsetMs: number }>(() => ({
  connected: false,
  clockOffsetMs: 0,
}));

/** Server time now, corrected by the measured clock offset. */
export const serverNow = (): number => Date.now() + useConnection.getState().clockOffsetMs;

/** New lobby code per finished game, set when its host starts a rematch. */
export const useRematch = create<Record<string, string>>(() => ({}));

interface GamesState {
  byCode: Record<string, GameSnapshot>;
  errors: Record<string, string>;
  setSnapshot: (snapshot: GameSnapshot) => void;
  setError: (code: string, message: string) => void;
  apply: (event: GameEvent & { gameId: number }) => void;
}

const sortTeams = (list: ParticipantView[]) =>
  [...list].sort((a, b) => (a.pickOrder ?? 1e9) - (b.pickOrder ?? 1e9) || a.id - b.id);

export const useGames = create<GamesState>((set) => ({
  byCode: {},
  errors: {},
  setSnapshot: (snapshot) =>
    set((s) => {
      const errors = { ...s.errors };
      delete errors[snapshot.game.code];
      return { byCode: { ...s.byCode, [snapshot.game.code]: snapshot }, errors };
    }),
  setError: (code, message) => set((s) => ({ errors: { ...s.errors, [code]: message } })),
  apply: (event) =>
    set((s) => {
      const entry = Object.entries(s.byCode).find(([, snap]) => snap.game.id === event.gameId);
      if (!entry) return s;
      const [code, snap] = entry;
      const next: GameSnapshot = { ...snap };
      switch (event.type) {
        case 'participant:joined':
        case 'participant:updated': {
          const others = snap.participants.filter((p) => p.id !== event.participant.id);
          next.participants = sortTeams([...others, event.participant]);
          if (event.participant.userId !== null && event.participant.userId === snap.me.userId) {
            next.me = { ...snap.me, participantId: event.participant.id };
          }
          break;
        }
        case 'participant:left':
          next.participants = snap.participants.filter((p) => p.id !== event.participantId);
          if (snap.me.participantId === event.participantId) next.me = { ...snap.me, participantId: null };
          break;
        case 'game:updated':
          if (snap.game.status === 'lobby' && event.game.status === 'drafting') play('whistle');
          next.game = event.game;
          next.me = { ...snap.me, isHost: snap.me.userId !== null && event.game.hostUserId === snap.me.userId };
          next.participants = snap.participants.map((p) => ({
            ...p,
            isHost: p.userId !== null && p.userId === event.game.hostUserId,
          }));
          break;
        case 'game:countdown':
          next.startsAt = event.startsAt;
          if (event.reason) useToasts.getState().push(event.reason);
          break;
        case 'chat:message':
          next.chat = [...snap.chat, event.message].slice(-100);
          break;
        case 'pool:health':
          next.poolHealth = event.poolHealth;
          next.aiClubCount = event.aiClubCount;
          break;
        case 'draft:pick':
          next.game = event.game;
          if (snap.draft && !snap.draft.picks.some((p) => p.pickNumber === event.pick.pickNumber)) {
            next.draft = { ...snap.draft, picks: [...snap.draft.picks, event.pick], pack: null };
          }
          play('chime');
          useToasts.getState().push(`${event.teamName} drafted ${event.playerName}${event.pick.autoPicked ? ' (auto-pick)' : ''}`);
          break;
        case 'draft:undo':
          next.game = event.game;
          if (snap.draft) next.draft = { ...snap.draft, picks: snap.draft.picks.filter((p) => p.pickNumber < event.pickNumber), pack: null };
          useToasts.getState().push(`The host undid pick ${event.pickNumber}`);
          break;
        case 'playback:updated':
          if (event.playback.playing && !snap.playback?.playing) play('whistle');
          next.playback = event.playback;
          break;
        case 'game:rematch':
          useRematch.setState((r) => ({ ...r, [code]: event.code }));
          useToasts.getState().push(`Rematch lobby ${event.code} is open`);
          break;
      }
      return { byCode: { ...s.byCode, [code]: next } };
    }),
}));

/** Subscribes to a game while the component is mounted; returns the live snapshot. */
export function useGame(code: string): { snapshot: GameSnapshot | undefined; error: string | undefined } {
  useEffect(() => {
    subscriptions.set(code, (subscriptions.get(code) ?? 0) + 1);
    const s = getSocket();
    if (s.connected) subscribe(code);
    return () => {
      const n = (subscriptions.get(code) ?? 1) - 1;
      if (n <= 0) {
        subscriptions.delete(code);
        s.emit('game:unsubscribe', code);
      } else subscriptions.set(code, n);
    };
  }, [code]);
  const snapshot = useGames((s) => s.byCode[code]);
  const error = useGames((s) => s.errors[code]);
  return { snapshot, error };
}

export const useToasts = create<{ items: { id: number; text: string }[]; push: (text: string) => void; dismiss: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (text) => {
      const id = Date.now() + Math.random();
      set((s) => ({ items: [...s.items.slice(-3), { id, text }] }));
      setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 4000);
    },
    dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
  }),
);
