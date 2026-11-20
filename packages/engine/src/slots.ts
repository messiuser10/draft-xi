import type { Position } from './positions';

/** Slot types that appear in formations (spec section 4). There is no CF slot; ST accepts CF. */
export const SLOT_TYPES = [
  'GK',
  'RB',
  'LB',
  'CB',
  'RWB',
  'LWB',
  'CDM',
  'CM',
  'CAM',
  'RM',
  'LM',
  'RW',
  'LW',
  'ST',
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

/** Which player positions each slot accepts. Admin-editable; this is the default. */
export type SlotCompatibility = Readonly<Record<SlotType, readonly Position[]>>;

export const DEFAULT_SLOT_COMPATIBILITY: SlotCompatibility = {
  GK: ['GK'],
  RB: ['RB', 'RWB'],
  LB: ['LB', 'LWB'],
  CB: ['CB'],
  RWB: ['RWB', 'RB'],
  LWB: ['LWB', 'LB'],
  CDM: ['CDM', 'CM'],
  CM: ['CM', 'CDM', 'CAM'],
  CAM: ['CAM', 'CM'],
  RM: ['RM', 'RW'],
  LM: ['LM', 'LW'],
  RW: ['RW', 'RM'],
  LW: ['LW', 'LM'],
  ST: ['ST', 'CF'],
};

export interface HasPositions {
  primaryPosition: Position;
  altPositions: readonly Position[];
}

export function playerPositions(p: HasPositions): Position[] {
  return [p.primaryPosition, ...p.altPositions];
}

export function isGoalkeeper(p: HasPositions): boolean {
  return p.primaryPosition === 'GK';
}

/** True when the slot accepts one of the player's listed positions. */
export function fitsSlot(
  p: HasPositions,
  slotType: SlotType,
  compatibility: SlotCompatibility = DEFAULT_SLOT_COMPATIBILITY,
): boolean {
  const accepted = compatibility[slotType];
  return accepted.includes(p.primaryPosition) || p.altPositions.some((a) => accepted.includes(a));
}

/** Slots that earn a clean sheet when the opponent does not score. */
export const DEFENSIVE_SLOTS: ReadonlySet<SlotType> = new Set(['GK', 'CB', 'RB', 'LB', 'RWB', 'LWB']);
