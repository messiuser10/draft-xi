import type { SimParams } from './params';
import { hashSeed } from './rng';

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** 1-based. */
  position: number;
  /** Last five results, oldest first, e.g. "WWDLW". */
  form: string;
}

export interface ScoredFixture {
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
}

interface Tally {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  results: string[];
}

/**
 * Builds the league table match by match. Order: points, goal difference, goals scored,
 * head-to-head points among the tied teams, then a seeded random draw (spec section 9, step 7).
 */
export class LeagueTable {
  private readonly tallies = new Map<string, Tally>();
  private readonly played: ScoredFixture[] = [];

  constructor(
    teamIds: readonly string[],
    private readonly points: SimParams['points'],
    private readonly seed: number,
  ) {
    for (const id of teamIds) {
      this.tallies.set(id, { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, results: [] });
    }
  }

  record(f: ScoredFixture): void {
    this.played.push(f);
    this.apply(f.homeTeamId, f.homeGoals, f.awayGoals);
    this.apply(f.awayTeamId, f.awayGoals, f.homeGoals);
  }

  private apply(teamId: string, scored: number, conceded: number): void {
    const t = this.tallies.get(teamId);
    if (!t) throw new Error(`Unknown team ${teamId}`);
    t.played++;
    t.goalsFor += scored;
    t.goalsAgainst += conceded;
    if (scored > conceded) {
      t.won++;
      t.points += this.points.win;
      t.results.push('W');
    } else if (scored === conceded) {
      t.drawn++;
      t.points += this.points.draw;
      t.results.push('D');
    } else {
      t.lost++;
      t.points += this.points.loss;
      t.results.push('L');
    }
  }

  private headToHead(group: readonly string[]): Map<string, number> {
    const members = new Set(group);
    const pts = new Map(group.map((id) => [id, 0]));
    for (const f of this.played) {
      if (!members.has(f.homeTeamId) || !members.has(f.awayTeamId)) continue;
      const [h, a] =
        f.homeGoals > f.awayGoals
          ? [this.points.win, this.points.loss]
          : f.homeGoals === f.awayGoals
            ? [this.points.draw, this.points.draw]
            : [this.points.loss, this.points.win];
      pts.set(f.homeTeamId, (pts.get(f.homeTeamId) ?? 0) + h);
      pts.set(f.awayTeamId, (pts.get(f.awayTeamId) ?? 0) + a);
    }
    return pts;
  }

  standings(): StandingRow[] {
    const rows = [...this.tallies.entries()].map(([teamId, t]) => ({
      teamId,
      played: t.played,
      won: t.won,
      drawn: t.drawn,
      lost: t.lost,
      goalsFor: t.goalsFor,
      goalsAgainst: t.goalsAgainst,
      goalDifference: t.goalsFor - t.goalsAgainst,
      points: t.points,
      position: 0,
      form: t.results.slice(-5).join(''),
    }));
    const primary = (a: StandingRow, b: StandingRow) =>
      b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor;
    rows.sort(primary);

    const ordered: StandingRow[] = [];
    for (let i = 0; i < rows.length; ) {
      let j = i + 1;
      while (j < rows.length && primary(rows[i]!, rows[j]!) === 0) j++;
      const group = rows.slice(i, j);
      if (group.length > 1) {
        const h2h = this.headToHead(group.map((r) => r.teamId));
        const draw = (id: string) => hashSeed(this.seed, 'tiebreak', id);
        group.sort(
          (a, b) => (h2h.get(b.teamId) ?? 0) - (h2h.get(a.teamId) ?? 0) || draw(a.teamId) - draw(b.teamId),
        );
      }
      ordered.push(...group);
      i = j;
    }
    return ordered.map((r, i) => ({ ...r, position: i + 1 }));
  }
}
