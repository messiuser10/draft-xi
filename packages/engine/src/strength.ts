import { bestLineup, type LineupOptions } from './lineup';
import type { FormationId } from './formations';
import { round2 } from './ratings';
import type { EngineClub, EnginePlayer } from './types';

export const DEPTH_BONUS_PER_PLAYER = 0.1;
export const DEPTH_BONUS_CAP = 1.5;
/**
 * A bench player counts towards depth only if rated at least this. 70 reproduces every
 * strength_rating in the owner's clubs.json exactly.
 */
export const DEPTH_RATING_THRESHOLD = 70;

export interface ClubStrength {
  clubId: number;
  clubName: string;
  /** Best XI average plus depth bonus. */
  rating: number;
  xiAverage: number;
  depthBonus: number;
  formation: FormationId;
  squadSize: number;
  /** 1 = strongest. */
  rank: number;
}

/**
 * Club strength (spec section 5): average overall of the best XI in its best-fitting formation,
 * plus 0.1 per rated player (overall >= 70) beyond the XI, capped at +1.5.
 */
export function clubStrength(
  club: EngineClub,
  squad: readonly EnginePlayer[],
  options: LineupOptions = {},
): Omit<ClubStrength, 'rank'> {
  const sheet = bestLineup(squad, options);
  const xiAverage = sheet.lineup.reduce((sum, e) => sum + e.effectiveOverall, 0) / sheet.lineup.length;
  const inXi = new Set(sheet.lineup.flatMap((e) => (e.player.id === null ? [] : [e.player.id])));
  const ratedBench = squad.filter((p) => !inXi.has(p.id) && p.overall >= DEPTH_RATING_THRESHOLD).length;
  const depthBonus = Math.min(DEPTH_BONUS_CAP, DEPTH_BONUS_PER_PLAYER * ratedBench);
  return {
    clubId: club.id,
    clubName: club.name,
    rating: round2(xiAverage + depthBonus),
    xiAverage: round2(xiAverage),
    depthBonus: round2(depthBonus),
    formation: sheet.formation,
    squadSize: squad.length,
  };
}

/** Strength of every club from its full squad, strongest first (ties: better XI, then name). */
export function computeClubStrengths(
  clubs: readonly EngineClub[],
  players: readonly EnginePlayer[],
  options: LineupOptions = {},
): ClubStrength[] {
  const byClub = new Map<number, EnginePlayer[]>();
  for (const p of players) {
    const list = byClub.get(p.clubId) ?? [];
    list.push(p);
    byClub.set(p.clubId, list);
  }
  return clubs
    .map((c) => clubStrength(c, byClub.get(c.id) ?? [], options))
    .sort(
      (a, b) =>
        b.rating - a.rating || b.xiAverage - a.xiAverage || a.clubName.localeCompare(b.clubName),
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

export const LEAGUE_SIZE = 20;

/** The (20 - N) strongest clubs join the league as AI teams (spec section 1, rule 4). */
export function selectAiClubIds(
  strengths: readonly ClubStrength[],
  humanCount: number,
  leagueSize = LEAGUE_SIZE,
): number[] {
  if (!Number.isInteger(humanCount) || humanCount < 1 || humanCount > leagueSize) {
    throw new RangeError(`humanCount must be 1 to ${leagueSize}, got ${humanCount}`);
  }
  const needed = leagueSize - humanCount;
  if (strengths.length < needed) {
    throw new RangeError(`Need ${needed} clubs for AI teams but only ${strengths.length} exist`);
  }
  return [...strengths]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, needed)
    .map((s) => s.clubId);
}
