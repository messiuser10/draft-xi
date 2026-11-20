import { describe, expect, it } from 'vitest';
import { createRng, generateFixtures, hashSeed, longestVenueRun } from '../src';

const ids = Array.from({ length: 20 }, (_, i) => `t${i + 1}`);

describe('generateFixtures', () => {
  const fixtures = generateFixtures(ids, 42);

  it('makes 380 matches over 38 matchdays, 10 per matchday', () => {
    expect(fixtures).toHaveLength(380);
    for (let md = 1; md <= 38; md++) expect(fixtures.filter((f) => f.matchday === md)).toHaveLength(10);
  });

  it('has every team play once per matchday', () => {
    for (let md = 1; md <= 38; md++) {
      const teams = fixtures.filter((f) => f.matchday === md).flatMap((f) => [f.homeTeamId, f.awayTeamId]);
      expect(new Set(teams).size).toBe(20);
    }
  });

  it('has every pair meet twice, once at each ground, with 19 home and 19 away each', () => {
    for (const t of ids) {
      expect(fixtures.filter((f) => f.homeTeamId === t)).toHaveLength(19);
      expect(fixtures.filter((f) => f.awayTeamId === t)).toHaveLength(19);
    }
    const pairs = new Set(fixtures.map((f) => `${f.homeTeamId}>${f.awayTeamId}`));
    expect(pairs.size).toBe(380);
    for (const f of fixtures) expect(pairs.has(`${f.awayTeamId}>${f.homeTeamId}`)).toBe(true);
  });

  it('second half mirrors the first with venues swapped', () => {
    for (const f of fixtures.filter((x) => x.matchday <= 19)) {
      expect(fixtures).toContainEqual({ matchday: f.matchday + 19, homeTeamId: f.awayTeamId, awayTeamId: f.homeTeamId });
    }
  });

  it('never gives a team more than 2 home or 2 away matches in a row, for any seed', () => {
    for (let seed = 0; seed < 300; seed++) expect(longestVenueRun(generateFixtures(ids, seed)), `seed ${seed}`).toBeLessThanOrEqual(2);
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(generateFixtures(ids, 42)).toEqual(fixtures);
    expect(generateFixtures(ids, 43)).not.toEqual(fixtures);
  });

  it('rejects odd or duplicate team lists', () => {
    expect(() => generateFixtures(ids.slice(0, 19), 1)).toThrow(RangeError);
    expect(() => generateFixtures([...ids.slice(0, 19), 't1'], 1)).toThrow(/unique/);
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
    expect(hashSeed(1, 'x', 2)).toBe(hashSeed(1, 'x', 2));
    expect(hashSeed(1, 'x', 2)).not.toBe(hashSeed(1, 'x', 3));
  });

  it('draws Poisson samples with the right mean and ints within bounds', () => {
    const rng = createRng(123);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) sum += rng.poisson(1.4);
    expect(sum / 20_000).toBeCloseTo(1.4, 1);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(1, 94);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(94);
    }
  });

  it('respects weights', () => {
    const rng = createRng(5);
    let heavy = 0;
    for (let i = 0; i < 10_000; i++) if (rng.weighted(['a', 'b'], (x) => (x === 'a' ? 9 : 1)) === 'a') heavy++;
    expect(heavy / 10_000).toBeCloseTo(0.9, 1);
  });
});
