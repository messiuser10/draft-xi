import { describe, expect, it } from 'vitest';
import {
  autoPick,
  computeAwards,
  createRng,
  draftGrade,
  fitsSlot,
  getFormation,
  openSlots,
  packOptions,
  pickTurn,
  poolRanks,
  simulateRandomDraft,
  simulateSeason,
  tagPick,
  totalPicks,
} from '../src';
import { makeLeague, playerByName, players } from './helpers/data';

describe('pick order', () => {
  it('snakes: round 1 goes 1 to N, round 2 goes N to 1', () => {
    const order = Array.from({ length: 9 }, (_, i) => pickTurn(i + 1, 3, 'snake').participantIndex);
    expect(order).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
    expect(pickTurn(4, 3, 'snake').round).toBe(2);
  });

  it('linear keeps the same order every round', () => {
    expect(Array.from({ length: 6 }, (_, i) => pickTurn(i + 1, 3, 'linear').participantIndex)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('has 11 x N picks', () => {
    expect(totalPicks(4)).toBe(44);
    expect(() => pickTurn(45, 4, 'snake')).toThrow(RangeError);
  });
});

describe('autoPick', () => {
  const slots = openSlots('4-3-3', []);
  const haaland = playerByName('Erling Haaland');
  const courtois = playerByName('Thibaut Courtois');

  it('takes the first available, fitting player from the queue', () => {
    const choice = autoPick({ available: players, openSlots: slots, queue: [999_999, haaland.id] });
    expect(choice).toMatchObject({ player: { id: haaland.id }, slot: { key: 'ST' }, fromQueue: true });
  });

  it('skips queued players who do not fit an open slot', () => {
    const noStriker = openSlots('4-3-3', ['ST']);
    const choice = autoPick({ available: players, openSlots: noStriker, queue: [haaland.id] });
    expect(choice?.fromQueue).toBe(false);
  });

  it('otherwise fills the scarcest open slot with the best player who fits it', () => {
    const choice = autoPick({ available: players, openSlots: slots })!;
    const supply = (type: (typeof slots)[number]['type']) => players.filter((p) => fitsSlot(p, type)).length;
    const scarcest = Math.min(...slots.map((s) => supply(s.type)));
    expect(supply(choice.slot.type)).toBe(scarcest);
    const best = Math.max(...players.filter((p) => fitsSlot(p, choice.slot.type)).map((p) => p.overall));
    expect(choice.player.overall).toBe(best);
    expect(autoPick({ available: [courtois], openSlots: openSlots('4-3-3', ['GK']) })).toBeUndefined();
  });

  it('respects a club cap', () => {
    const choice = autoPick({
      available: players,
      openSlots: slots,
      queue: [haaland.id],
      clubAllowance: new Map([[haaland.clubId, 0]]),
    });
    expect(choice?.player.clubId).not.toBe(haaland.clubId);
  });
});

describe('simulateRandomDraft', () => {
  it('fills every slot of every team with distinct, fitting players', () => {
    const drafters = [{ formation: '4-3-3' as const }, { formation: '3-5-2' as const }, { formation: '5-4-1' as const }];
    const picks = simulateRandomDraft(players, drafters, createRng(1));
    expect(picks).toHaveLength(33);
    expect(new Set(picks.map((p) => p.player.id)).size).toBe(33);
    drafters.forEach((d, i) => {
      const mine = picks.filter((p) => p.participantIndex === i);
      expect(mine.map((p) => p.slotKey).sort()).toEqual(getFormation(d.formation).slots.map((s) => s.key).sort());
      for (const p of mine) {
        const slot = getFormation(d.formation).slots.find((s) => s.key === p.slotKey)!;
        expect(fitsSlot(p.player, slot.type)).toBe(true);
      }
    });
  });

  it('works for 20 drafters (the pool can fill every team)', () => {
    const drafters = Array.from({ length: 20 }, () => ({ formation: '4-4-2' as const }));
    expect(simulateRandomDraft(players, drafters, createRng(2))).toHaveLength(220);
  });

  it('offers Pack Pick options that fit an open slot', () => {
    const slots = openSlots('4-3-3', ['GK', 'RB', 'RCB', 'LCB', 'LB', 'RCM', 'CM', 'LCM', 'RW', 'LW']);
    const options = packOptions(players, slots, createRng(3));
    expect(options).toHaveLength(5);
    expect(options.every((p) => fitsSlot(p, 'ST'))).toBe(true);
  });
});

describe('draft grades and pick tags', () => {
  it('grades from pre-season strength rank and final position', () => {
    expect(draftGrade(1, 1).grade).toBe('A+');
    expect(draftGrade(20, 20).grade).toBe('F');
    expect(draftGrade(10, 10).grade).toMatch(/^C/);
    expect(draftGrade(1).grade).toBe('A+'); // preview before the season
    expect(draftGrade(3, 15).score).toBeLessThan(draftGrade(3, 2).score);
    expect(() => draftGrade(0)).toThrow(RangeError);
  });

  it('ranks the pool by overall with shared ranks for ties', () => {
    const ranks = poolRanks([
      { id: 1, overall: 90 },
      { id: 2, overall: 88 },
      { id: 3, overall: 88 },
      { id: 4, overall: 80 },
    ]);
    expect([...ranks.entries()]).toEqual([[1, 1], [2, 2], [3, 2], [4, 4]]);
  });

  it('tags steals, fair picks and reaches', () => {
    expect(tagPick(20, 5)).toBe('Steal');
    expect(tagPick(5, 20)).toBe('Reach');
    expect(tagPick(10, 9)).toBe('Fair');
  });
});

describe('computeAwards', () => {
  const { teams, picks } = makeLeague(3, 21);
  const season = simulateSeason(teams, { seed: 8 });
  const pickRecords = picks.map((p) => ({ playerId: p.player.id, teamId: `h:${p.participantIndex + 1}`, pickNumber: p.pickNumber }));
  const awards = computeAwards(season, { picks: pickRecords });

  it('gives the Golden Boot, Playmaker and Golden Glove to the leaders', () => {
    const real = season.playerStats.filter((s) => s.playerId !== null);
    expect(awards.goldenBoot!.goals).toBe(Math.max(...real.map((s) => s.goals)));
    expect(awards.playmaker!.assists).toBe(Math.max(...real.map((s) => s.assists)));
    expect(awards.goldenGlove!.slotKey).toBe('GK');
    expect(awards.goldenGlove!.cleanSheets).toBe(Math.max(...real.filter((s) => s.slotKey === 'GK').map((s) => s.cleanSheets)));
    expect(awards.playerOfTheSeason!.avgRating).toBe(Math.max(...real.map((s) => s.avgRating)));
    expect(awards.championTeamId).toBe(season.table[0]!.teamId);
  });

  it('builds a Team of the Season of 11 distinct players in positions they can play', () => {
    const tots = awards.teamOfTheSeason!;
    expect(tots.slots).toHaveLength(11);
    expect(new Set(tots.slots.map((s) => s.stat.key)).size).toBe(11);
    for (const { slot, stat } of tots.slots) {
      const player = players.find((p) => p.id === stat.playerId)!;
      expect(fitsSlot(player, slot.type)).toBe(true);
    }
  });

  it('names a draft steal who beat his pick and a flop who did not', () => {
    expect(awards.bestDraftSteal!.delta).toBeGreaterThan(0);
    expect(awards.biggestFlop!.delta).toBeLessThan(0);
    expect(computeAwards(season).bestDraftSteal).toBeNull();
  });
});
