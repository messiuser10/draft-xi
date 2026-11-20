import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLOT_COMPATIBILITY,
  fitsSlot,
  FORMATION_IDS,
  FORMATIONS,
  maxWeightAssignment,
  type Position,
  SLOT_TYPES,
} from '../src';

const player = (primary: Position, alt: Position[] = []) => ({ primaryPosition: primary, altPositions: alt });

describe('formations', () => {
  it('has the 10 formations from the spec', () => {
    expect([...FORMATION_IDS].sort()).toEqual(
      ['4-3-3', '4-4-2', '4-2-3-1', '4-1-4-1', '4-3-2-1', '4-4-1-1', '3-5-2', '3-4-3', '5-3-2', '5-4-1'].sort(),
    );
  });

  it.each(FORMATION_IDS)('%s has 11 uniquely keyed slots, one GK, matching its shape and on-pitch coordinates', (id) => {
    const slots = FORMATIONS[id].slots;
    expect(slots).toHaveLength(11);
    expect(new Set(slots.map((s) => s.key)).size).toBe(11);
    expect(slots.filter((s) => s.type === 'GK')).toHaveLength(1);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(100);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(100);
    }
    // The back line: defensive slots in the defensive third (3-5-2 wing-backs sit in midfield).
    const defenders = slots.filter((s) => ['CB', 'RB', 'LB', 'RWB', 'LWB'].includes(s.type) && s.y <= 36).length;
    expect(defenders).toBe(Number(id.split('-')[0]));
  });
});

describe('slot compatibility (spec section 4)', () => {
  it('covers every slot type', () => {
    expect(Object.keys(DEFAULT_SLOT_COMPATIBILITY).sort()).toEqual([...SLOT_TYPES].sort());
  });

  it('rejects a striker in goal and a left-back at centre-back', () => {
    expect(fitsSlot(player('ST', ['CF']), 'GK')).toBe(false);
    expect(fitsSlot(player('LB', ['LWB']), 'CB')).toBe(false);
  });

  it('accepts listed positions and their compatible slots', () => {
    expect(fitsSlot(player('GK'), 'GK')).toBe(true);
    expect(fitsSlot(player('LB', ['LWB']), 'LWB')).toBe(true);
    expect(fitsSlot(player('CM', ['CDM', 'CAM']), 'CDM')).toBe(true);
    expect(fitsSlot(player('CF'), 'ST')).toBe(true);
    expect(fitsSlot(player('RW', ['RM']), 'RM')).toBe(true);
    expect(fitsSlot(player('RW', ['RM']), 'LW')).toBe(false);
  });

  it('uses a custom map when the admin edits it', () => {
    const custom = { ...DEFAULT_SLOT_COMPATIBILITY, CB: ['CB', 'LB'] as Position[] };
    expect(fitsSlot(player('LB'), 'CB', custom)).toBe(true);
  });
});

describe('maxWeightAssignment', () => {
  it('finds the optimum where a greedy choice would not', () => {
    // Greedy takes row0->col0 (10) leaving row1 with 1: total 11. Optimum is 9 + 8 = 17.
    expect(maxWeightAssignment([
      [10, 9],
      [8, 1],
    ])).toEqual([1, 0]);
  });

  it('never uses a forbidden pairing and reports rows it cannot fill', () => {
    expect(maxWeightAssignment([
      [null, 5],
      [null, 7],
    ])).toContain(-1);
    expect(maxWeightAssignment([
      [null, 5, 1],
      [4, null, null],
    ])).toEqual([1, 0]);
  });
});
