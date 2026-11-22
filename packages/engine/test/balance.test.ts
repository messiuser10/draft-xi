import { describe, expect, it } from 'vitest';
import { catchUpAi, monteCarlo, rateTeams, resolveParams } from '../src';
import { makeLeague } from './helpers/data';

const team = (id: string, kind: 'human' | 'ai', attack: number, defense: number) => ({
  id,
  kind,
  rating: { attack, defense, strength: (attack + defense) / 2, chemistry: 0, overall: 0 },
});

describe('AI catch-up', () => {
  const teams = [team('h1', 'human', 90, 88), team('h2', 'human', 88, 86), team('a1', 'ai', 85, 84), team('a2', 'ai', 80, 79)];

  it('lifts every AI club by a share of the gap between the drafted average and the best AI club', () => {
    const [h1, h2, a1, a2] = catchUpAi(teams, 0.5);
    // Drafted average attack 89, defense 87; best AI 85/84: lift 2 and 1.5.
    expect(a1!.rating).toMatchObject({ attack: 87, defense: 85.5, strength: 86.25 });
    expect(a2!.rating).toMatchObject({ attack: 82, defense: 80.5 });
    expect(h1).toBe(teams[0]);
    expect(h2).toBe(teams[1]);
  });

  it('brings the best AI club level with the drafted average at 1, and does nothing at 0', () => {
    expect(catchUpAi(teams, 1)[2]!.rating).toMatchObject({ attack: 89, defense: 87 });
    expect(catchUpAi(teams, 0)).toEqual(teams);
  });

  it('never lowers AI clubs when the drafted teams are weaker', () => {
    const weak = [team('h1', 'human', 78, 77), team('a1', 'ai', 85, 84)];
    expect(catchUpAi(weak, 1)).toEqual(weak);
  });

  it('is part of rateTeams by default', () => {
    const { teams: league } = makeLeague(3, 5);
    const off = rateTeams(league, resolveParams({ aiCatchUp: 0 }));
    const on = rateTeams(league, resolveParams());
    const ai = (list: typeof on) => list.filter((t) => t.kind === 'ai');
    expect(ai(on)[0]!.rating.strength).toBeGreaterThan(ai(off)[0]!.rating.strength);
    expect(on.filter((t) => t.kind === 'human')).toEqual(off.filter((t) => t.kind === 'human'));
  });

  it('lets AI clubs win titles against three all-star drafted teams', () => {
    const { teams: league } = makeLeague(3, 5);
    const kind = new Map(league.map((t) => [t.id, t.kind]));
    const aiTitles = (aiCatchUp?: number) =>
      monteCarlo(league, { seed: 7, runs: 300, params: aiCatchUp === undefined ? {} : { aiCatchUp } })
        .rows.filter((r) => kind.get(r.teamId) === 'ai')
        .reduce((s, r) => s + r.titleChance, 0);
    expect(aiTitles(0)).toBeLessThan(0.05);
    // Default 0.8: drafted teams stay favourites, but AI clubs win a real share.
    const withDefault = aiTitles();
    expect(withDefault).toBeGreaterThan(0.25);
    expect(withDefault).toBeLessThan(0.6);
  });
});
