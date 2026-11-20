/**
 * Which clubs join the league as AI teams. Admins can override a club's strength and choose the
 * selection method: top by strength (spec default), a manual list, or random.
 */
import { type ClubStrength, computeClubStrengths, createRng, LEAGUE_SIZE, selectAiClubIds } from '@draft-xi/engine';
import type { Database } from '../db/database';
import { getSetting, type SettingValue } from '../settings/app-settings';
import type { Pool } from './pool';

/** Club strengths with admin overrides applied, re-ranked. */
export function strengthsWithOverrides(pool: Pool): ClubStrength[] {
  const overrides = new Map(pool.clubs.flatMap((c) => (c.strengthOverride === null ? [] : [[c.id, c.strengthOverride] as const])));
  return computeClubStrengths(pool.engineClubs, pool.players)
    .map((s) => ({ ...s, rating: overrides.get(s.clubId) ?? s.rating }))
    .sort((a, b) => b.rating - a.rating || b.xiAverage - a.xiAverage || a.clubName.localeCompare(b.clubName))
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

export function chooseAiClubs(
  strengths: readonly ClubStrength[],
  humans: number,
  selection: SettingValue<'ai.selection'>,
  seed: number,
): number[] {
  if (humans >= LEAGUE_SIZE) return [];
  const needed = LEAGUE_SIZE - humans;
  if (selection.method === 'random') {
    return createRng(seed)
      .shuffle(strengths.map((s) => s.clubId))
      .slice(0, needed);
  }
  if (selection.method === 'manual') {
    const valid = new Set(strengths.map((s) => s.clubId));
    const chosen = [...new Set(selection.manualClubIds.filter((id) => valid.has(id)))].slice(0, needed);
    // Too few listed: fill with the strongest of the rest.
    for (const s of strengths) {
      if (chosen.length >= needed) break;
      if (!chosen.includes(s.clubId)) chosen.push(s.clubId);
    }
    return chosen;
  }
  return selectAiClubIds(strengths, humans);
}

export async function aiSelection(database: Database) {
  return getSetting(database, 'ai.selection');
}
