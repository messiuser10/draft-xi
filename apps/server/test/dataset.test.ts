/** Checks the real owner-supplied files in data/. */
import { beforeAll, describe, expect, it } from 'vitest';
import { type Dataset, loadDataset, validateDataset } from '../src';

const SPEC_CLUBS = [
  'Real Madrid',
  'FC Barcelona',
  'Manchester United',
  'Liverpool',
  'Paris Saint-Germain',
  'Bayern Munich',
  'Manchester City',
  'Arsenal',
  'Chelsea',
  'Tottenham Hotspur',
  'Atlético Madrid',
  'Juventus',
  'Borussia Dortmund',
  'AC Milan',
  'Inter Milan',
  'Aston Villa',
  'Inter Miami',
  'Newcastle United',
  'Al-Nassr',
  'Brighton and Hove Albion',
];

/** Positions the spec says appear in the data (no CF, LWB or RWB as primary). */
const DATA_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

describe('supplied data files', () => {
  let dataset: Dataset;
  beforeAll(async () => {
    dataset = await loadDataset();
  });

  it('has 609 players in both players.seed.json and players.csv, and 20 clubs', () => {
    expect(dataset.players).toHaveLength(609);
    expect(dataset.csvPlayers).toHaveLength(609);
    expect(dataset.clubs).toHaveLength(20);
  });

  it('contains exactly the 20 clubs from the spec', () => {
    expect(dataset.clubs.map((c) => c.name).sort()).toEqual([...SPEC_CLUBS].sort());
  });

  it('passes validation with no errors or warnings', () => {
    const result = validateDataset(dataset);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('gives every club at least 22 players and at least 2 goalkeepers', () => {
    const { clubs } = validateDataset(dataset);
    for (const club of clubs) {
      expect(club.players, club.name).toBeGreaterThanOrEqual(22);
      expect(club.goalkeepers, club.name).toBeGreaterThanOrEqual(2);
      expect(club.players, club.name).toBe(club.declaredSquadSize);
    }
  });

  it('only uses the primary positions the spec lists', () => {
    const used = new Set(dataset.players.map((p) => p.primary_position));
    expect([...used].sort()).toEqual([...DATA_POSITIONS].sort());
  });

  it('records the EA SPORTS FC 27 source', () => {
    expect(dataset.source).toMatch(/EA SPORTS FC 27/);
  });
});
