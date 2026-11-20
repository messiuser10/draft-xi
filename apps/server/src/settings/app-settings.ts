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
    }),
    default: DEFAULT_SIM_PARAMS,
  },
  /** Start the season automatically 10 seconds after the draft ends. */
  'season.autoStart': { schema: z.boolean(), default: false },
  'registrations.open': { schema: z.boolean(), default: true },
  'lobbies.publicEnabled': { schema: z.boolean(), default: true },
  'profanity.words': { schema: z.array(z.string().min(2)), default: DEFAULT_PROFANITY },
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
  return missing.length;
}
