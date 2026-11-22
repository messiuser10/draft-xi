import { describe, expect, it } from 'vitest';
import {
  DATA_RULES,
  type Dataset,
  DatasetFileError,
  type IssueCode,
  validateDataset,
} from '../src';
import { parseClubsJson, parsePlayersCsv, parsePlayersJson } from '../src/data/dataset';
import { makeDataset, TEST_RULES } from './helpers/dataset';

function codes(dataset: Dataset, rules = TEST_RULES) {
  const result = validateDataset(dataset, rules);
  return {
    ok: result.ok,
    errors: result.errors.map((e) => e.code),
    warnings: result.warnings.map((w) => w.code),
  };
}

function withPlayer(dataset: Dataset, index: number, patch: Partial<Dataset['players'][number]>) {
  const players = dataset.players.map((p, i) => (i === index ? { ...p, ...patch } : p));
  return { ...dataset, players, csvPlayers: dataset.csvPlayers };
}

const errorsOf = (dataset: Dataset, rules = TEST_RULES): IssueCode[] =>
  codes(dataset, rules).errors;

describe('validateDataset', () => {
  it('accepts a dataset that meets every rule', () => {
    expect(codes(makeDataset())).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('expects 609 players by default', () => {
    expect(DATA_RULES.expectedPlayerCount).toBe(609);
    expect(errorsOf(makeDataset(), DATA_RULES)).toContain('player-count');
  });

  it('fails when the total row count is wrong', () => {
    const ds = makeDataset();
    expect(errorsOf(ds, { ...TEST_RULES, expectedPlayerCount: 45 })).toEqual(['player-count']);
  });

  it('fails when a club has fewer than 2 goalkeepers', () => {
    const ds = withPlayer(makeDataset(), 0, { primary_position: 'CB' });
    expect(errorsOf(ds)).toEqual(['too-few-goalkeepers']);
  });

  it('counts a player with GK as an alt position as a goalkeeper', () => {
    const ds = withPlayer(makeDataset(), 0, { primary_position: 'CB', alt_positions: ['GK'] });
    expect(errorsOf(ds)).toEqual([]);
  });

  it('fails when a club has fewer than 22 players', () => {
    const base = makeDataset();
    const ds = { ...base, players: base.players.slice(0, -1) };
    expect(errorsOf(ds, { ...TEST_RULES, expectedPlayerCount: 43 })).toEqual(['squad-too-small']);
  });

  it('fails on duplicate names within a club, ignoring case', () => {
    const ds = withPlayer(makeDataset(), 1, { name: 'ALPHA FC PLAYER 1' });
    expect(errorsOf(ds)).toEqual(['duplicate-player']);
  });

  it('allows the same name at two different clubs', () => {
    const ds = withPlayer(makeDataset(), 30, { name: 'Alpha FC Player 1' });
    expect(errorsOf(ds)).toEqual([]);
  });

  it('fails on an invalid primary or alt position', () => {
    expect(errorsOf(withPlayer(makeDataset(), 5, { primary_position: 'SW' }))).toEqual([
      'invalid-position',
    ]);
    expect(errorsOf(withPlayer(makeDataset(), 5, { alt_positions: ['XX'] }))).toEqual([
      'invalid-position',
    ]);
  });

  it('fails on ratings outside 40 to 99 or not whole numbers', () => {
    for (const overall of [39, 100, 85.5, Number.NaN]) {
      expect(errorsOf(withPlayer(makeDataset(), 3, { overall })), String(overall)).toEqual([
        'rating-out-of-range',
      ]);
    }
    for (const overall of [40, 99]) {
      expect(errorsOf(withPlayer(makeDataset(), 3, { overall })), String(overall)).toEqual([]);
    }
  });

  it('fails on an unknown club, once per club name', () => {
    const base = makeDataset();
    const players = base.players.map((p, i) => (i < 2 ? { ...p, club: 'Gamma Town' } : p));
    const result = validateDataset({ ...base, players }, TEST_RULES);
    const unknown = result.errors.filter((e) => e.code === 'unknown-club');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.message).toContain('Gamma Town');
    expect(unknown[0]?.message).toContain('2 players');
  });

  it('fails on a club listed twice in clubs.json', () => {
    const base = makeDataset();
    const clubs = [...base.clubs, { ...base.clubs[0]! }];
    expect(errorsOf({ ...base, clubs })).toContain('duplicate-club');
  });

  it('only warns when players.csv disagrees with players.seed.json', () => {
    const base = makeDataset();
    const csvPlayers = base.csvPlayers.map((p, i) => (i === 0 ? { ...p, overall: 50 } : p));
    const result = codes({ ...base, csvPlayers });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['csv-mismatch', 'csv-mismatch']);
  });

  it('only warns when clubs.json squad_size is out of date', () => {
    const base = makeDataset();
    const clubs = base.clubs.map((c, i) => (i === 0 ? { ...c, squad_size: 25 } : c));
    expect(codes({ ...base, clubs })).toEqual({
      ok: true,
      errors: [],
      warnings: ['squad-size-mismatch'],
    });
  });
});

describe('strength cross-check', () => {
  it('only warns when clubs.json strength_rating disagrees with the engine', () => {
    const base = makeDataset();
    const clubs = base.clubs.map((c, i) => (i === 0 ? { ...c, strength_rating: 50 } : c));
    const result = validateDataset({ ...base, clubs }, TEST_RULES);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['strength-mismatch']);
    expect(result.warnings[0]?.message).toContain('Alpha FC');
  });
});

describe('dataset parsing', () => {
  it('parses players.csv with a BOM, quoted fields and numeric overall', () => {
    const csv = '﻿club,name,position,overall,nationality\nAlpha FC,"Smith, John",ST,88,England\n';
    expect(parsePlayersCsv(csv)).toEqual([
      { club: 'Alpha FC', name: 'Smith, John', position: 'ST', overall: 88, nationality: 'England' },
    ]);
  });

  it('normalises names to NFC so accented duplicates are caught', () => {
    const decomposed = 'Mbappé';
    const { players } = parsePlayersJson(
      JSON.stringify({
        source: 'x',
        players: [
          {
            club: 'Alpha FC',
            name: ` ${decomposed} `,
            primary_position: 'ST',
            alt_positions: ['CF'],
            overall: 91,
            nationality: 'France',
          },
        ],
      }),
    );
    expect(players[0]?.name).toBe('Mbappé');
  });

  it('rejects files with missing fields or bad JSON with a clear file name', () => {
    expect(() => parsePlayersJson('{"source":"x","players":[{"club":"A"}]}')).toThrow(
      DatasetFileError,
    );
    expect(() => parseClubsJson('not json')).toThrow(/clubs\.json: invalid JSON/);
  });
});
