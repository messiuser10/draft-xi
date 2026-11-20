import type { SimParams } from './params';
import { round2 } from './ratings';
import { hashSeed } from './rng';
import { type SeasonResult, type SeasonTeamInput, simulateSeason } from './season';

export interface MonteCarloRow {
  teamId: string;
  avgPoints: number;
  avgPosition: number;
  /** Fractions from 0 to 1. */
  titleChance: number;
  top4Chance: number;
  bottom3Chance: number;
  minPoints: number;
  maxPoints: number;
}

export interface MonteCarloResult {
  runs: number;
  /** Sorted by average points, best first. */
  rows: MonteCarloRow[];
  goalsPerMatch: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  /** Average points of the team finishing in each position (index 0 = champion). */
  pointsByPosition: number[];
  /** How often each total-goals-per-match count occurred (index = goals, last bucket is "10+"). */
  goalsHistogram: number[];
}

export interface MonteCarloOptions {
  seed: number;
  runs?: number;
  params?: Partial<SimParams>;
}

/** Seed for season i of a batch, so batches are reproducible. */
export function batchSeed(seed: number, label: string, i: number): number {
  return hashSeed(seed, label, i);
}

/** Simulates many seasons (default 1,000) and aggregates outcomes per team (spec section 9). */
export function monteCarlo(teams: readonly SeasonTeamInput[], options: MonteCarloOptions): MonteCarloResult {
  const runs = options.runs ?? 1000;
  if (runs < 1) throw new RangeError('runs must be at least 1');
  const n = teams.length;
  const acc = new Map(
    teams.map((t) => [
      t.id,
      { points: 0, position: 0, titles: 0, top4: 0, bottom3: 0, min: Infinity, max: -Infinity },
    ]),
  );
  const pointsByPosition = new Array<number>(n).fill(0);
  const histogram = new Array<number>(11).fill(0);
  let matches = 0;
  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  for (let i = 0; i < runs; i++) {
    const season = simulateSeason(teams, {
      seed: batchSeed(options.seed, 'monte-carlo', i),
      params: options.params,
      detail: 'fast',
    });
    for (const row of season.table) {
      const a = acc.get(row.teamId)!;
      a.points += row.points;
      a.position += row.position;
      if (row.position === 1) a.titles++;
      if (row.position <= 4) a.top4++;
      if (row.position > n - 3) a.bottom3++;
      a.min = Math.min(a.min, row.points);
      a.max = Math.max(a.max, row.points);
      pointsByPosition[row.position - 1]! += row.points;
    }
    for (const f of season.fixtures) {
      histogram[Math.min(10, f.homeGoals + f.awayGoals)]!++;
    }
    matches += season.summary.matches;
    goals += season.summary.goals;
    homeWins += season.summary.homeWins;
    draws += season.summary.draws;
    awayWins += season.summary.awayWins;
  }

  const rows = [...acc.entries()]
    .map(([teamId, a]) => ({
      teamId,
      avgPoints: round2(a.points / runs),
      avgPosition: round2(a.position / runs),
      titleChance: a.titles / runs,
      top4Chance: a.top4 / runs,
      bottom3Chance: a.bottom3 / runs,
      minPoints: a.min,
      maxPoints: a.max,
    }))
    .sort((a, b) => b.avgPoints - a.avgPoints || a.avgPosition - b.avgPosition);

  return {
    runs,
    rows,
    goalsPerMatch: round2(goals / matches),
    homeWinRate: homeWins / matches,
    drawRate: draws / matches,
    awayWinRate: awayWins / matches,
    pointsByPosition: pointsByPosition.map((p) => round2(p / runs)),
    goalsHistogram: histogram,
  };
}

export interface MultiSeasonRow {
  teamId: string;
  titles: number;
  totalPoints: number;
  avgPosition: number;
  bestPosition: number;
}

export interface MultiSeasonResult {
  seasons: SeasonResult[];
  /** Cumulative titles table: most titles, then most points. */
  titles: MultiSeasonRow[];
}

/** 2 to 10 full seasons with the same teams and derived seeds (spec section 10). */
export function simulateMultiSeason(
  teams: readonly SeasonTeamInput[],
  options: { seed: number; seasons: number; params?: Partial<SimParams> },
): MultiSeasonResult {
  if (!Number.isInteger(options.seasons) || options.seasons < 2 || options.seasons > 10) {
    throw new RangeError('seasons must be 2 to 10');
  }
  const seasons: SeasonResult[] = [];
  for (let i = 0; i < options.seasons; i++) {
    seasons.push(
      simulateSeason(teams, { seed: batchSeed(options.seed, 'multi-season', i), params: options.params }),
    );
  }
  const rows = new Map<string, MultiSeasonRow>(
    teams.map((t) => [t.id, { teamId: t.id, titles: 0, totalPoints: 0, avgPosition: 0, bestPosition: Infinity }]),
  );
  for (const s of seasons) {
    for (const r of s.table) {
      const row = rows.get(r.teamId)!;
      if (r.position === 1) row.titles++;
      row.totalPoints += r.points;
      row.avgPosition += r.position / seasons.length;
      row.bestPosition = Math.min(row.bestPosition, r.position);
    }
  }
  const titles = [...rows.values()]
    .map((r) => ({ ...r, avgPosition: round2(r.avgPosition) }))
    .sort((a, b) => b.titles - a.titles || b.totalPoints - a.totalPoints || a.avgPosition - b.avgPosition);
  return { seasons, titles };
}
