import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_PARAMS, simulateSeason } from '../src';
import { makeLeague } from './helpers/data';

const { teams } = makeLeague(3, 11);
const season = simulateSeason(teams, { seed: 42 });

describe('simulateSeason invariants (spec section 9)', () => {
  it('plays 380 fixtures over 38 matchdays', () => {
    expect(season.fixtures).toHaveLength(380);
    expect(new Set(season.fixtures.map((f) => f.matchday)).size).toBe(38);
  });

  it('has every team play 38: 19 home, 19 away, every opponent twice', () => {
    for (const t of teams) {
      const home = season.fixtures.filter((f) => f.homeTeamId === t.id);
      const away = season.fixtures.filter((f) => f.awayTeamId === t.id);
      expect(home).toHaveLength(19);
      expect(away).toHaveLength(19);
      const opponents = [...home.map((f) => f.awayTeamId), ...away.map((f) => f.homeTeamId)];
      for (const o of teams.filter((x) => x.id !== t.id)) expect(opponents.filter((x) => x === o.id)).toHaveLength(2);
    }
  });

  it('gives points equal to 3 x wins + draws and balances goals for and against', () => {
    for (const r of season.table) {
      expect(r.played).toBe(38);
      expect(r.won + r.drawn + r.lost).toBe(38);
      expect(r.points).toBe(3 * r.won + r.drawn);
      expect(r.goalDifference).toBe(r.goalsFor - r.goalsAgainst);
    }
    const gf = season.table.reduce((s, r) => s + r.goalsFor, 0);
    const ga = season.table.reduce((s, r) => s + r.goalsAgainst, 0);
    expect(gf).toBe(ga);
    expect(gf).toBe(season.summary.goals);
  });

  it('orders the table by points, then goal difference, then goals scored', () => {
    expect(season.table.map((r) => r.position)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (let i = 1; i < season.table.length; i++) {
      const a = season.table[i - 1]!;
      const b = season.table[i]!;
      const key = (r: typeof a) => [r.points, r.goalDifference, r.goalsFor];
      const [ap, ag, af] = key(a);
      const [bp, bg, bf] = key(b);
      expect(ap! > bp! || (ap === bp && (ag! > bg! || (ag === bg && af! >= bf!)))).toBe(true);
    }
    expect(season.championTeamId).toBe(season.table[0]!.teamId);
  });

  it('stores a standings snapshot after every matchday', () => {
    expect(season.standings).toHaveLength(38);
    season.standings.forEach((table, i) => {
      expect(table).toHaveLength(20);
      expect(table.every((r) => r.played === i + 1)).toBe(true);
    });
    expect(season.standings[37]).toEqual(season.table);
    expect(season.table.every((r) => r.form.length === 5)).toBe(true);
  });

  it('is identical for the same seed and different for another seed', () => {
    expect(simulateSeason(teams, { seed: 42 })).toEqual(season);
    const other = simulateSeason(teams, { seed: 43 });
    expect(other.fixtures.map((f) => [f.homeGoals, f.awayGoals])).not.toEqual(
      season.fixtures.map((f) => [f.homeGoals, f.awayGoals]),
    );
  });

  it('gives fast mode the same scores without events or snapshots', () => {
    const fast = simulateSeason(teams, { seed: 42, detail: 'fast' });
    expect(fast.table).toEqual(season.table);
    expect(fast.standings).toEqual([]);
    expect(fast.playerStats).toEqual([]);
    expect(fast.fixtures.every((f) => f.events.length === 0)).toBe(true);
  });

  it('honours a different points system', () => {
    const twoPoints = simulateSeason(teams, { seed: 42, params: { points: { win: 2, draw: 1, loss: 0 } }, detail: 'fast' });
    for (const r of twoPoints.table) expect(r.points).toBe(2 * r.won + r.drawn);
  });
});

describe('match events and player stats (step 6)', () => {
  it('has one goal event per goal and at most one assist per goal', () => {
    for (const f of season.fixtures) {
      const goals = f.events.filter((e) => e.type === 'goal');
      expect(goals.filter((e) => e.teamId === f.homeTeamId)).toHaveLength(f.homeGoals);
      expect(goals.filter((e) => e.teamId === f.awayTeamId)).toHaveLength(f.awayGoals);
      expect(f.events.filter((e) => e.type === 'assist').length).toBeLessThanOrEqual(goals.length);
      for (const e of f.events) {
        expect(e.minute).toBeGreaterThanOrEqual(1);
        expect(e.minute).toBeLessThanOrEqual(94);
      }
    }
  });

  it('adds up player goals to team goals and keeps ratings within 4 to 10', () => {
    for (const r of season.table) {
      const goals = season.playerStats.filter((s) => s.teamId === r.teamId).reduce((s, p) => s + p.goals, 0);
      expect(goals).toBe(r.goalsFor);
    }
    for (const s of season.playerStats) {
      expect(s.appearances).toBe(38);
      expect(s.avgRating).toBeGreaterThanOrEqual(4);
      expect(s.avgRating).toBeLessThanOrEqual(10);
    }
  });

  it('credits clean sheets to the GK and defenders only, when the opponent fails to score', () => {
    for (const team of teams) {
      const shutouts = season.fixtures.filter(
        (f) => (f.homeTeamId === team.id && f.awayGoals === 0) || (f.awayTeamId === team.id && f.homeGoals === 0),
      ).length;
      const gk = season.playerStats.find((s) => s.teamId === team.id && s.slotKey === 'GK')!;
      expect(gk.cleanSheets).toBe(shutouts);
      const forwards = season.playerStats.filter((s) => s.teamId === team.id && ['ST', 'RST', 'LST', 'LW', 'RW'].includes(s.slotKey));
      expect(forwards.every((s) => s.cleanSheets === 0)).toBe(true);
    }
  });
});

describe('injuries (off by default)', () => {
  it('is off by default', () => {
    expect(DEFAULT_SIM_PARAMS.injuries).toBe(false);
    expect(season.playerStats.some((s) => s.playerName.startsWith('Reserve'))).toBe(false);
  });

  it('when on, replaces injured players with reserves rated 10 lower and keeps the invariants', () => {
    const injured = simulateSeason(teams, { seed: 42, params: { injuries: true } });
    const reserves = injured.playerStats.filter((s) => s.playerId === null);
    expect(reserves.length).toBeGreaterThan(0);
    for (const r of injured.table) expect(r.points).toBe(3 * r.won + r.drawn);
    // Each slot still has 38 appearances between the regular and any reserve.
    for (const team of teams) {
      for (const slot of team.lineup) {
        const apps = injured.playerStats
          .filter((s) => s.teamId === team.id && s.slotKey === slot.slotKey)
          .reduce((n, s) => n + s.appearances, 0);
        expect(apps).toBe(38);
      }
    }
    expect(simulateSeason(teams, { seed: 42, params: { injuries: true } })).toEqual(injured);
  });
});

describe('tiebreaker order', () => {
  it('uses the configured order, then a seeded draw', async () => {
    const { LeagueTable } = await import('../src/table');
    const points = { win: 3, draw: 1, loss: 0 };
    // Four results that leave every team on 3 points.
    const fixtures = [
      { homeTeamId: 'A', awayTeamId: 'B', homeGoals: 1, awayGoals: 0 },
      { homeTeamId: 'C', awayTeamId: 'D', homeGoals: 5, awayGoals: 0 },
      { homeTeamId: 'B', awayTeamId: 'C', homeGoals: 4, awayGoals: 3 },
      { homeTeamId: 'D', awayTeamId: 'A', homeGoals: 1, awayGoals: 0 },
    ];
    const order = (keys: ('goalDifference' | 'goalsFor' | 'headToHead' | 'wins')[]) => {
      const t = new LeagueTable(['A', 'B', 'C', 'D'], points, 7, keys);
      for (const f of fixtures) t.record(f);
      return t.standings().map((r) => r.teamId);
    };
    // GD: C +4, A 0, B 0, D -4. Goals for: C 8, B 4, A 1, D 1.
    expect(order(['goalDifference', 'goalsFor'])).toEqual(['C', 'B', 'A', 'D']);
    expect(order(['goalsFor'])[0]).toBe('C');
    // Wins only: everyone has one win, so the seeded draw decides, and is stable.
    expect(order(['wins'])).toEqual(order(['wins']));
    expect(order([]).sort()).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('half seasons and mid-season squad changes', () => {
  it('stops after the last matchday asked for', () => {
    const half = simulateSeason(teams, { seed: 42, lastMatchday: 19 });
    expect(half.fixtures).toHaveLength(190);
    expect(half.standings).toHaveLength(19);
    expect(half.table.every((r) => r.played === 19)).toBe(true);
    expect(half.fixtures).toEqual(season.fixtures.slice(0, 190));
  });

  it('keeps the first half identical when squads change from matchday 20', () => {
    // Swap the first two teams' lineups for the second half.
    const changed = teams.map((t, i) => (i === 0 ? { ...t, lineup: teams[1]!.lineup } : i === 1 ? { ...t, lineup: teams[0]!.lineup } : t));
    const split = simulateSeason(teams, { seed: 42, changes: { fromMatchday: 20, teams: changed } });
    expect(split.fixtures).toHaveLength(380);
    expect(split.fixtures.slice(0, 190)).toEqual(season.fixtures.slice(0, 190));
    expect(split.standings[18]).toEqual(season.standings[18]);
    expect(split.fixtures.slice(190)).not.toEqual(season.fixtures.slice(190));
    expect(split.teams[0]!.lineup).toEqual(teams[1]!.lineup);
  });
});
