import { maxWeightAssignment } from './assignment';
import { FORMATION_IDS, type FormationId, type FormationSlot, getFormation } from './formations';
import type { Position } from './positions';
import type { SeasonResult, PlayerSeasonStat } from './season';
import { DEFAULT_SLOT_COMPATIBILITY, type SlotCompatibility } from './slots';

export interface DraftPickRecord {
  playerId: number;
  teamId: string;
  pickNumber: number;
}

export interface TeamOfSeasonSlot {
  slot: FormationSlot;
  stat: PlayerSeasonStat;
}

export interface DraftValueAward {
  stat: PlayerSeasonStat;
  pickNumber: number;
  /** Rank among drafted players by average rating, 1 = best. */
  performanceRank: number;
  /** pickNumber - performanceRank: positive means he outperformed his pick. */
  delta: number;
}

export interface SeasonAwards {
  championTeamId: string;
  goldenBoot: PlayerSeasonStat | null;
  playmaker: PlayerSeasonStat | null;
  goldenGlove: PlayerSeasonStat | null;
  playerOfTheSeason: PlayerSeasonStat | null;
  teamOfTheSeason: { formation: FormationId; slots: TeamOfSeasonSlot[] } | null;
  bestDraftSteal: DraftValueAward | null;
  biggestFlop: DraftValueAward | null;
}

export interface AwardOptions {
  picks?: readonly DraftPickRecord[];
  formations?: readonly FormationId[];
  compatibility?: SlotCompatibility;
  /** Minimum share of the season's matches for rating-based awards (default 0.5). */
  minAppearanceShare?: number;
}

function best(
  stats: readonly PlayerSeasonStat[],
  compare: (a: PlayerSeasonStat, b: PlayerSeasonStat) => number,
): PlayerSeasonStat | null {
  const sorted = [...stats].sort((a, b) => compare(a, b) || a.key.localeCompare(b.key));
  return sorted[0] ?? null;
}

/** Awards for a completed season (spec section 10). Generic reserves never win awards. */
export function computeAwards(season: SeasonResult, options: AwardOptions = {}): SeasonAwards {
  const real = season.playerStats.filter((s) => s.playerId !== null);
  const matchesPerTeam = season.table[0]?.played ?? 0;
  const minApps = Math.ceil(matchesPerTeam * (options.minAppearanceShare ?? 0.5));
  const regulars = real.filter((s) => s.appearances >= minApps);

  const goldenBoot = best(real, (a, b) => b.goals - a.goals || b.assists - a.assists || a.appearances - b.appearances);
  const playmaker = best(real, (a, b) => b.assists - a.assists || b.goals - a.goals || a.appearances - b.appearances);
  const goldenGlove = best(
    real.filter((s) => s.slotKey === 'GK'),
    (a, b) => b.cleanSheets - a.cleanSheets || b.avgRating - a.avgRating,
  );
  const playerOfTheSeason = best(regulars, (a, b) => b.avgRating - a.avgRating || b.goals - a.goals);

  return {
    championTeamId: season.championTeamId,
    goldenBoot: goldenBoot && goldenBoot.goals > 0 ? goldenBoot : null,
    playmaker: playmaker && playmaker.assists > 0 ? playmaker : null,
    goldenGlove,
    playerOfTheSeason,
    teamOfTheSeason: teamOfTheSeason(season, regulars, options),
    ...draftValueAwards(real, options.picks ?? []),
  };
}

/** Best XI by average rating, placed in whichever enabled formation scores highest. */
function teamOfTheSeason(
  season: SeasonResult,
  candidates: readonly PlayerSeasonStat[],
  options: AwardOptions,
): SeasonAwards['teamOfTheSeason'] {
  const compat = options.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const positions = new Map<string, readonly Position[]>();
  for (const team of season.teams) {
    for (const e of team.lineup) {
      if (e.player.id !== null) positions.set(`p${e.player.id}@${team.id}`, e.player.positions);
    }
  }
  const pool = candidates.filter((c) => positions.has(c.key));
  if (pool.length < 11) return null;

  let bestFit: { formation: FormationId; slots: TeamOfSeasonSlot[]; total: number } | undefined;
  for (const id of options.formations ?? FORMATION_IDS) {
    const slots = getFormation(id).slots;
    const weights = slots.map((slot) =>
      pool.map((c) => {
        const pos = positions.get(c.key)!;
        return pos.some((p) => compat[slot.type].includes(p)) ? Math.round(c.avgRating * 100) : null;
      }),
    );
    const chosen = maxWeightAssignment(weights);
    if (chosen.some((c) => c < 0)) continue;
    const picked = slots.map((slot, i) => ({ slot, stat: pool[chosen[i]!]! }));
    const total = picked.reduce((s, p) => s + p.stat.avgRating, 0);
    if (!bestFit || total > bestFit.total) bestFit = { formation: id, slots: picked, total };
  }
  return bestFit ? { formation: bestFit.formation, slots: bestFit.slots } : null;
}

function draftValueAwards(
  real: readonly PlayerSeasonStat[],
  picks: readonly DraftPickRecord[],
): Pick<SeasonAwards, 'bestDraftSteal' | 'biggestFlop'> {
  const statByKey = new Map(real.map((s) => [s.key, s]));
  const drafted = picks
    .map((p) => ({ pick: p, stat: statByKey.get(`p${p.playerId}@${p.teamId}`) }))
    .filter((d): d is { pick: DraftPickRecord; stat: PlayerSeasonStat } => d.stat !== undefined);
  if (drafted.length === 0) return { bestDraftSteal: null, biggestFlop: null };

  const byPerformance = [...drafted].sort(
    (a, b) => b.stat.avgRating - a.stat.avgRating || a.pick.pickNumber - b.pick.pickNumber,
  );
  const awards = byPerformance.map((d, i) => ({
    stat: d.stat,
    pickNumber: d.pick.pickNumber,
    performanceRank: i + 1,
    delta: d.pick.pickNumber - (i + 1),
  }));
  const steal = [...awards].sort((a, b) => b.delta - a.delta || a.performanceRank - b.performanceRank)[0]!;
  const flop = [...awards].sort((a, b) => a.delta - b.delta || a.pickNumber - b.pickNumber)[0]!;
  return {
    bestDraftSteal: steal.delta > 0 ? steal : null,
    biggestFlop: flop.delta < 0 ? flop : null,
  };
}
