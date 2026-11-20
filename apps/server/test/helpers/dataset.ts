import type { ClubRecord, Dataset, PlayerRecord } from '../../src';

/** Positions for a valid 22-player test squad: 2 GKs plus 20 outfielders. */
const SQUAD_POSITIONS = [
  'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'LB', 'RB', 'RB', 'CDM',
  'CM', 'CM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST', 'ST',
];

export function makeClub(name: string): ClubRecord {
  return {
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    country: 'Testland',
    league_name: 'Test League',
    primary_color: '#112233',
    secondary_color: '#FFFFFF',
    squad_size: SQUAD_POSITIONS.length,
  };
}

export function makeSquad(club: string): PlayerRecord[] {
  return SQUAD_POSITIONS.map((position, i) => ({
    club,
    name: `${club} Player ${i + 1}`,
    primary_position: position,
    alt_positions: [],
    overall: 70 + (i % 20),
    nationality: 'Testland',
  }));
}

/** A small dataset that passes every rule (with TEST_RULES): 2 clubs x 22 players. */
export function makeDataset(): Dataset {
  const clubs = [makeClub('Alpha FC'), makeClub('Beta United')];
  const players = clubs.flatMap((c) => makeSquad(c.name));
  return {
    source: 'test fixture',
    clubs,
    players,
    csvPlayers: players.map((p) => ({
      club: p.club,
      name: p.name,
      position: p.primary_position,
      overall: p.overall,
      nationality: p.nationality,
    })),
  };
}

export const TEST_RULES = {
  expectedPlayerCount: 44,
  expectedClubCount: 2,
  minSquadSize: 22,
  minGoalkeepers: 2,
};
