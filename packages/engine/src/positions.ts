/** Every player position the game understands (spec section 4). */
export const POSITIONS = [
  'GK',
  'RB',
  'CB',
  'LB',
  'RWB',
  'LWB',
  'CDM',
  'CM',
  'CAM',
  'RM',
  'LM',
  'RW',
  'LW',
  'CF',
  'ST',
] as const;

export type Position = (typeof POSITIONS)[number];

const POSITION_SET: ReadonlySet<string> = new Set(POSITIONS);

export function isPosition(value: string): value is Position {
  return POSITION_SET.has(value);
}

/** Player overall ratings must fall in this inclusive range (spec section 3). */
export const MIN_OVERALL = 40;
export const MAX_OVERALL = 99;
