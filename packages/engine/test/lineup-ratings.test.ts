import { describe, expect, it } from 'vitest';
import {
  ACADEMY_RESERVE_NAME,
  bestLineup,
  chemistryBonus,
  type EnginePlayer,
  fitsSlot,
  getFormation,
  type LineupEntry,
  LineupError,
  lineupFromPicks,
  type Position,
  rateTeam,
  reservePlayer,
} from '../src';
import { playerByName, squadOf } from './helpers/data';

let nextId = 10_000;
const make = (primary: Position, overall: number, extra: Partial<EnginePlayer> = {}): EnginePlayer => ({
  id: nextId++,
  clubId: 1,
  name: `${primary} ${overall} #${nextId}`,
  primaryPosition: primary,
  altPositions: [],
  overall,
  nationality: 'Testland',
  ...extra,
});

describe('bestLineup (AI XI)', () => {
  it('picks a full, compatible XI for every real club', () => {
    for (const club of ['Paris Saint-Germain', 'Inter Miami', 'Al-Nassr', 'Chelsea']) {
      const sheet = bestLineup(squadOf(club));
      expect(sheet.lineup).toHaveLength(11);
      expect(sheet.lineup.every((e) => !e.reserve && !e.outOfPosition)).toBe(true);
      expect(new Set(sheet.lineup.map((e) => e.player.id)).size).toBe(11);
    }
  });

  it('uses the best remaining outfield player out of position (minus 8) when no one fits a slot', () => {
    const squad = [make('GK', 80), ...Array.from({ length: 4 }, () => make('CB', 80)), ...Array.from({ length: 8 }, () => make('ST', 85))];
    const sheet = bestLineup(squad, { formations: ['4-4-2'] });
    const rb = sheet.lineup.find((e) => e.slotKey === 'RB')!;
    expect(rb.outOfPosition).toBe(true);
    expect(rb.effectiveOverall).toBe(rb.player.overall - 8);
    expect(sheet.lineup.filter((e) => e.reserve)).toHaveLength(0);
  });

  it('never plays a goalkeeper outfield and falls back to a 62-rated Academy Reserve', () => {
    const squad = [make('GK', 85), make('GK', 80), make('GK', 75)];
    const sheet = bestLineup(squad, { formations: ['4-3-3'] });
    expect(sheet.lineup.find((e) => e.slotType === 'GK')!.player.overall).toBe(85);
    const outfield = sheet.lineup.filter((e) => e.slotType !== 'GK');
    expect(outfield.every((e) => e.reserve && e.player.name === ACADEMY_RESERVE_NAME && e.effectiveOverall === 62)).toBe(true);
  });

  it('fields 11 reserves for a club with nobody left', () => {
    const sheet = bestLineup([]);
    expect(sheet.lineup).toHaveLength(11);
    expect(sheet.lineup.every((e) => e.reserve && e.effectiveOverall === 62)).toBe(true);
  });

  it('prefers a compatible player over a higher-rated out-of-position one', () => {
    const squad = [make('GK', 70), make('GK', 99)];
    const sheet = bestLineup(squad, { formations: ['4-3-3'] });
    expect(sheet.lineup.find((e) => e.slotType === 'GK')!.player.overall).toBe(99);
  });
});

describe('lineupFromPicks (human XI)', () => {
  const haaland = playerByName('Erling Haaland');
  const courtois = playerByName('Thibaut Courtois');
  const dimarco = playerByName('Federico Dimarco');

  it('rejects a striker in the GK slot and a left-back in a CB slot', () => {
    expect(() => lineupFromPicks('4-3-3', [{ slotKey: 'GK', player: haaland }])).toThrow(LineupError);
    expect(() => lineupFromPicks('4-3-3', [{ slotKey: 'LCB', player: dimarco }])).toThrow(/cannot play CB/);
  });

  it('applies the penalty instead when strict matching is off', () => {
    const sheet = lineupFromPicks('4-3-3', [{ slotKey: 'LCB', player: dimarco }], { strict: false });
    const lcb = sheet.lineup.find((e) => e.slotKey === 'LCB')!;
    expect(lcb).toMatchObject({ outOfPosition: true, effectiveOverall: dimarco.overall - 8 });
  });

  it('rejects unknown slots, a slot filled twice and a player picked twice', () => {
    expect(() => lineupFromPicks('4-3-3', [{ slotKey: 'RWB', player: dimarco }])).toThrow(/no slot/);
    expect(() =>
      lineupFromPicks('4-3-3', [
        { slotKey: 'ST', player: haaland },
        { slotKey: 'ST', player: playerByName('Harry Kane') },
      ]),
    ).toThrow(/twice/);
    expect(() =>
      lineupFromPicks('4-4-2', [
        { slotKey: 'RST', player: haaland },
        { slotKey: 'LST', player: haaland },
      ]),
    ).toThrow(/twice/);
  });

  it('keeps every placed player in a slot that accepts him', () => {
    const sheet = lineupFromPicks('4-3-3', [
      { slotKey: 'GK', player: courtois },
      { slotKey: 'ST', player: haaland },
      { slotKey: 'LB', player: dimarco },
    ]);
    for (const e of sheet.lineup.filter((x) => !x.reserve)) {
      const p = [haaland, courtois, dimarco].find((x) => x.id === e.player.id)!;
      expect(fitsSlot(p, e.slotType)).toBe(true);
    }
    expect(sheet.lineup.filter((e) => e.reserve)).toHaveLength(8);
  });
});

function lineupOf(entries: { type: 'GK' | 'ST' | 'CB'; overall: number; club?: number; nat?: string }[]): LineupEntry[] {
  return entries.map((e, i) => ({
    slotKey: `${e.type}${i}`,
    slotType: e.type,
    x: 50,
    y: 50,
    player: { id: i + 1, name: `P${i}`, overall: e.overall, clubId: e.club ?? i + 100, nationality: e.nat ?? `N${i}`, positions: [e.type] },
    effectiveOverall: e.overall,
    outOfPosition: false,
    reserve: false,
  }));
}

describe('ratings (spec section 9, step 3)', () => {
  it('weights attack and defense by slot', () => {
    // GK 90 (def 1.6), CB 80 (att 0.1, def 1.0), ST 70 (att 1.0)
    const r = rateTeam(lineupOf([{ type: 'GK', overall: 90 }, { type: 'CB', overall: 80 }, { type: 'ST', overall: 70 }]));
    expect(r.attack).toBeCloseTo((0.1 * 80 + 1 * 70) / 1.1, 2);
    expect(r.defense).toBeCloseTo((1.6 * 90 + 1 * 80) / 2.6, 2);
    expect(r.chemistry).toBe(0);
    expect(r.overall).toBe(80);
  });

  it('adds 0.25 per same-club pair (cap 2.0) and 0.1 per same-nation pair (cap 1.0)', () => {
    const three = lineupOf([
      { type: 'CB', overall: 80, club: 1, nat: 'A' },
      { type: 'CB', overall: 80, club: 1, nat: 'A' },
      { type: 'CB', overall: 80, club: 1, nat: 'B' },
    ]);
    expect(chemistryBonus(three)).toBeCloseTo(3 * 0.25 + 0.1, 5);
    const eleven = lineupOf(Array.from({ length: 11 }, () => ({ type: 'CB' as const, overall: 80, club: 1, nat: 'A' })));
    expect(chemistryBonus(eleven)).toBe(3);
    const r = rateTeam(eleven);
    expect(r.attack).toBe(83);
    expect(r.defense).toBe(83);
    expect(rateTeam(eleven, { chemistry: false }).chemistry).toBe(0);
  });

  it('gives reserves no chemistry', () => {
    const lineup = getFormation('4-3-3').slots.map((s): LineupEntry => ({
      slotKey: s.key,
      slotType: s.type,
      x: s.x,
      y: s.y,
      player: reservePlayer(s.type, 62),
      effectiveOverall: 62,
      outOfPosition: false,
      reserve: true,
    }));
    expect(rateTeam(lineup)).toMatchObject({ chemistry: 0, attack: 62, defense: 62 });
  });
});
