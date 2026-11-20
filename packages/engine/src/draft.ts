import { type FormationId, type FormationSlot, getFormation } from './formations';
import type { Rng } from './rng';
import { DEFAULT_SLOT_COMPATIBILITY, fitsSlot, type SlotCompatibility } from './slots';
import type { EnginePlayer } from './types';

export const ROUNDS = 11;
export type DraftMode = 'snake' | 'linear' | 'pack';

/**
 * Which participant (0-based index into the frozen pick order) makes pick `pickNumber` (1-based).
 * Snake reverses every other round; linear and pack keep the same order each round.
 */
export function pickTurn(
  pickNumber: number,
  participantCount: number,
  mode: DraftMode,
): { round: number; participantIndex: number } {
  if (participantCount < 1) throw new RangeError('participantCount must be at least 1');
  if (!Number.isInteger(pickNumber) || pickNumber < 1 || pickNumber > participantCount * ROUNDS) {
    throw new RangeError(`pickNumber must be 1 to ${participantCount * ROUNDS}`);
  }
  const round = Math.ceil(pickNumber / participantCount);
  const inRound = (pickNumber - 1) % participantCount;
  const reversed = mode === 'snake' && round % 2 === 0;
  return { round, participantIndex: reversed ? participantCount - 1 - inRound : inRound };
}

export function totalPicks(participantCount: number): number {
  return participantCount * ROUNDS;
}

export function openSlots(formationId: FormationId, filledSlotKeys: Iterable<string>): FormationSlot[] {
  const filled = new Set(filledSlotKeys);
  return getFormation(formationId).slots.filter((s) => !filled.has(s.key));
}

export function fittingSlots(
  player: EnginePlayer,
  slots: readonly FormationSlot[],
  compatibility: SlotCompatibility = DEFAULT_SLOT_COMPATIBILITY,
): FormationSlot[] {
  return slots.filter((s) => fitsSlot(player, s.type, compatibility));
}

/** Best open slot for a player: one matching his primary position exactly, else the first that fits. */
export function chooseSlot(
  player: EnginePlayer,
  slots: readonly FormationSlot[],
  compatibility: SlotCompatibility = DEFAULT_SLOT_COMPATIBILITY,
): FormationSlot | undefined {
  const fitting = fittingSlots(player, slots, compatibility);
  return fitting.find((s) => s.type === player.primaryPosition) ?? fitting[0];
}

export interface AutoPickInput {
  available: readonly EnginePlayer[];
  openSlots: readonly FormationSlot[];
  /** Player ids in the participant's queue order. */
  queue?: readonly number[];
  compatibility?: SlotCompatibility;
  /** Players from one real club the team may still take (club cap), by club id. */
  clubAllowance?: ReadonlyMap<number, number>;
}

export interface AutoPickChoice {
  player: EnginePlayer;
  slot: FormationSlot;
  fromQueue: boolean;
}

/**
 * Auto-pick on timer expiry (spec section 8): the first queued player who is available and
 * fits; otherwise the scarcest open slot (fewest fitting players left) gets the
 * highest-overall player who fits it.
 */
export function autoPick(input: AutoPickInput): AutoPickChoice | undefined {
  const compat = input.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const allowed = (p: EnginePlayer) => {
    const left = input.clubAllowance?.get(p.clubId);
    return left === undefined || left > 0;
  };
  const pool = input.available.filter(allowed);
  const byId = new Map(pool.map((p) => [p.id, p]));

  for (const id of input.queue ?? []) {
    const p = byId.get(id);
    if (!p) continue;
    const slot = chooseSlot(p, input.openSlots, compat);
    if (slot) return { player: p, slot, fromQueue: true };
  }

  let best: { slot: FormationSlot; candidates: EnginePlayer[] } | undefined;
  for (const slot of input.openSlots) {
    const candidates = pool.filter((p) => fitsSlot(p, slot.type, compat));
    if (candidates.length === 0) continue;
    if (!best || candidates.length < best.candidates.length) best = { slot, candidates };
  }
  if (!best) return undefined;
  const player = [...best.candidates].sort((a, b) => b.overall - a.overall || a.id - b.id)[0]!;
  return { player, slot: best.slot, fromQueue: false };
}

/** Pack Pick: up to `size` random available players who fit at least one open slot. */
export function packOptions(
  available: readonly EnginePlayer[],
  slots: readonly FormationSlot[],
  rng: Rng,
  size = 5,
  compatibility: SlotCompatibility = DEFAULT_SLOT_COMPATIBILITY,
): EnginePlayer[] {
  const fitting = available.filter((p) => slots.some((s) => fitsSlot(p, s.type, compatibility)));
  return rng.shuffle(fitting).slice(0, size);
}

export interface SimulatedDrafter {
  formation: FormationId;
}

export interface SimulatedPick {
  pickNumber: number;
  round: number;
  participantIndex: number;
  player: EnginePlayer;
  slotKey: string;
}

/**
 * A whole draft made by simple random drafters: each pick is a random choice among the
 * `topK` best available players who fit an open slot. Used by the sim CLI and Test Draft.
 */
export function simulateRandomDraft(
  pool: readonly EnginePlayer[],
  drafters: readonly SimulatedDrafter[],
  rng: Rng,
  options: { mode?: DraftMode; topK?: number; compatibility?: SlotCompatibility } = {},
): SimulatedPick[] {
  const mode = options.mode ?? 'snake';
  const topK = options.topK ?? 6;
  const compat = options.compatibility ?? DEFAULT_SLOT_COMPATIBILITY;
  const available = new Map(pool.map((p) => [p.id, p]));
  const filled = drafters.map(() => new Set<string>());
  const picks: SimulatedPick[] = [];

  for (let pickNumber = 1; pickNumber <= totalPicks(drafters.length); pickNumber++) {
    const { round, participantIndex } = pickTurn(pickNumber, drafters.length, mode);
    const drafter = drafters[participantIndex]!;
    const open = openSlots(drafter.formation, filled[participantIndex]!);
    const candidates = [...available.values()]
      .filter((p) => open.some((s) => fitsSlot(p, s.type, compat)))
      .sort((a, b) => b.overall - a.overall || a.id - b.id);
    let player = candidates.length > 0 ? rng.pick(candidates.slice(0, topK)) : undefined;
    let slot = player ? chooseSlot(player, open, compat) : undefined;
    if (!player || !slot) {
      const fallback = autoPick({ available: [...available.values()], openSlots: open, compatibility: compat });
      if (!fallback) throw new Error(`Pool cannot fill ${drafter.formation} for drafter ${participantIndex + 1}`);
      player = fallback.player;
      slot = fallback.slot;
    }
    available.delete(player.id);
    filled[participantIndex]!.add(slot.key);
    picks.push({ pickNumber, round, participantIndex, player, slotKey: slot.key });
  }
  return picks;
}
