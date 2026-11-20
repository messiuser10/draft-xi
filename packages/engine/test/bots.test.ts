import { describe, expect, it } from 'vitest';
import { type BotLevel, botPick, createRng, fitsSlot, getFormation, openSlots, ratingTier, totalPicks } from '../src';
import { players } from './helpers/data';

const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

describe('botPick', () => {
  it.each(LEVELS)('%s bots fill a whole XI with legal picks', (level) => {
    const rng = createRng(7);
    const available = new Map(players.map((p) => [p.id, p]));
    const filled = new Set<string>();
    const roster = [];
    for (let i = 0; i < 11; i++) {
      const open = openSlots('4-3-3', filled);
      const choice = botPick({ level, available: [...available.values()], openSlots: open, roster }, rng);
      expect(choice).toBeDefined();
      expect(fitsSlot(choice!.player, choice!.slot.type)).toBe(true);
      expect(filled.has(choice!.slot.key)).toBe(false);
      available.delete(choice!.player.id);
      filled.add(choice!.slot.key);
      roster.push(choice!.player);
    }
    expect(filled.size).toBe(11);
  });

  it('easy bots pick among the five best fitting players', () => {
    const open = getFormation('4-3-3').slots;
    const top5 = [...players].sort((a, b) => b.overall - a.overall).slice(0, 5).map((p) => p.overall);
    for (let seed = 1; seed < 20; seed++) {
      const choice = botPick({ level: 'easy', available: players, openSlots: open, roster: [] }, createRng(seed));
      expect(choice!.player.overall).toBeGreaterThanOrEqual(Math.min(...top5));
    }
  });

  it('respects the club cap', () => {
    const open = getFormation('4-3-3').slots;
    const allowance = new Map(players.map((p) => [p.clubId, 0]));
    expect(botPick({ level: 'medium', available: players, openSlots: open, roster: [], clubAllowance: allowance }, createRng(1))).toBeUndefined();
  });

  it('hard bots reach for a scarce slot when rivals need it too', () => {
    const keepers = players.filter((p) => p.primaryPosition === 'GK').slice(0, 3);
    const outfield = players.filter((p) => p.primaryPosition !== 'GK');
    const open = getFormation('4-3-3').slots;
    const rivals = Array.from({ length: 5 }, () => open);
    const choice = botPick({ level: 'hard', available: [...keepers, ...outfield], openSlots: open, roster: [], rivalOpenSlots: rivals }, createRng(3));
    expect(choice!.slot.type).toBe('GK');
    expect(totalPicks(6)).toBe(66);
  });
});

describe('ratingTier', () => {
  it('uses the spec bands', () => {
    expect([90, 88, 87, 82, 81, 75, 74].map(ratingTier)).toEqual(['Elite', 'Elite', 'Gold', 'Gold', 'Silver', 'Silver', 'Bronze']);
  });
});
