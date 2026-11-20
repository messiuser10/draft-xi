import { maxWeightAssignment } from './assignment';
import { FORMATION_IDS, type FormationId, type FormationSlot, getFormation } from './formations';
import type { Position } from './positions';
import {
  DEFAULT_SLOT_COMPATIBILITY,
  fitsSlot,
  isGoalkeeper,
  type SlotCompatibility,
  type SlotType,
} from './slots';
import type { EnginePlayer } from './types';

/** Who is standing in a slot: a real player (id set) or a generic reserve (id null). */
export interface LineupPlayer {
  id: number | null;
  name: string;
  overall: number;
  clubId: number | null;
  nationality: string | null;
  positions: readonly Position[];
}

export interface LineupEntry {
  slotKey: string;
  slotType: SlotType;
  x: number;
  y: number;
  player: LineupPlayer;
  /** Overall after any out-of-position penalty. This is what ratings use. */
  effectiveOverall: number;
  outOfPosition: boolean;
  reserve: boolean;
}

export interface TeamSheet {
  formation: FormationId;
  lineup: LineupEntry[];
}

export interface LineupOptions {
  formations?: readonly FormationId[];
  compatibility?: SlotCompatibility;
  outOfPositionPenalty?: number;
  reserveRating?: number;
}

export const ACADEMY_RESERVE_NAME = 'Academy Reserve';

export function toLineupPlayer(p: EnginePlayer): LineupPlayer {
  return {
    id: p.id,
    name: p.name,
    overall: p.overall,
    clubId: p.clubId,
    nationality: p.nationality,
    positions: [p.primaryPosition, ...p.altPositions],
  };
}

export function reservePlayer(slotType: SlotType, rating: number, name = ACADEMY_RESERVE_NAME): LineupPlayer {
  return {
    id: null,
    name,
    overall: rating,
    clubId: null,
    nationality: null,
    positions: [slotType === 'ST' ? 'ST' : slotType],
  };
}

function entry(
  slot: FormationSlot,
  player: LineupPlayer,
  effectiveOverall: number,
  outOfPosition: boolean,
  reserve: boolean,
): LineupEntry {
  return {
    slotKey: slot.key,
    slotType: slot.type,
    x: slot.x,
    y: slot.y,
    player,
    effectiveOverall,
    outOfPosition,
    reserve,
  };
}

// Score tiers so the assignment always prefers a compatible player over an out-of-position
// one, and an out-of-position player over an Academy Reserve (spec section 9, step 2).
const COMPATIBLE_BONUS = 2000;
const OUT_OF_POSITION_BONUS = 1000;

interface FormationFit {
  sheet: TeamSheet;
  /** Tiered score used only to compare formations. */
  score: number;
}

export function bestLineupForFormation(
  squad: readonly EnginePlayer[],
  formationId: FormationId,
  options: LineupOptions = {},
): FormationFit {
  const compatibility = options.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const penalty = options.outOfPositionPenalty ?? 8;
  const reserveRating = options.reserveRating ?? 62;
  const slots = getFormation(formationId).slots;

  // Columns: every squad player, then one reserve per slot.
  const weights = slots.map((slot) => {
    const row: (number | null)[] = squad.map((p) => {
      if (fitsSlot(p, slot.type, compatibility)) return COMPATIBLE_BONUS + p.overall;
      if (isGoalkeeper(p)) return null; // goalkeepers never play outfield
      return OUT_OF_POSITION_BONUS + Math.max(0, p.overall - penalty);
    });
    for (let r = 0; r < slots.length; r++) row.push(reserveRating);
    return row;
  });

  const chosen = maxWeightAssignment(weights);
  let score = 0;
  const lineup = slots.map((slot, i) => {
    const col = chosen[i] ?? -1;
    const p = col >= 0 && col < squad.length ? squad[col] : undefined;
    if (!p) {
      score += reserveRating;
      return entry(slot, reservePlayer(slot.type, reserveRating), reserveRating, false, true);
    }
    const fits = fitsSlot(p, slot.type, compatibility);
    const effective = fits ? p.overall : Math.max(0, p.overall - penalty);
    score += (fits ? COMPATIBLE_BONUS : OUT_OF_POSITION_BONUS) + effective;
    return entry(slot, toLineupPlayer(p), effective, !fits, false);
  });
  return { sheet: { formation: formationId, lineup }, score };
}

/** Tries every enabled formation and keeps the strongest XI (spec section 9, step 2). */
export function bestLineup(squad: readonly EnginePlayer[], options: LineupOptions = {}): TeamSheet {
  const formations = options.formations ?? FORMATION_IDS;
  let best: FormationFit | undefined;
  for (const id of formations) {
    const fit = bestLineupForFormation(squad, id, options);
    if (!best || fit.score > best.score) best = fit;
  }
  if (!best) throw new Error('No formations enabled');
  return best.sheet;
}

export interface PlacedPick {
  slotKey: string;
  player: EnginePlayer;
}

export class LineupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineupError';
  }
}

/**
 * A human team's XI from its draft picks. With `strict` (the default) every player must fit
 * his slot; otherwise mismatches take the out-of-position penalty. Empty slots get reserves.
 */
export function lineupFromPicks(
  formationId: FormationId,
  picks: readonly PlacedPick[],
  options: LineupOptions & { strict?: boolean } = {},
): TeamSheet {
  const compatibility = options.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const penalty = options.outOfPositionPenalty ?? 8;
  const reserveRating = options.reserveRating ?? 62;
  const strict = options.strict ?? true;
  const bySlot = new Map<string, EnginePlayer>();
  const slots = getFormation(formationId).slots;
  const slotKeys = new Set(slots.map((s) => s.key));
  const seenPlayers = new Set<number>();

  for (const pick of picks) {
    if (!slotKeys.has(pick.slotKey)) {
      throw new LineupError(`${formationId} has no slot ${pick.slotKey}`);
    }
    if (bySlot.has(pick.slotKey)) throw new LineupError(`Slot ${pick.slotKey} is filled twice`);
    if (seenPlayers.has(pick.player.id)) throw new LineupError(`${pick.player.name} is picked twice`);
    bySlot.set(pick.slotKey, pick.player);
    seenPlayers.add(pick.player.id);
  }

  const lineup = slots.map((slot) => {
    const p = bySlot.get(slot.key);
    if (!p) return entry(slot, reservePlayer(slot.type, reserveRating), reserveRating, false, true);
    const fits = fitsSlot(p, slot.type, compatibility);
    if (!fits && strict) {
      throw new LineupError(`${p.name} (${p.primaryPosition}) cannot play ${slot.type}`);
    }
    const effective = fits ? p.overall : Math.max(0, p.overall - penalty);
    return entry(slot, toLineupPlayer(p), effective, !fits, false);
  });
  return { formation: formationId, lineup };
}
