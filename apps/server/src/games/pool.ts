import { type EngineClub, type EnginePlayer, isPosition } from '@draft-xi/engine';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/database';

export type ClubRow = Database['t']['clubs']['$inferSelect'];

export interface Pool {
  /** Clubs in the pool (in_pool = true), by id. */
  clubs: ClubRow[];
  engineClubs: EngineClub[];
  /** Active players at pool clubs, as engine input with database ids. */
  players: EnginePlayer[];
}

/** The draftable pool: every active player at an in-pool club (spec section 1, rule 5). */
export async function loadPool(database: Database): Promise<Pool> {
  const { db, t } = database;
  const clubs = await db.select().from(t.clubs).where(eq(t.clubs.inPool, true)).orderBy(t.clubs.id);
  const rows = await db
    .select()
    .from(t.players)
    .innerJoin(t.clubs, eq(t.players.clubId, t.clubs.id))
    .where(and(eq(t.players.isActive, true), eq(t.clubs.inPool, true)))
    .orderBy(t.players.id);
  const players = rows.flatMap(({ players: p }): EnginePlayer[] =>
    isPosition(p.primaryPosition)
      ? [
          {
            id: p.id,
            clubId: p.clubId,
            name: p.displayName,
            primaryPosition: p.primaryPosition,
            altPositions: p.altPositions.filter(isPosition),
            overall: p.overall,
            nationality: p.nationality,
          },
        ]
      : [],
  );
  return { clubs, engineClubs: clubs.map((c) => ({ id: c.id, name: c.name })), players };
}
