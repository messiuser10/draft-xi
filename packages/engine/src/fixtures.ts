import { createRng, hashSeed } from './rng';

export interface Fixture {
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
}

export const MAX_SAME_VENUE_RUN = 2;

/**
 * Double round robin (spec section 9, step 4). Teams are shuffled with the seed, paired with
 * the circle method for n-1 matchdays, then mirrored with venues swapped. No team plays more
 * than two home or two away matches in a row.
 */
export function generateFixtures(teamIds: readonly string[], seed: number): Fixture[] {
  const n = teamIds.length;
  if (n < 2 || n % 2 !== 0) throw new RangeError(`Need an even number of teams, got ${n}`);
  if (new Set(teamIds).size !== n) throw new Error('Team ids must be unique');

  const teams = createRng(hashSeed(seed, 'fixtures')).shuffle(teamIds);
  const firstHalf = circleRounds(teams);

  // Rotating which round opens the season changes where each team's single "break" falls
  // relative to the halfway mirror; take the first rotation that keeps every run <= 2. Very
  // small leagues cannot always manage that, so fall back to the rotation with the shortest run.
  let best: { fixtures: Fixture[]; run: number } | undefined;
  for (let offset = 0; offset < firstHalf.length; offset++) {
    const rounds = [...firstHalf.slice(offset), ...firstHalf.slice(0, offset)];
    const fixtures = mirror(rounds);
    const run = longestVenueRun(fixtures);
    if (run <= MAX_SAME_VENUE_RUN) return fixtures;
    if (!best || run < best.run) best = { fixtures, run };
  }
  return best!.fixtures;
}

type Round = [home: string, away: string][];

/** Berger tables: fixed last team, the rest rotate; venues alternate so each team has <= 1 break. */
function circleRounds(teams: readonly string[]): Round[] {
  const n = teams.length;
  const fixed = teams[n - 1]!;
  const rotating = teams.slice(0, n - 1);
  const rounds: Round[] = [];
  for (let r = 0; r < n - 1; r++) {
    const list = [...rotating.slice(r), ...rotating.slice(0, r)];
    const round: Round = [];
    const first = list[0]!;
    round.push(r % 2 === 0 ? [first, fixed] : [fixed, first]);
    for (let k = 1; k < n / 2; k++) {
      const a = list[k]!;
      const b = list[n - 1 - k]!;
      round.push(k % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(round);
  }
  return rounds;
}

function mirror(rounds: readonly Round[]): Fixture[] {
  const fixtures: Fixture[] = [];
  rounds.forEach((round, i) => {
    for (const [home, away] of round) fixtures.push({ matchday: i + 1, homeTeamId: home, awayTeamId: away });
  });
  rounds.forEach((round, i) => {
    for (const [home, away] of round) {
      fixtures.push({ matchday: rounds.length + i + 1, homeTeamId: away, awayTeamId: home });
    }
  });
  return fixtures;
}

/** Longest run of consecutive home (or away) matches by any team. */
export function longestVenueRun(fixtures: readonly Fixture[]): number {
  const venues = new Map<string, ('H' | 'A')[]>();
  const sorted = [...fixtures].sort((a, b) => a.matchday - b.matchday);
  for (const f of sorted) {
    (venues.get(f.homeTeamId) ?? venues.set(f.homeTeamId, []).get(f.homeTeamId)!).push('H');
    (venues.get(f.awayTeamId) ?? venues.set(f.awayTeamId, []).get(f.awayTeamId)!).push('A');
  }
  let longest = 0;
  for (const list of venues.values()) {
    let run = 0;
    let prev: string | undefined;
    for (const v of list) {
      run = v === prev ? run + 1 : 1;
      prev = v;
      if (run > longest) longest = run;
    }
  }
  return longest;
}
