/**
 * Loads the validated seed files into the database. Idempotent: clubs are matched by name and
 * players by (club, name); new rows are inserted, changed rows updated, identical rows left alone.
 * Players in the database that are no longer in the files are deactivated (never deleted, because
 * drafts and season history may reference them), so they leave the draft pool and AI squads.
 */
import { computeClubStrengths, type Position } from '@draft-xi/engine';
import { eq, inArray } from 'drizzle-orm';
import type { DbHandle, PostgresHandle, SqliteHandle } from '../db/client';
import type { Dataset } from './dataset';
import { datasetToEngine } from './engine';
import { DATA_RULES, type DataRules, type ValidationResult, validateDataset } from './validate';

export interface ClubRow {
  name: string;
  shortName: string;
  country: string;
  leagueName: string;
  primaryColor: string;
  secondaryColor: string;
  strengthRating: number | null;
}

export interface PlayerRow {
  clubId: number;
  fullName: string;
  displayName: string;
  primaryPosition: Position;
  altPositions: Position[];
  overall: number;
  nationality: string;
}

const CLUB_FIELDS = [
  'shortName',
  'country',
  'leagueName',
  'primaryColor',
  'secondaryColor',
  'strengthRating',
] as const satisfies readonly (keyof ClubRow)[];

const PLAYER_FIELDS = [
  'displayName',
  'primaryPosition',
  'altPositions',
  'overall',
  'nationality',
] as const satisfies readonly (keyof PlayerRow)[];

export interface ChangePlan<T> {
  toInsert: T[];
  toUpdate: { id: number; key: string; values: Partial<T> }[];
  unchanged: number;
  /** Keys of existing rows that the incoming data does not mention. */
  notInIncoming: string[];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Pure diff of existing rows against incoming rows, matched by a natural key. */
export function planChanges<T extends object>(
  existing: readonly (T & { id: number })[],
  incoming: readonly T[],
  keyOf: (row: T) => string,
  fields: readonly (keyof T)[],
): ChangePlan<T> {
  const byKey = new Map(existing.map((row) => [keyOf(row), row]));
  const plan: ChangePlan<T> = { toInsert: [], toUpdate: [], unchanged: 0, notInIncoming: [] };
  const seen = new Set<string>();

  for (const row of incoming) {
    const key = keyOf(row);
    seen.add(key);
    const current = byKey.get(key);
    if (!current) {
      plan.toInsert.push(row);
      continue;
    }
    const values: Partial<T> = {};
    for (const field of fields) {
      if (!sameValue(current[field], row[field])) values[field] = row[field];
    }
    if (Object.keys(values).length === 0) plan.unchanged++;
    else plan.toUpdate.push({ id: current.id, key, values });
  }

  for (const key of byKey.keys()) if (!seen.has(key)) plan.notInIncoming.push(key);
  return plan;
}

export interface SeedCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  /** In the database but not in the seed files (left untouched). */
  notInFile: string[];
}

export interface SeedReport {
  clubs: SeedCounts;
  players: SeedCounts;
  /** Active players missing from the files that this run deactivated. */
  deactivatedPlayers: number;
}

/** Ids of still-active rows whose key the incoming data no longer mentions. */
function staleActiveIds<T extends { id: number; isActive: boolean }>(rows: readonly T[], keyOf: (row: T) => string, plan: ChangePlan<unknown>): number[] {
  const gone = new Set(plan.notInIncoming);
  return rows.filter((r) => r.isActive && gone.has(keyOf(r))).map((r) => r.id);
}

export class SeedValidationError extends Error {
  constructor(readonly result: ValidationResult) {
    super(
      `Seed data failed validation with ${result.errors.length} error(s):\n` +
        result.errors.map((e) => `  - ${e.message}`).join('\n'),
    );
    this.name = 'SeedValidationError';
  }
}

export interface SeedOptions {
  rules?: DataRules;
}

const clubKey = (c: Pick<ClubRow, 'name'>) => c.name;
const playerKey = (p: Pick<PlayerRow, 'clubId' | 'fullName'>) => `${p.clubId}\u0000${p.fullName}`;
const INSERT_CHUNK = 100;

function chunks<T>(rows: readonly T[], size = INSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Club rows with strength_rating computed by the engine from each club's full squad. */
export function clubRowsFromDataset(dataset: Dataset): ClubRow[] {
  const engine = datasetToEngine(dataset);
  const strengthByName = new Map(
    computeClubStrengths(engine.clubs, engine.players).map((s) => [s.clubName, s.rating]),
  );
  return dataset.clubs.map((c) => ({
    name: c.name,
    shortName: c.short_name,
    country: c.country,
    leagueName: c.league_name,
    primaryColor: c.primary_color,
    secondaryColor: c.secondary_color,
    strengthRating: strengthByName.get(c.name) ?? null,
  }));
}

/** Assumes the dataset passed validation, so positions are valid and every club is known. */
export function playerRowsFromDataset(
  dataset: Dataset,
  clubIdByName: ReadonlyMap<string, number>,
): PlayerRow[] {
  return dataset.players.map((p) => {
    const clubId = clubIdByName.get(p.club);
    if (clubId === undefined) throw new Error(`Club "${p.club}" missing from database`);
    return {
      clubId,
      fullName: p.name,
      // EA names are already display names (e.g. "Vini Jr."), so both columns start equal.
      displayName: p.name,
      primaryPosition: p.primary_position as Position,
      altPositions: p.alt_positions as Position[],
      overall: p.overall,
      nationality: p.nationality,
    };
  });
}

function counts<T>(plan: ChangePlan<T>, describe: (key: string) => string = (k) => k): SeedCounts {
  return {
    inserted: plan.toInsert.length,
    updated: plan.toUpdate.length,
    unchanged: plan.unchanged,
    notInFile: plan.notInIncoming.map(describe),
  };
}

function describePlayerKey(clubNameById: ReadonlyMap<number, string>) {
  return (key: string) => {
    const [clubId, name] = key.split('\u0000');
    return `${clubNameById.get(Number(clubId)) ?? `club ${clubId}`} / ${name}`;
  };
}

export async function seedDatabase(
  handle: DbHandle,
  dataset: Dataset,
  options: SeedOptions = {},
): Promise<SeedReport> {
  const validation = validateDataset(dataset, options.rules ?? DATA_RULES);
  if (!validation.ok) throw new SeedValidationError(validation);
  return handle.dialect === 'sqlite' ? seedSqlite(handle, dataset) : seedPostgres(handle, dataset);
}

function seedSqlite({ db, schema: s }: SqliteHandle, dataset: Dataset): SeedReport {
  return db.transaction((tx) => {
    const clubPlan = planChanges(
      tx.select().from(s.clubs).all(),
      clubRowsFromDataset(dataset),
      clubKey,
      CLUB_FIELDS,
    );
    for (const rows of chunks(clubPlan.toInsert)) tx.insert(s.clubs).values(rows).run();
    for (const u of clubPlan.toUpdate) {
      tx.update(s.clubs).set(u.values).where(eq(s.clubs.id, u.id)).run();
    }

    const clubList = tx.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs).all();
    const clubIdByName = new Map(clubList.map((c) => [c.name, c.id]));
    const existingPlayers = tx.select().from(s.players).all();
    const playerPlan = planChanges(
      existingPlayers,
      playerRowsFromDataset(dataset, clubIdByName),
      playerKey,
      PLAYER_FIELDS,
    );
    for (const rows of chunks(playerPlan.toInsert)) tx.insert(s.players).values(rows).run();
    for (const u of playerPlan.toUpdate) {
      tx.update(s.players).set(u.values).where(eq(s.players.id, u.id)).run();
    }
    const stale = staleActiveIds(existingPlayers, playerKey, playerPlan);
    for (const ids of chunks(stale)) tx.update(s.players).set({ isActive: false, updatedAt: new Date() }).where(inArray(s.players.id, ids)).run();

    const clubNameById = new Map(clubList.map((c) => [c.id, c.name]));
    return {
      clubs: counts(clubPlan),
      players: counts(playerPlan, describePlayerKey(clubNameById)),
      deactivatedPlayers: stale.length,
    };
  });
}

async function seedPostgres({ db, schema: s }: PostgresHandle, dataset: Dataset): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    const clubPlan = planChanges(
      await tx.select().from(s.clubs),
      clubRowsFromDataset(dataset),
      clubKey,
      CLUB_FIELDS,
    );
    for (const rows of chunks(clubPlan.toInsert)) await tx.insert(s.clubs).values(rows);
    for (const u of clubPlan.toUpdate) {
      await tx.update(s.clubs).set(u.values).where(eq(s.clubs.id, u.id));
    }

    const clubList = await tx.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs);
    const clubIdByName = new Map(clubList.map((c) => [c.name, c.id]));
    const existingPlayers = await tx.select().from(s.players);
    const playerPlan = planChanges(
      existingPlayers,
      playerRowsFromDataset(dataset, clubIdByName),
      playerKey,
      PLAYER_FIELDS,
    );
    for (const rows of chunks(playerPlan.toInsert)) await tx.insert(s.players).values(rows);
    for (const u of playerPlan.toUpdate) {
      await tx.update(s.players).set(u.values).where(eq(s.players.id, u.id));
    }
    const stale = staleActiveIds(existingPlayers, playerKey, playerPlan);
    for (const ids of chunks(stale)) await tx.update(s.players).set({ isActive: false, updatedAt: new Date() }).where(inArray(s.players.id, ids));

    const clubNameById = new Map(clubList.map((c) => [c.id, c.name]));
    return {
      clubs: counts(clubPlan),
      players: counts(playerPlan, describePlayerKey(clubNameById)),
      deactivatedPlayers: stale.length,
    };
  });
}
