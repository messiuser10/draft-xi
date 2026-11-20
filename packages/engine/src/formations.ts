import type { SlotType } from './slots';

/**
 * A formation slot. Pitch coordinates are percentages from the team's own point of view:
 * x runs from the left touchline (0) to the right (100), y from the team's own goal line (0)
 * to the opponent's (100).
 */
export interface FormationSlot {
  key: string;
  type: SlotType;
  x: number;
  y: number;
}

export const FORMATION_IDS = [
  '4-3-3',
  '4-4-2',
  '4-2-3-1',
  '4-1-4-1',
  '4-3-2-1',
  '4-4-1-1',
  '3-5-2',
  '3-4-3',
  '5-3-2',
  '5-4-1',
] as const;
export type FormationId = (typeof FORMATION_IDS)[number];

export interface Formation {
  id: FormationId;
  slots: readonly FormationSlot[];
}

const s = (key: string, type: SlotType, x: number, y: number): FormationSlot => ({ key, type, x, y });

const GK = s('GK', 'GK', 50, 6);
const BACK_FOUR = [s('RB', 'RB', 86, 26), s('RCB', 'CB', 62, 19), s('LCB', 'CB', 38, 19), s('LB', 'LB', 14, 26)];
const BACK_THREE = [s('RCB', 'CB', 72, 20), s('CB', 'CB', 50, 18), s('LCB', 'CB', 28, 20)];
const BACK_FIVE = [
  s('RWB', 'RWB', 90, 36),
  s('RCB', 'CB', 70, 20),
  s('CB', 'CB', 50, 18),
  s('LCB', 'CB', 30, 20),
  s('LWB', 'LWB', 10, 36),
];
const TWO_STRIKERS = [s('RST', 'ST', 60, 86), s('LST', 'ST', 40, 86)];
const LONE_STRIKER = s('ST', 'ST', 50, 88);
const FLAT_FOUR_MID = [s('RM', 'RM', 86, 55), s('RCM', 'CM', 61, 50), s('LCM', 'CM', 39, 50), s('LM', 'LM', 14, 55)];

const DEFINITIONS: Record<FormationId, FormationSlot[]> = {
  '4-3-3': [
    GK,
    ...BACK_FOUR,
    s('RCM', 'CM', 68, 49),
    s('CM', 'CM', 50, 45),
    s('LCM', 'CM', 32, 49),
    s('RW', 'RW', 82, 78),
    LONE_STRIKER,
    s('LW', 'LW', 18, 78),
  ],
  '4-4-2': [GK, ...BACK_FOUR, ...FLAT_FOUR_MID, ...TWO_STRIKERS],
  '4-2-3-1': [
    GK,
    ...BACK_FOUR,
    s('RDM', 'CDM', 61, 40),
    s('LDM', 'CDM', 39, 40),
    s('RM', 'RM', 82, 64),
    s('CAM', 'CAM', 50, 66),
    s('LM', 'LM', 18, 64),
    LONE_STRIKER,
  ],
  '4-1-4-1': [
    GK,
    ...BACK_FOUR,
    s('CDM', 'CDM', 50, 38),
    s('RM', 'RM', 86, 60),
    s('RCM', 'CM', 62, 56),
    s('LCM', 'CM', 38, 56),
    s('LM', 'LM', 14, 60),
    LONE_STRIKER,
  ],
  '4-3-2-1': [
    GK,
    ...BACK_FOUR,
    s('RCM', 'CM', 68, 47),
    s('CM', 'CM', 50, 44),
    s('LCM', 'CM', 32, 47),
    s('RCAM', 'CAM', 62, 70),
    s('LCAM', 'CAM', 38, 70),
    LONE_STRIKER,
  ],
  '4-4-1-1': [GK, ...BACK_FOUR, ...FLAT_FOUR_MID, s('CAM', 'CAM', 50, 72), LONE_STRIKER],
  '3-5-2': [
    GK,
    ...BACK_THREE,
    s('RWB', 'RWB', 88, 50),
    s('RCM', 'CM', 65, 50),
    s('CDM', 'CDM', 50, 42),
    s('LCM', 'CM', 35, 50),
    s('LWB', 'LWB', 12, 50),
    ...TWO_STRIKERS,
  ],
  '3-4-3': [
    GK,
    ...BACK_THREE,
    s('RM', 'RM', 86, 52),
    s('RCM', 'CM', 61, 48),
    s('LCM', 'CM', 39, 48),
    s('LM', 'LM', 14, 52),
    s('RW', 'RW', 78, 80),
    LONE_STRIKER,
    s('LW', 'LW', 22, 80),
  ],
  '5-3-2': [
    GK,
    ...BACK_FIVE,
    s('RCM', 'CM', 66, 52),
    s('CM', 'CM', 50, 48),
    s('LCM', 'CM', 34, 52),
    ...TWO_STRIKERS,
  ],
  '5-4-1': [
    GK,
    ...BACK_FIVE,
    s('RM', 'RM', 84, 60),
    s('RCM', 'CM', 61, 52),
    s('LCM', 'CM', 39, 52),
    s('LM', 'LM', 16, 60),
    LONE_STRIKER,
  ],
};

export const FORMATIONS: Readonly<Record<FormationId, Formation>> = Object.fromEntries(
  FORMATION_IDS.map((id) => [id, { id, slots: DEFINITIONS[id] }]),
) as unknown as Record<FormationId, Formation>;

export function isFormationId(value: string): value is FormationId {
  return (FORMATION_IDS as readonly string[]).includes(value);
}

export function getFormation(id: FormationId): Formation {
  return FORMATIONS[id];
}
