/**
 * Site-wide settings in the app_settings table (key -> JSON). Every key has a code default and a
 * zod schema; a missing or invalid row falls back to the default. The admin panel (M6) edits them.
 */
import {
  DEFAULT_SIM_PARAMS,
  DEFAULT_SLOT_COMPATIBILITY,
  FORMATION_IDS,
  POSITIONS,
  SLOT_TYPES,
  TIEBREAK_KEYS,
} from '@draft-xi/engine';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_GAME_SETTINGS, formationIdSchema, gameSettingsSchema, HARD_MAX_HUMANS } from '../contracts';
import type { Database } from '../db/database';

/** Starter list; admins can edit it. Matched against whole words (see profanity.ts). */
export const DEFAULT_PROFANITY = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'bastard',
  'dick',
  'cock',
  'pussy',
  'wank',
  'twat',
  'slut',
  'whore',
  'fag',
  'nigg',
  'retard',
  'nazi',
];

const SETTINGS = {
  'league.name': { schema: z.string().min(1).max(40), default: 'Draft XI League' },
  /** Admin-configurable cap on humans per game (hard cap 20). */
  'game.maxHumansLimit': { schema: z.number().int().min(1).max(HARD_MAX_HUMANS), default: 8 },
  'game.defaults': { schema: gameSettingsSchema, default: DEFAULT_GAME_SETTINGS },
  'draft.timerRange': {
    schema: z.object({ min: z.number().int().min(5), max: z.number().int().max(600) }),
    default: { min: 15, max: 180 },
  },
  'formations.enabled': { schema: z.array(formationIdSchema).min(1), default: [...FORMATION_IDS] },
  'positions.compatibility': {
    schema: z.record(z.enum(SLOT_TYPES), z.array(z.enum(POSITIONS)).min(1)),
    default: DEFAULT_SLOT_COMPATIBILITY,
  },
  'simulation.parameters': {
    schema: z.object({
      baseGoals: z.number().positive(),
      homeAdvantage: z.number().positive(),
      sensitivity: z.number().min(0),
      chaos: z.number().min(0).max(1),
      outOfPositionPenalty: z.number().min(0),
      reserveRating: z.number().int().min(40).max(99),
      chemistry: z.boolean(),
      injuries: z.boolean(),
      points: z.object({ win: z.number(), draw: z.number(), loss: z.number() }),
      // Optional so settings saved before tiebreakers existed stay valid.
      tiebreakers: z.array(z.enum(TIEBREAK_KEYS)).max(TIEBREAK_KEYS.length).optional(),
      // Optional: settings saved before it existed use the engine default.
      aiSpread: z.number().min(0).max(1).optional(),
      aiCatchUp: z.number().min(0).max(1).optional(),
      form: z.number().min(0).max(6).optional(),
      streaks: z.number().min(0).max(6).optional(),
      sharedGoals: z.number().min(0).max(1).optional(),
    }),
    default: DEFAULT_SIM_PARAMS,
  },
  /** Start the season automatically 10 seconds after the draft ends. */
  'season.autoStart': { schema: z.boolean(), default: false },
  'registrations.open': { schema: z.boolean(), default: true },
  'lobbies.publicEnabled': { schema: z.boolean(), default: true },
  'profanity.words': { schema: z.array(z.string().min(2)), default: DEFAULT_PROFANITY },
  /** How the AI clubs are chosen at the start of a game. */
  'ai.selection': {
    schema: z.object({ method: z.enum(['strength', 'manual', 'random']), manualClubIds: z.array(z.number().int().positive()) }),
    default: { method: 'strength' as 'strength' | 'manual' | 'random', manualClubIds: [] as number[] },
  },
  /** Final table colour bands; positions are inclusive. */
  'table.bands': {
    schema: z.object({
      enabled: z.boolean(),
      bands: z
        .array(
          z.object({
            label: z.string().min(1).max(30),
            from: z.number().int().min(1).max(20),
            to: z.number().int().min(1).max(20),
            color: z.enum(['gold', 'green', 'blue', 'red', 'purple']),
          }),
        )
        .max(8),
    }),
    default: {
      enabled: true,
      bands: [
        { label: 'Champion', from: 1, to: 1, color: 'gold' as const },
        { label: 'Top four', from: 2, to: 4, color: 'green' as const },
        { label: 'Next tier', from: 5, to: 6, color: 'blue' as const },
        { label: 'Bottom three', from: 18, to: 20, color: 'red' as const },
      ],
    },
  },
  /** While enabled, only admins can create games and a banner explains why. */
  'site.maintenance': {
    schema: z.object({ enabled: z.boolean(), message: z.string().max(300) }),
    default: { enabled: false, message: 'Scheduled maintenance: new games are paused for a few minutes.' },
  },
  // Empty string means no banner (JSON null would become SQL NULL on Postgres).
  'site.banner': { schema: z.string().max(300), default: '' },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return structuredClone(SETTINGS[key].default) as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(database: Database, key: K): Promise<SettingValue<K>> {
  const { db, t } = database;
  const [row] = await db.select().from(t.appSettings).where(eq(t.appSettings.key, key)).limit(1);
  if (!row) return settingDefault(key);
  const parsed = SETTINGS[key].schema.safeParse(row.value);
  return parsed.success ? (parsed.data as SettingValue<K>) : settingDefault(key);
}

export async function setSetting<K extends SettingKey>(
  database: Database,
  key: K,
  value: SettingValue<K>,
): Promise<void> {
  const parsed = SETTINGS[key].schema.parse(value);
  const { db, t } = database;
  await db
    .insert(t.appSettings)
    .values({ key, value: parsed })
    .onConflictDoUpdate({ target: t.appSettings.key, set: { value: parsed } });
}

/** Writes the default for every key that has no row yet, so admins can see and edit them. */
export async function ensureAppSettings(database: Database): Promise<number> {
  const { db, t } = database;
  const existing = new Set((await db.select({ key: t.appSettings.key }).from(t.appSettings)).map((r) => r.key));
  const missing = SETTING_KEYS.filter((k) => !existing.has(k));
  if (missing.length > 0) {
    await db
      .insert(t.appSettings)
      .values(missing.map((key) => ({ key, value: settingDefault(key) })))
      .onConflictDoNothing();
  }
  await upgradeSimulationTuning(database);
  return missing.length;
}

/** Bump when a retune should replace stored values that still equal earlier defaults. */
export const SIM_TUNING_VERSION = 3;
const SIM_TUNING_KEY = 'simulation.tuningVersion';
/** Every earlier default of each tuned key -> the current default. */
const SIM_RETUNE: Record<string, [earlier: number[], next: number]> = {
  baseGoals: [[1.25], DEFAULT_SIM_PARAMS.baseGoals],
  homeAdvantage: [[1.1], DEFAULT_SIM_PARAMS.homeAdvantage],
  sensitivity: [[0.09, 0.07], DEFAULT_SIM_PARAMS.sensitivity],
  aiSpread: [[0.4, 1], DEFAULT_SIM_PARAMS.aiSpread],
  aiCatchUp: [[0.8], DEFAULT_SIM_PARAMS.aiCatchUp],
  form: [[2], DEFAULT_SIM_PARAMS.form],
  streaks: [[1.5], DEFAULT_SIM_PARAMS.streaks],
};

/**
 * One-time upgrade of the stored simulation parameters: values still at the old defaults move to
 * the new ones; anything an admin changed is kept. Runs once per tuning version.
 */
export async function upgradeSimulationTuning(database: Database): Promise<boolean> {
  const { db, t } = database;
  const [version] = await db.select().from(t.appSettings).where(eq(t.appSettings.key, SIM_TUNING_KEY)).limit(1);
  if (typeof version?.value === 'number' && version.value >= SIM_TUNING_VERSION) return false;
  const stored = await getSetting(database, 'simulation.parameters');
  const next: Record<string, unknown> = { ...stored };
  let changed = false;
  for (const [key, [earlier, value]] of Object.entries(SIM_RETUNE)) {
    if (typeof next[key] === 'number' && earlier.includes(next[key]) && next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  if (changed) await setSetting(database, 'simulation.parameters', next as SettingValue<'simulation.parameters'>);
  await db
    .insert(t.appSettings)
    .values({ key: SIM_TUNING_KEY, value: SIM_TUNING_VERSION })
    .onConflictDoUpdate({ target: t.appSettings.key, set: { value: SIM_TUNING_VERSION } });
  return changed;
}
