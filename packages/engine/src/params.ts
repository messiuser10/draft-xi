/** Simulation parameters (spec section 9). All admin-editable. */
export interface SimParams {
  baseGoals: number;
  homeAdvantage: number;
  sensitivity: number;
  /** 0 to 1. Scales the per-match log-normal noise (sigma = chaos x 0.2). */
  chaos: number;
  outOfPositionPenalty: number;
  /** Rating of the generic Academy Reserve used when a club has nobody left for a slot. */
  reserveRating: number;
  chemistry: boolean;
  injuries: boolean;
  points: { win: number; draw: number; loss: number };
  /** Order of tiebreakers after points; a seeded draw always settles what is left. */
  tiebreakers: TiebreakKey[];
  /**
   * 0 to 1. How far apart AI clubs play: 1 (default, off) keeps their real-data ratings, lower
   * pulls each AI club's attack and defense towards the AI average. Human teams are never changed.
   */
  aiSpread: number;
  /**
   * 0 to 1. How far AI clubs close the gap to the drafted teams: each AI club's attack and defense
   * rise by this share of (drafted average minus AI average). Drafted XIs are all-stars taken from
   * every club, so without this they usually win. 0 (default) turns it off.
   */
  aiCatchUp: number;
  /**
   * Season form, in rating points: each team's attack and defense move by the same seeded
   * normal swing (standard deviation = this) for the whole season, for humans and AI alike.
   * It models the good and bad years real clubs have, so the best side is the favourite but
   * not a certainty. 0 turns it off.
   */
  form: number;
}

export const TIEBREAK_KEYS = ['goalDifference', 'goalsFor', 'headToHead', 'wins'] as const;
export type TiebreakKey = (typeof TIEBREAK_KEYS)[number];

/**
 * Spec defaults, except baseGoals (1.35 -> 1.25) and sensitivity (0.05 -> 0.09), tuned so a
 * 3-human league gives champions around 87 points, bottom teams around 28 and about 2.75 goals
 * per match (M1 realism targets). See DECISIONS.md.
 */
export const DEFAULT_SIM_PARAMS: Readonly<SimParams> = {
  baseGoals: 1.25,
  homeAdvantage: 1.1,
  sensitivity: 0.09,
  chaos: 0.5,
  outOfPositionPenalty: 8,
  reserveRating: 62,
  chemistry: true,
  injuries: false,
  points: { win: 3, draw: 1, loss: 0 },
  tiebreakers: ['goalDifference', 'goalsFor', 'headToHead'],
  aiSpread: 1,
  aiCatchUp: 0,
  form: 2,
};

export function resolveParams(overrides: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_SIM_PARAMS,
    ...overrides,
    points: { ...DEFAULT_SIM_PARAMS.points, ...overrides.points },
    tiebreakers: [...(overrides.tiebreakers ?? DEFAULT_SIM_PARAMS.tiebreakers)],
  };
}
