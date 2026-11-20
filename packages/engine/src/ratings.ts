import type { LineupEntry } from './lineup';
import type { SlotType } from './slots';

/** Attack and defense weight per slot type (spec section 9, step 3). */
export const SLOT_WEIGHTS: Readonly<Record<SlotType, { attack: number; defense: number }>> = {
  GK: { attack: 0, defense: 1.6 },
  CB: { attack: 0.1, defense: 1.0 },
  LB: { attack: 0.35, defense: 0.7 },
  RB: { attack: 0.35, defense: 0.7 },
  LWB: { attack: 0.35, defense: 0.7 },
  RWB: { attack: 0.35, defense: 0.7 },
  CDM: { attack: 0.2, defense: 0.8 },
  CM: { attack: 0.5, defense: 0.5 },
  CAM: { attack: 0.8, defense: 0.2 },
  LM: { attack: 0.7, defense: 0.3 },
  RM: { attack: 0.7, defense: 0.3 },
  LW: { attack: 0.9, defense: 0.1 },
  RW: { attack: 0.9, defense: 0.1 },
  ST: { attack: 1.0, defense: 0 },
};

export const CHEMISTRY = {
  sameClubPair: 0.25,
  sameClubCap: 2.0,
  sameNationalityPair: 0.1,
  sameNationalityCap: 1.0,
} as const;

export interface TeamRating {
  /** Weighted attack average plus chemistry. */
  attack: number;
  /** Weighted defense average plus chemistry. */
  defense: number;
  chemistry: number;
  /** Plain average effective overall of the XI. */
  overall: number;
  /** (attack + defense) / 2, used to rank teams before a season. */
  strength: number;
}

const pairs = (k: number) => (k * (k - 1)) / 2;

function countBy(values: readonly (string | number)[]): Map<string | number, number> {
  const counts = new Map<string | number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** Same real club pairs (+0.25, cap 2.0) and same nationality pairs (+0.1, cap 1.0). Reserves don't count. */
export function chemistryBonus(lineup: readonly LineupEntry[]): number {
  const real = lineup.filter((e) => e.player.id !== null);
  let clubPairs = 0;
  for (const k of countBy(real.flatMap((e) => (e.player.clubId === null ? [] : [e.player.clubId]))).values()) {
    clubPairs += pairs(k);
  }
  let natPairs = 0;
  for (const k of countBy(real.flatMap((e) => (e.player.nationality ? [e.player.nationality] : []))).values()) {
    natPairs += pairs(k);
  }
  const club = Math.min(CHEMISTRY.sameClubCap, clubPairs * CHEMISTRY.sameClubPair);
  const nat = Math.min(CHEMISTRY.sameNationalityCap, natPairs * CHEMISTRY.sameNationalityPair);
  return round2(club + nat);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rates any XI the same way, human or AI. */
export function rateTeam(lineup: readonly LineupEntry[], options: { chemistry?: boolean } = {}): TeamRating {
  let attSum = 0;
  let attW = 0;
  let defSum = 0;
  let defW = 0;
  let total = 0;
  for (const e of lineup) {
    const w = SLOT_WEIGHTS[e.slotType];
    attSum += w.attack * e.effectiveOverall;
    attW += w.attack;
    defSum += w.defense * e.effectiveOverall;
    defW += w.defense;
    total += e.effectiveOverall;
  }
  const chemistry = (options.chemistry ?? true) ? chemistryBonus(lineup) : 0;
  const attack = (attW > 0 ? attSum / attW : 0) + chemistry;
  const defense = (defW > 0 ? defSum / defW : 0) + chemistry;
  return {
    attack: round2(attack),
    defense: round2(defense),
    chemistry,
    overall: round2(lineup.length > 0 ? total / lineup.length : 0),
    strength: round2((attack + defense) / 2),
  };
}
