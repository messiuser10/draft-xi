import { describe, expect, it } from 'vitest';
import { catchUpAi, monteCarlo, rateTeams, resolveParams, withForm } from '../src';
import { makeLeague } from './helpers/data';

const round2 = (x: number) => Math.round(x * 100) / 100;

const team = (id: string, kind: 'human' | 'ai', attack: number, defense: number) => ({
  id,
  kind,
  rating: { attack, defense, strength: round2((attack + defense) / 2), chemistry: 0, overall: 0 },
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

  it('is off by default, so every team plays by the same rules', () => {
    const { teams: league } = makeLeague(3, 5);
    expect(rateTeams(league, resolveParams())).toEqual(rateTeams(league, resolveParams({ aiCatchUp: 0, aiSpread: 1 })));
    const lifted = rateTeams(league, resolveParams({ aiCatchUp: 1 }));
    const ai = (list: typeof lifted) => list.filter((t) => t.kind === 'ai');
    expect(ai(lifted)[0]!.rating.strength).toBeGreaterThan(ai(rateTeams(league, resolveParams()))[0]!.rating.strength);
  });
});

describe('season form', () => {
  const teams = [team('h1', 'human', 90, 88), team('a1', 'ai', 85, 84), team('a2', 'ai', 80, 79)];

  it('moves attack and defense by the same seeded swing for humans and AI alike', () => {
    const formed = withForm(teams, 42, 2);
    expect(withForm(teams, 42, 2)).toEqual(formed);
    expect(withForm(teams, 43, 2)).not.toEqual(formed);
    for (const [i, t] of formed.entries()) {
      const swing = t.rating.attack - teams[i]!.rating.attack;
      expect(t.rating.defense - teams[i]!.rating.defense).toBeCloseTo(swing, 2);
      expect(Math.abs(swing)).toBeLessThan(10);
    }
    expect(withForm(teams, 42, 0)).toEqual(teams);
  });

  it('keeps swings around the chosen size over many seasons', () => {
    const swings = Array.from({ length: 2000 }, (_, seed) => withForm([teams[0]!], seed, 2)[0]!.rating.attack - 90);
    const sd = Math.sqrt(swings.reduce((s, x) => s + x * x, 0) / swings.length);
    expect(sd).toBeGreaterThan(1.8);
    expect(sd).toBeLessThan(2.2);
  });

  it('makes a clearly best team the favourite, not a certainty', () => {
    const { teams: league } = makeLeague(1, 5);
    const best = (form: number) => Math.max(...monteCarlo(league, { seed: 7, runs: 300, params: { form } }).rows.map((r) => r.titleChance));
    const without = best(0);
    const withForm2 = best(2);
    expect(withForm2).toBeLessThan(without - 0.1);
    expect(withForm2).toBeGreaterThan(0.25);
  });
});
