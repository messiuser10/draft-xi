import { chooseSlot, type AutoPickChoice } from './draft';
import type { FormationSlot } from './formations';
import type { Rng } from './rng';
import { DEFAULT_SLOT_COMPATIBILITY, fitsSlot, type SlotCompatibility } from './slots';
import type { EnginePlayer } from './types';

export type BotLevel = 'easy' | 'medium' | 'hard';

export interface BotPickInput {
  level: BotLevel;
  available: readonly EnginePlayer[];
  openSlots: readonly FormationSlot[];
  /** Players this team already drafted (for chemistry). */
  roster: readonly EnginePlayer[];
  compatibility?: SlotCompatibility;
  clubAllowance?: ReadonlyMap<number, number>;
  /** Open slots of every other team, so Hard bots can see which positions are running out. */
  rivalOpenSlots?: readonly (readonly FormationSlot[])[];
}

/** Chemistry a candidate would add with the current roster (same weights as team ratings). */
function chemistryGain(player: EnginePlayer, roster: readonly EnginePlayer[]): number {
  let gain = 0;
  for (const r of roster) {
    if (r.clubId === player.clubId) gain += 0.25;
    if (r.nationality === player.nationality) gain += 0.1;
  }
  return gain;
}

/**
 * A bot's pick (spec section 8). Easy: one of the five best fitting players at random.
 * Medium: overall plus club and nationality chemistry with its roster. Hard: Medium plus a
 * premium for open slots that few remaining players can fill, given what rivals still need.
 */
export function botPick(input: BotPickInput, rng: Rng): AutoPickChoice | undefined {
  const compat = input.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const allowed = (p: EnginePlayer) => {
    const left = input.clubAllowance?.get(p.clubId);
    return left === undefined || left > 0;
  };
  const candidates = input.available.filter(
    (p) => allowed(p) && input.openSlots.some((s) => fitsSlot(p, s.type, compat)),
  );
  if (candidates.length === 0) return undefined;

  if (input.level === 'easy') {
    const top = [...candidates].sort((a, b) => b.overall - a.overall || a.id - b.id).slice(0, 5);
    const player = rng.pick(top);
    const slot = chooseSlot(player, input.openSlots, compat)!;
    return { player, slot, fromQueue: false };
  }

  // Scarcity per open slot type: fitting players left divided by how many teams still need it.
  const scarcity = new Map<string, number>();
  if (input.level === 'hard') {
    for (const slot of input.openSlots) {
      if (scarcity.has(slot.type)) continue;
      const supply = candidates.filter((p) => fitsSlot(p, slot.type, compat)).length;
      const demand =
        1 + (input.rivalOpenSlots ?? []).reduce((n, slots) => n + slots.filter((s) => s.type === slot.type).length, 0);
      scarcity.set(slot.type, supply / demand);
    }
  }

  let best: { score: number; player: EnginePlayer; slot: FormationSlot } | undefined;
  for (const player of candidates) {
    for (const slot of input.openSlots) {
      if (!fitsSlot(player, slot.type, compat)) continue;
      let score = player.overall + 4 * chemistryGain(player, input.roster);
      if (slot.type === player.primaryPosition) score += 0.5;
      const ratio = scarcity.get(slot.type);
      // Under about three good options per team needing the slot, reach for it now.
      if (ratio !== undefined && ratio < 3) score += (3 - ratio) * 2;
      score += rng.next() * 1.5;
      if (!best || score > best.score) best = { score, player, slot };
    }
  }
  return best ? { player: best.player, slot: best.slot, fromQueue: false } : undefined;
}

export type RatingTier = 'Elite' | 'Gold' | 'Silver' | 'Bronze';

/** Spec section 8: Elite 88+, Gold 82 to 87, Silver 75 to 81, Bronze below 75. */
export function ratingTier(overall: number): RatingTier {
  if (overall >= 88) return 'Elite';
  if (overall >= 82) return 'Gold';
  if (overall >= 75) return 'Silver';
  return 'Bronze';
}
