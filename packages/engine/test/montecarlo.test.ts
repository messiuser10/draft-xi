import { describe, expect, it } from 'vitest';
import { monteCarlo, rateTeams, resolveParams, simulateMultiSeason } from '../src';
import { makeLeague } from './helpers/data';

describe('monteCarlo', () => {
  const { teams } = makeLeague(3, 5);
  const mc = monteCarlo(teams, { seed: 1, runs: 1000 });

  it('runs 1,000 seasons and gives consistent probabilities', () => {
    expect(mc.runs).toBe(1000);
    expect(mc.rows).toHaveLength(20);
    const sum = (f: (r: (typeof mc.rows)[number]) => number) => mc.rows.reduce((s, r) => s + f(r), 0);
    expect(sum((r) => r.titleChance)).toBeCloseTo(1, 6);
    expect(sum((r) => r.top4Chance)).toBeCloseTo(4, 6);
    expect(sum((r) => r.bottom3Chance)).toBeCloseTo(3, 6);
    expect(sum((r) => r.avgPosition)).toBeCloseTo(210, 1);
  });

  it('makes the strongest teams win most often, but upsets still happen', () => {
    const rated = rateTeams(teams, resolveParams()).sort((a, b) => b.rating.strength - a.rating.strength);
    const top3 = new Set(rated.slice(0, 3).map((t) => t.id));
    const top3Titles = mc.rows.filter((r) => top3.has(r.teamId)).reduce((s, r) => s + r.titleChance, 0);
    expect(top3Titles).toBeGreaterThan(0.6);
    expect(mc.rows[0]!.titleChance).toBeLessThan(0.9);
    expect(mc.rows.filter((r) => r.titleChance > 0).length).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic per seed', () => {
    expect(monteCarlo(teams, { seed: 1, runs: 50 })).toEqual(monteCarlo(teams, { seed: 1, runs: 50 }));
  });
});

describe('realism for a 3-human league (M1 tuning targets)', () => {
  // Averaged over several random drafts so one lucky draft doesn't decide it.
  const leagues = [1, 2, 3, 4].map((seed) => makeLeague(3, seed).teams);
  const results = leagues.map((teams, i) => monteCarlo(teams, { seed: 100 + i, runs: 150 }));
  const avg = (f: (r: (typeof results)[number]) => number) => results.reduce((s, r) => s + f(r), 0) / results.length;

  it('champion usually 80 to 95 points', () => {
    const champion = avg((r) => r.pointsByPosition[0]!);
    expect(champion).toBeGreaterThanOrEqual(80);
    expect(champion).toBeLessThanOrEqual(95);
  });

  it('bottom team usually 20 to 40 points', () => {
    const bottom = avg((r) => r.pointsByPosition[19]!);
    expect(bottom).toBeGreaterThanOrEqual(20);
    expect(bottom).toBeLessThanOrEqual(40);
  });

  it('around 2.6 to 2.9 goals per match, with a home advantage', () => {
    const goals = avg((r) => r.goalsPerMatch);
    expect(goals).toBeGreaterThanOrEqual(2.6);
    expect(goals).toBeLessThanOrEqual(2.9);
    expect(avg((r) => r.homeWinRate)).toBeGreaterThan(avg((r) => r.awayWinRate));
  });
});

describe('simulateMultiSeason', () => {
  const { teams } = makeLeague(2, 9);

  it('runs 2 to 10 seasons with a cumulative titles table', () => {
    const multi = simulateMultiSeason(teams, { seed: 3, seasons: 3 });
    expect(multi.seasons).toHaveLength(3);
    expect(multi.titles.reduce((s, r) => s + r.titles, 0)).toBe(3);
    expect(new Set(multi.seasons.map((s) => s.seed)).size).toBe(3);
    expect(() => simulateMultiSeason(teams, { seed: 3, seasons: 1 })).toThrow(RangeError);
    expect(() => simulateMultiSeason(teams, { seed: 3, seasons: 11 })).toThrow(RangeError);
  });
});
