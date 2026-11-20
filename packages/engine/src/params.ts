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
};

export function resolveParams(overrides: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_SIM_PARAMS,
    ...overrides,
    points: { ...DEFAULT_SIM_PARAMS.points, ...overrides.points },
    tiebreakers: [...(overrides.tiebreakers ?? DEFAULT_SIM_PARAMS.tiebreakers)],
  };
}
