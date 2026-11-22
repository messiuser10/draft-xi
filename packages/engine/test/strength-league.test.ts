import { describe, expect, it } from 'vitest';
import { aiTeamId, buildLeagueTeams, computeClubStrengths, selectAiClubIds } from '../src';
import { clubId, clubs, playerByName, players, rawClubs } from './helpers/data';

/** Spec section 5: expected club strength order, best first. */
const EXPECTED_ORDER = [
  'Paris Saint-Germain',
  'Real Madrid',
  'Bayern Munich',
  'FC Barcelona',
  'Arsenal',
  'Manchester City',
  'Liverpool',
  'Inter Milan',
  'Atlético Madrid',
  'Manchester United',
  'Chelsea',
  'Borussia Dortmund',
  'Juventus',
  'Tottenham Hotspur',
  'AC Milan',
  'Aston Villa',
  'Newcastle United',
  'Brighton and Hove Albion',
  'Al-Nassr',
  'Inter Miami',
];

const strengths = computeClubStrengths(clubs, players);

describe('club strength', () => {
  it('reproduces the expected strength order from the spec', () => {
    expect(strengths.map((s) => s.clubName)).toEqual(EXPECTED_ORDER);
  });

  it('matches every strength_rating, rank and best formation in clubs.json', () => {
    for (const raw of rawClubs) {
      const s = strengths.find((x) => x.clubName === raw.name)!;
      expect(s.rating, raw.name).toBeCloseTo(raw.strength_rating, 2);
      expect(s.rank, raw.name).toBe(raw.strength_rank);
      expect(s.formation, raw.name).toBe(raw.best_formation);
    }
  });

  it('caps the depth bonus at +1.5', () => {
    expect(Math.max(...strengths.map((s) => s.depthBonus))).toBe(1.5);
    expect(strengths.every((s) => s.depthBonus >= 0)).toBe(true);
  });
});

describe('AI club selection', () => {
  it('takes the 17 strongest clubs for 3 humans', () => {
    const ids = selectAiClubIds(strengths, 3);
    expect(ids.map((id) => clubs.find((c) => c.id === id)!.name)).toEqual(EXPECTED_ORDER.slice(0, 17));
  });

  it('takes 19 clubs for a solo game and none for 20 humans', () => {
    expect(selectAiClubIds(strengths, 1)).toHaveLength(19);
    expect(selectAiClubIds(strengths, 20)).toEqual([]);
    expect(() => selectAiClubIds(strengths, 0)).toThrow(RangeError);
    expect(() => selectAiClubIds(strengths, 21)).toThrow(RangeError);
  });
});

describe('buildLeagueTeams', () => {
  const mbappe = playerByName('Kylian Mbappé');
  const courtois = playerByName('Thibaut Courtois');
  const realMadrid = clubId('Real Madrid');
  const human = {
    id: 'h:1',
    name: 'Galácticos',
    formation: '4-3-3' as const,
    picks: [
      { slotKey: 'ST', playerId: mbappe.id },
      { slotKey: 'GK', playerId: courtois.id },
    ],
  };
  const aiClubIds = selectAiClubIds(strengths, 3);

  it('builds 20 teams: the humans plus the AI clubs', () => {
    const teams = buildLeagueTeams({ clubs, players, humans: [human, { ...human, id: 'h:2', picks: [] }, { ...human, id: 'h:3', picks: [] }], aiClubIds });
    expect(teams).toHaveLength(20);
    expect(teams.filter((t) => t.kind === 'ai')).toHaveLength(17);
    expect(teams.every((t) => t.lineup.length === 11)).toBe(true);
  });

  it('removes drafted players from their AI club, which still fields 11', () => {
    const teams = buildLeagueTeams({ clubs, players, humans: [human], aiClubIds });
    const madrid = teams.find((t) => t.id === aiTeamId(realMadrid))!;
    expect(madrid.lineup).toHaveLength(11);
    const ids = madrid.lineup.map((e) => e.player.id);
    expect(ids).not.toContain(mbappe.id);
    expect(ids).not.toContain(courtois.id);
    expect(madrid.lineup.every((e) => !e.reserve)).toBe(true);
  });

  it('keeps drafted players in their club when the toggle is off', () => {
    const teams = buildLeagueTeams({ clubs, players, humans: [human], aiClubIds, removeDraftedFromAi: false });
    const madrid = teams.find((t) => t.id === aiTeamId(realMadrid))!;
    expect(madrid.lineup.map((e) => e.player.id)).toContain(mbappe.id);
  });

  it('rejects a player drafted by two teams', () => {
    expect(() =>
      buildLeagueTeams({
        clubs,
        players,
        humans: [human, { ...human, id: 'h:2', picks: [{ slotKey: 'ST', playerId: mbappe.id }] }],
        aiClubIds,
      }),
    ).toThrow(/two teams/);
  });
});
