/** Server entry: migrate, seed an empty database from data/, then listen. */
import path from 'node:path';
import { count } from 'drizzle-orm';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { createDatabase } from './db/database';
import { loadDataset } from './data/dataset';
import { seedDatabase } from './data/seed';
import { buildServer } from './http/app';
import { REPO_ROOT } from './paths';
import { ensureAppSettings } from './settings/app-settings';

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = openDatabase(config.DATABASE_URL);
  await handle.migrate();
  const database = createDatabase(handle);

  const [clubs] = await database.db.select({ n: count() }).from(database.t.clubs);
  if ((clubs?.n ?? 0) === 0) {
    const report = await seedDatabase(handle, await loadDataset());
    console.log(`Seeded ${report.clubs.inserted} clubs and ${report.players.inserted} players from data/`);
  }
  await ensureAppSettings(database);

  const webDist = config.WEB_DIST ?? (config.NODE_ENV === 'production' ? path.join(REPO_ROOT, 'apps/web/dist') : undefined);
  const server = await buildServer({
    config: { ...config, ...(webDist ? { WEB_DIST: webDist } : {}) },
    database,
    logger: config.NODE_ENV !== 'test',
  });
  await server.ctx.games.resetConnections();
  await server.ctx.auth.deleteExpiredSessions();
  const restored = await server.ctx.draft.restore();
  if (restored > 0) server.app.log.info(`Restored pick timers for ${restored} draft(s)`);
  const windows = await server.ctx.rounds.restore();
  if (windows > 0) server.app.log.info(`Restored timers for ${windows} transfer window(s)`);
  await server.app.listen({ host: config.HOST, port: config.PORT });

  const shutdown = (signal: string) => {
    server.app.log.info(`${signal}: shutting down`);
    void server
      .close()
      .then(() => handle.close())
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
