import { type FormationId, getFormation } from './formations';
import { DEFAULT_SLOT_COMPATIBILITY, fitsSlot, type SlotCompatibility, SLOT_TYPES, type SlotType } from './slots';
import type { EnginePlayer } from './types';

export const SLOT_LABELS: Readonly<Record<SlotType, string>> = {
  GK: 'goalkeepers',
  RB: 'right-backs',
  LB: 'left-backs',
  CB: 'centre-backs',
  RWB: 'right wing-backs',
  LWB: 'left wing-backs',
  CDM: 'defensive midfielders',
  CM: 'central midfielders',
  CAM: 'attacking midfielders',
  RM: 'right midfielders',
  LM: 'left midfielders',
  RW: 'right wingers',
  LW: 'left wingers',
  ST: 'strikers',
};

export interface PoolHealthInput {
  players: readonly EnginePlayer[];
  /** One formation per drafting team. */
  formations: readonly FormationId[];
  compatibility?: SlotCompatibility;
  /** When false, any player may fill any slot (out of position), so only the total matters. */
  strictPositions?: boolean;
}

export interface PoolHealth {
  ok: boolean;
  teams: number;
  byPosition: { slotType: SlotType; label: string; needed: number; available: number }[];
  /** Slots that can be filled at the same time (maximum matching). */
  fillable: number;
  totalSlots: number;
  warnings: string[];
}

/**
 * Spec section 7: compares available players per position with the slots the drafting teams
 * need, and checks the whole draft is feasible at once (a player who fits two slot types can only
 * fill one), using a maximum bipartite matching from slots to players.
 */
export function poolHealth(input: PoolHealthInput): PoolHealth {
  const compatibility = input.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const strict = input.strictPositions ?? true;
  const needed = new Map<SlotType, number>();
  for (const f of input.formations) {
    for (const slot of getFormation(f).slots) needed.set(slot.type, (needed.get(slot.type) ?? 0) + 1);
  }

  const fitting = new Map<SlotType, number[]>();
  for (const type of SLOT_TYPES) {
    if (!needed.has(type)) continue;
    fitting.set(
      type,
      input.players.flatMap((p, i) => (fitsSlot(p, type, compatibility) ? [i] : [])),
    );
  }

  const byPosition = SLOT_TYPES.filter((t) => needed.has(t)).map((slotType) => ({
    slotType,
    label: SLOT_LABELS[slotType],
    needed: needed.get(slotType) ?? 0,
    available: fitting.get(slotType)?.length ?? 0,
  }));
  const totalSlots = byPosition.reduce((sum, r) => sum + r.needed, 0);

  const warnings: string[] = [];
  let fillable: number;
  if (strict) {
    for (const r of byPosition) {
      if (r.available < r.needed) {
        warnings.push(`Not enough ${r.label} for this many teams (${r.needed} needed, ${r.available} in the pool)`);
      }
    }
    const slots = byPosition.flatMap((r) => Array<SlotType>(r.needed).fill(r.slotType));
    fillable = maxMatching(slots, fitting, input.players.length);
    if (fillable < totalSlots && warnings.length === 0) {
      warnings.push(
        `The pool cannot fill every slot at once (${fillable} of ${totalSlots}); some players are needed in two positions`,
      );
    }
  } else {
    fillable = Math.min(totalSlots, input.players.length);
    if (fillable < totalSlots) {
      warnings.push(`Not enough players for this many teams (${totalSlots} needed, ${input.players.length} in the pool)`);
    }
  }

  return { ok: fillable === totalSlots, teams: input.formations.length, byPosition, fillable, totalSlots, warnings };
}

/** Kuhn's augmenting-path matching: slot instances on the left, players on the right. */
function maxMatching(slots: readonly SlotType[], fitting: ReadonlyMap<SlotType, number[]>, playerCount: number): number {
  const owner = new Int32Array(playerCount).fill(-1);
  let matched = 0;
  for (let s = 0; s < slots.length; s++) {
    const seen = new Uint8Array(playerCount);
    const tryAssign = (slot: number): boolean => {
      for (const p of fitting.get(slots[slot] as SlotType) ?? []) {
        if (seen[p]) continue;
        seen[p] = 1;
        const current = owner[p] as number;
        if (current === -1 || tryAssign(current)) {
          owner[p] = slot;
          return true;
        }
      }
      return false;
    };
    if (tryAssign(s)) matched++;
  }
  return matched;
}
