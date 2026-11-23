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
   * 0 to 1. How far apart AI clubs play: 1 keeps their real-data ratings, lower pulls each AI
   * club's attack and defense towards the AI average, so super-clubs like PSG are less dominant
   * and drafted teams can win. Human teams are never changed.
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
  /**
   * In-season streaks, in rating points: on top of season form, each team's level drifts from
   * matchday to matchday (standard deviation = this, each matchday keeping STREAK_MEMORY of the
   * last), giving hot and cold runs of several weeks. 0 turns it off.
   */
  streaks: number;
  /**
   * Expected goals shared by both sides (a bivariate Poisson term). It keeps the goal average and
   * win odds roughly the same but makes level scores likelier, matching real draw rates
   * (about 25%). 0 turns it off.
   */
  sharedGoals: number;
}

export const TIEBREAK_KEYS = ['goalDifference', 'goalsFor', 'headToHead', 'wins'] as const;
export type TiebreakKey = (typeof TIEBREAK_KEYS)[number];

/**
 * Tuned to real top-flight leagues (see DECISIONS.md): champion about 80 points, bottom team
 * about 27, 2.75 goals per match, 45% home wins and about 27% draws. AI clubs are pulled halfway
 * to the AI average (aiSpread 0.5), so a well-drafted team wins the league about 45% of the time
 * and makes the top four about 80%. Spec defaults were baseGoals 1.35, homeAdvantage 1.10,
 * sensitivity 0.05.
 */
export const DEFAULT_SIM_PARAMS: Readonly<SimParams> = {
  baseGoals: 1.15,
  homeAdvantage: 1.3,
  sensitivity: 0.08,
  chaos: 0.5,
  outOfPositionPenalty: 8,
  reserveRating: 62,
  chemistry: true,
  injuries: false,
  points: { win: 3, draw: 1, loss: 0 },
  tiebreakers: ['goalDifference', 'goalsFor', 'headToHead'],
  aiSpread: 0.5,
  aiCatchUp: 0,
  form: 1.25,
  streaks: 1,
  sharedGoals: 0.3,
};

export function resolveParams(overrides: Partial<SimParams> = {}): SimParams {
  return {
    ...DEFAULT_SIM_PARAMS,
    ...overrides,
    points: { ...DEFAULT_SIM_PARAMS.points, ...overrides.points },
    tiebreakers: [...(overrides.tiebreakers ?? DEFAULT_SIM_PARAMS.tiebreakers)],
  };
}
