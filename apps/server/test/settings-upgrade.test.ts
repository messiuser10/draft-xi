/** The one-time retune of stored simulation parameters (realistic tuning, version 2). */
import { DEFAULT_SIM_PARAMS } from '@draft-xi/engine';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src';
import { createDatabase, type Database } from '../src/db/database';
import { ensureAppSettings, getSetting, upgradeSimulationTuning } from '../src/settings/app-settings';
import { DIALECTS } from './helpers/db';

/** What earlier versions stored: the old defaults, without the newer optional keys. */
const OLD = { baseGoals: 1.25, homeAdvantage: 1.1, sensitivity: 0.09, chaos: 0.5, outOfPositionPenalty: 8, reserveRating: 62, chemistry: true, injuries: false, points: { win: 3, draw: 1, loss: 0 } };

describe.each(DIALECTS)('simulation tuning upgrade on %s', (_name, open) => {
  let handle: DbHandle;
  let database: Database;
  beforeEach(async () => {
    handle = open();
    await handle.migrate();
    database = createDatabase(handle);
  });
  afterEach(async () => handle.close());

  const store = (value: unknown) => database.db.insert(database.t.appSettings).values({ key: 'simulation.parameters', value });

  it('moves values still at the old defaults to the new ones, once', async () => {
    await store(OLD);
    await ensureAppSettings(database);
    expect(await getSetting(database, 'simulation.parameters')).toMatchObject({
      baseGoals: DEFAULT_SIM_PARAMS.baseGoals,
      homeAdvantage: DEFAULT_SIM_PARAMS.homeAdvantage,
      sensitivity: DEFAULT_SIM_PARAMS.sensitivity,
      chaos: 0.5,
    });
    // An admin who later picks the old value on purpose keeps it.
    await database.db.update(database.t.appSettings).set({ value: OLD }).where(eq(database.t.appSettings.key, 'simulation.parameters'));
    expect(await upgradeSimulationTuning(database)).toBe(false);
    expect((await getSetting(database, 'simulation.parameters')).sensitivity).toBe(0.09);
  });

  it('keeps values an admin changed and old AI tweaks only move off their old defaults', async () => {
    await store({ ...OLD, sensitivity: 0.1, homeAdvantage: 1.2, aiSpread: 0.4, aiCatchUp: 0.5 });
    expect(await upgradeSimulationTuning(database)).toBe(true);
    expect(await getSetting(database, 'simulation.parameters')).toMatchObject({ sensitivity: 0.1, homeAdvantage: 1.2, baseGoals: DEFAULT_SIM_PARAMS.baseGoals, aiSpread: 1, aiCatchUp: 0.5 });
  });

  it('does nothing to a fresh database beyond recording the version', async () => {
    await ensureAppSettings(database);
    expect(await getSetting(database, 'simulation.parameters')).toMatchObject({ baseGoals: DEFAULT_SIM_PARAMS.baseGoals, sensitivity: DEFAULT_SIM_PARAMS.sensitivity });
    expect(await upgradeSimulationTuning(database)).toBe(false);
  });
});
