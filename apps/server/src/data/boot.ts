/**
 * On server start: seed an empty database, and re-seed when the files in data/ have changed since
 * the last boot (tracked by a hash in app_settings). Admin edits survive restarts and are only
 * overwritten when new data files are deployed.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbHandle } from '../db/client';
import type { Database } from '../db/database';
import type { Dataset } from './dataset';
import { type SeedReport, seedDatabase } from './seed';

export const DATA_VERSION_KEY = 'dataVersion';

export function datasetHash(dataset: Dataset): string {
  return createHash('sha256').update(JSON.stringify({ clubs: dataset.clubs, players: dataset.players })).digest('hex');
}

/** Returns the seed report when it seeded, or null when the database already has this data. */
export async function seedOnBoot(handle: DbHandle, database: Database, dataset: Dataset): Promise<SeedReport | null> {
  const { db, t } = database;
  const hash = datasetHash(dataset);
  const [row] = await db.select().from(t.appSettings).where(eq(t.appSettings.key, DATA_VERSION_KEY)).limit(1);
  if (row?.value === hash) return null;
  const report = await seedDatabase(handle, dataset);
  await db
    .insert(t.appSettings)
    .values({ key: DATA_VERSION_KEY, value: hash })
    .onConflictDoUpdate({ target: t.appSettings.key, set: { value: hash } });
  return report;
}
