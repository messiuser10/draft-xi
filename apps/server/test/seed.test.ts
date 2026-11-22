/**
 * Runs the migrations and the real seed files against both SQLite and Postgres (PGlite).
 */
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Dataset, type DbHandle, loadDataset, seedDatabase, SeedValidationError } from '../src';
import { createDatabase } from '../src/db/database';
import { seedOnBoot } from '../src/data/boot';
import { DIALECTS, exec, rows, selectClubs, selectPlayers } from './helpers/db';

let dataset: Dataset;
beforeAll(async () => {
  dataset = await loadDataset();
});

async function count(handle: DbHandle, table: 'clubs' | 'players'): Promise<number> {
  const [row] = await rows<{ n: number }>(
    handle,
    sql`select cast(count(*) as integer) as n from ${sql.identifier(table)}`,
  );
  return Number(row?.n);
}

describe.each(DIALECTS)('seed on %s', (_dialect, open) => {
  let handle: DbHandle;

  beforeEach(async () => {
    handle = open();
    await handle.migrate();
  });

  afterEach(async () => {
    await handle.close();
  });

  it('can run migrations repeatedly', async () => {
    await handle.migrate();
    await handle.migrate();
    expect(await count(handle, 'clubs')).toBe(0);
  });

  it('loads all 20 clubs and 609 players', async () => {
    const report = await seedDatabase(handle, dataset);
    expect(report.clubs).toEqual({ inserted: 20, updated: 0, unchanged: 0, notInFile: [] });
    expect(report.players).toEqual({ inserted: 609, updated: 0, unchanged: 0, notInFile: [] });
    expect(await count(handle, 'clubs')).toBe(20);
    expect(await count(handle, 'players')).toBe(609);
  });

  it('stores clubs and players exactly as supplied', async () => {
    await seedDatabase(handle, dataset);
    const clubs = await selectClubs(handle);
    const players = await selectPlayers(handle);

    const psg = clubs.find((c) => c.name === 'Paris Saint-Germain');
    expect(psg).toMatchObject({
      shortName: 'PSG',
      country: 'France',
      leagueName: 'Ligue 1',
      primaryColor: '#004170',
      secondaryColor: '#DA291C',
      strengthRating: 88.93,
      inPool: true,
      notes: null,
    });

    const realMadrid = clubs.find((c) => c.name === 'Real Madrid');
    const mbappe = players.find((p) => p.fullName === 'Kylian Mbappé');
    expect(mbappe).toMatchObject({
      clubId: realMadrid?.id,
      displayName: 'Kylian Mbappé',
      primaryPosition: 'ST',
      altPositions: ['CF'],
      overall: 91,
      nationality: 'France',
      isActive: true,
      isInjured: false,
      sourceNote: null,
    });
    expect(mbappe?.updatedAt).toBeInstanceOf(Date);

    // Every row of the file made it in, field for field.
    const clubNameById = new Map(clubs.map((c) => [c.id, c.name]));
    const stored = players
      .map((p) => ({
        club: clubNameById.get(p.clubId),
        name: p.fullName,
        primary_position: p.primaryPosition,
        alt_positions: p.altPositions,
        overall: p.overall,
        nationality: p.nationality,
      }))
      .sort((a, b) => `${a.club}${a.name}`.localeCompare(`${b.club}${b.name}`));
    const supplied = [...dataset.players].sort((a, b) =>
      `${a.club}${a.name}`.localeCompare(`${b.club}${b.name}`),
    );
    expect(stored).toEqual(supplied);
  });

  it('is idempotent', async () => {
    await seedDatabase(handle, dataset);
    const idsBefore = (await selectPlayers(handle)).map((p) => p.id).sort((a, b) => a - b);

    const again = await seedDatabase(handle, dataset);
    expect(again.clubs).toEqual({ inserted: 0, updated: 0, unchanged: 20, notInFile: [] });
    expect(again.players).toEqual({ inserted: 0, updated: 0, unchanged: 609, notInFile: [] });

    const idsAfter = (await selectPlayers(handle)).map((p) => p.id).sort((a, b) => a - b);
    expect(idsAfter).toEqual(idsBefore);
    expect(await count(handle, 'players')).toBe(609);
  });

  it('updates only the rows that changed in the files', async () => {
    await seedDatabase(handle, dataset);
    const edited: Dataset = {
      ...dataset,
      clubs: dataset.clubs.map((c) =>
        c.name === 'Arsenal' ? { ...c, secondary_color: '#9C824A' } : c,
      ),
      players: dataset.players.map((p) =>
        p.name === 'Erling Haaland' ? { ...p, overall: 92, alt_positions: [] } : p,
      ),
    };
    const cityBefore = (await selectClubs(handle)).find((c) => c.name === 'Manchester City');
    const report = await seedDatabase(handle, edited);
    // Arsenal's colour changed; Manchester City's strength is recomputed from Haaland's new rating.
    expect(report.clubs).toMatchObject({ inserted: 0, updated: 2, unchanged: 18 });
    expect(report.players).toMatchObject({ inserted: 0, updated: 1, unchanged: 608 });

    const haaland = (await selectPlayers(handle)).find((p) => p.fullName === 'Erling Haaland');
    expect(haaland).toMatchObject({ overall: 92, altPositions: [] });
    const clubsAfter = await selectClubs(handle);
    expect(clubsAfter.find((c) => c.name === 'Arsenal')?.secondaryColor).toBe('#9C824A');
    const cityAfter = clubsAfter.find((c) => c.name === 'Manchester City');
    expect(cityAfter!.strengthRating!).toBeCloseTo(cityBefore!.strengthRating! + 1 / 11, 2);
  });

  it('deactivates players missing from the files but never deletes them', async () => {
    await seedDatabase(handle, dataset);
    const target = dataset.players.find((p) => p.club === 'Chelsea');
    expect(target).toBeDefined();
    // Keep the count rule satisfied by swapping in a new player at the same club.
    const swapped: Dataset = {
      ...dataset,
      players: dataset.players.map((p) => (p === target ? { ...p, name: 'New Signing' } : p)),
      csvPlayers: dataset.csvPlayers,
    };
    const report = await seedDatabase(handle, swapped);
    expect(report.players.inserted).toBe(1);
    expect(report.players.notInFile).toEqual([`Chelsea / ${target?.name}`]);
    expect(report.deactivatedPlayers).toBe(1);
    expect(await count(handle, 'players')).toBe(610);
    const stored = await selectPlayers(handle);
    expect(stored.find((p) => p.fullName === target?.name)?.isActive).toBe(false);
    expect(stored.filter((p) => p.isActive)).toHaveLength(609);
    // Already inactive, so a second run deactivates nothing new.
    expect((await seedDatabase(handle, swapped)).deactivatedPlayers).toBe(0);
  });

  it('seeds on boot only when the data files changed', async () => {
    const database = createDatabase(handle);
    expect((await seedOnBoot(handle, database, dataset))?.players.inserted).toBe(609);
    expect(await seedOnBoot(handle, database, dataset)).toBeNull();
    const changed: Dataset = { ...dataset, players: dataset.players.map((p) => (p.name === 'Erling Haaland' ? { ...p, overall: 92 } : p)) };
    expect((await seedOnBoot(handle, database, changed))?.players.updated).toBe(1);
    expect(await seedOnBoot(handle, database, changed)).toBeNull();
  });

  it('refuses invalid data and writes nothing', async () => {
    const broken: Dataset = {
      ...dataset,
      players: dataset.players.map((p, i) => (i === 0 ? { ...p, primary_position: 'SW' } : p)),
    };
    await expect(seedDatabase(handle, broken)).rejects.toBeInstanceOf(SeedValidationError);
    expect(await count(handle, 'players')).toBe(0);
    expect(await count(handle, 'clubs')).toBe(0);
  });

  it('enforces player constraints in the database', async () => {
    await seedDatabase(handle, dataset);
    const [{ id: clubId } = { id: 0 }] = await rows<{ id: number }>(
      handle,
      sql`select id from clubs where name = 'Arsenal'`,
    );
    const insertPlayer = (club: number, name: string, overall: number) =>
      exec(
        handle,
        sql`insert into players (club_id, full_name, display_name, primary_position, alt_positions, overall, nationality)
            values (${club}, ${name}, ${name}, 'ST', '[]', ${overall}, 'England')`,
      );

    await expect(insertPlayer(clubId, 'Bukayo Saka', 80)).rejects.toThrow(); // duplicate at club
    await expect(insertPlayer(clubId, 'Too Good', 100)).rejects.toThrow(); // rating > 99
    await expect(insertPlayer(clubId, 'Too Weak', 39)).rejects.toThrow(); // rating < 40
    await expect(insertPlayer(999_999, 'No Club', 70)).rejects.toThrow(); // unknown club
    await expect(insertPlayer(clubId, 'Fine Prospect', 70)).resolves.toBeUndefined();
  });

  it('allows a player to be drafted only once per game', async () => {
    await seedDatabase(handle, dataset);
    const [{ id: playerId } = { id: 0 }] = await rows<{ id: number }>(
      handle,
      sql`select id from players where full_name = 'Kylian Mbappé'`,
    );
    await exec(handle, sql`insert into users (display_name) values ('Host')`);
    await exec(
      handle,
      sql`insert into games (join_code, name, host_user_id, settings) values ('ABC123', 'Test', 1, '{}')`,
    );
    await exec(
      handle,
      sql`insert into participants (game_id, user_id, team_name) values (1, 1, 'Team A'), (1, null, 'Bot B')`,
    );
    const pick = (participant: number, pickNumber: number, slot: string) =>
      exec(
        handle,
        sql`insert into draft_picks (game_id, participant_id, pick_number, round, player_id, slot_key)
            values (1, ${participant}, ${pickNumber}, 1, ${playerId}, ${slot})`,
      );

    await expect(pick(1, 1, 'ST')).resolves.toBeUndefined();
    await expect(pick(2, 2, 'ST')).rejects.toThrow(); // same player, same game
    // Duplicate team names in one game are rejected too.
    await expect(
      exec(handle, sql`insert into participants (game_id, team_name) values (1, 'Team A')`),
    ).rejects.toThrow();
  });
});
