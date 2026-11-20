import { describe, expect, it } from 'vitest';
import { FORMATION_IDS, poolHealth } from '../src';
import { players } from './helpers/data';


describe('poolHealth', () => {
  it('passes for 20 teams in 4-3-3 with the real pool', () => {
    const health = poolHealth({ players, formations: Array(20).fill('4-3-3') });
    expect(health.totalSlots).toBe(220);
    expect(health.ok).toBe(true);
    expect(health.warnings).toEqual([]);
  });

  it('passes for 20 teams in every formation', () => {
    for (const f of FORMATION_IDS) {
      expect(poolHealth({ players, formations: Array(20).fill(f) }).ok, f).toBe(true);
    }
  });

  it('warns when goalkeepers run short', () => {
    const fewKeepers = players.filter((p) => p.primaryPosition !== 'GK').concat(
      players.filter((p) => p.primaryPosition === 'GK').slice(0, 2),
    );
    const health = poolHealth({ players: fewKeepers, formations: ['4-3-3', '4-4-2', '3-5-2'] });
    expect(health.ok).toBe(false);
    expect(health.warnings[0]).toMatch(/Not enough goalkeepers/);
    expect(health.byPosition.find((r) => r.slotType === 'GK')).toMatchObject({ needed: 3, available: 2 });
  });

  it('detects a shortage that only shows when slots compete for the same players', () => {
    // Two RB/RWB-capable players: enough for either slot type alone, not for both at once.
    const base = players.filter((p) => !['RB', 'RWB'].some((x) => [p.primaryPosition, ...p.altPositions].includes(x as never)));
    const rb = players.filter((p) => p.primaryPosition === 'RB').slice(0, 2);
    const health = poolHealth({ players: [...base, ...rb], formations: ['4-3-3', '4-3-3', '5-3-2'] });
    expect(health.warnings[0]).toMatch(/cannot fill every slot/);
    expect(health.ok).toBe(false);
    expect(health.fillable).toBe(health.totalSlots - 1);
  });

  it('only checks the total when positions are not strict', () => {
    const health = poolHealth({ players: players.slice(0, 15), formations: ['4-3-3'], strictPositions: false });
    expect(health.ok).toBe(true);
  });
});
