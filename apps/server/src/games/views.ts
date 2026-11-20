import { type FormationId, isFormationId } from '@draft-xi/engine';
import {
  DEFAULT_GAME_SETTINGS,
  type GameSettings,
  gameSettingsSchema,
  type GameView,
  type ParticipantView,
} from '../contracts';
import type { Database } from '../db/database';

export type GameRow = Database['t']['games']['$inferSelect'];
export type ParticipantRow = Database['t']['participants']['$inferSelect'];

/** Stored settings, filled with defaults for any key added after the game was created. */
export function settingsOf(game: GameRow): GameSettings {
  const parsed = gameSettingsSchema.safeParse({ ...DEFAULT_GAME_SETTINGS, ...game.settings });
  return parsed.success ? parsed.data : DEFAULT_GAME_SETTINGS;
}

export function formationOf(p: ParticipantRow): FormationId | null {
  return p.formation !== null && isFormationId(p.formation) ? p.formation : null;
}

export function toGameView(game: GameRow): GameView {
  return {
    id: game.id,
    code: game.joinCode,
    name: game.name,
    status: game.status,
    hostUserId: game.hostUserId,
    settings: settingsOf(game),
    currentPickNumber: game.currentPickNumber,
    currentParticipantId: game.currentParticipantId,
    pickDeadline: game.pickDeadline?.toISOString() ?? null,
    createdAt: game.createdAt.toISOString(),
  };
}

export function toParticipantView(p: ParticipantRow, game: GameRow, displayName: string): ParticipantView {
  return {
    id: p.id,
    userId: p.userId,
    displayName,
    teamName: p.teamName,
    color: p.color,
    monogram: p.monogram,
    formation: formationOf(p),
    pickOrder: p.pickOrder,
    isReady: p.isReady,
    isBot: p.isBot,
    botLevel: p.botLevel,
    isConnected: p.isBot || p.isConnected,
    isHost: p.userId !== null && p.userId === game.hostUserId,
  };
}

/** Teams in pick order (unordered ones last, by join order). */
export function byPickOrder<T extends { pickOrder: number | null; id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.pickOrder ?? 1e9) - (b.pickOrder ?? 1e9) || a.id - b.id);
}
