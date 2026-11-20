/** Draft grades and pick tags (spec section 10). */

export const LETTER_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'] as const;
export type LetterGrade = (typeof LETTER_GRADES)[number];

export interface DraftGrade {
  grade: LetterGrade;
  /** 0 (worst) to 1 (best). */
  score: number;
}

/**
 * Letter grade from the team's pre-season strength rank among all teams and, once the season is
 * over, its final position. Both count equally; before the season (the Team Reveal preview)
 * only the strength rank is used.
 */
export function draftGrade(preseasonRank: number, finish?: number, teamCount = 20): DraftGrade {
  const scale = (rank: number) => {
    if (!Number.isInteger(rank) || rank < 1 || rank > teamCount) {
      throw new RangeError(`rank must be 1 to ${teamCount}, got ${rank}`);
    }
    return teamCount === 1 ? 1 : (teamCount - rank) / (teamCount - 1);
  };
  const score = finish === undefined ? scale(preseasonRank) : (scale(preseasonRank) + scale(finish)) / 2;
  // 13 grades over [0, 1]; F covers the bottom band.
  const index = Math.min(LETTER_GRADES.length - 1, Math.floor((1 - score) * LETTER_GRADES.length));
  return { grade: LETTER_GRADES[index]!, score: Math.round(score * 1000) / 1000 };
}

export type PickTag = 'Steal' | 'Fair' | 'Reach';

/**
 * Rank of each player in the pool by overall, 1 = best. Equal overalls share a rank
 * (competition ranking: 1, 2, 2, 4).
 */
export function poolRanks(players: readonly { id: number; overall: number }[]): Map<number, number> {
  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  const ranks = new Map<number, number>();
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    ranks.set(p.id, prev && prev.overall === p.overall ? ranks.get(prev.id)! : i + 1);
  });
  return ranks;
}

/**
 * Steal when a player went noticeably later than his pool rank, Reach when noticeably earlier.
 * "Noticeably" is max(3, 20% of the pick number), so early picks need a smaller gap.
 */
export function tagPick(pickNumber: number, poolRank: number): PickTag {
  const threshold = Math.max(3, Math.round(pickNumber * 0.2));
  const gap = pickNumber - poolRank;
  if (gap >= threshold) return 'Steal';
  if (gap <= -threshold) return 'Reach';
  return 'Fair';
}
