/**
 * npm run db:migrate
 * Applies pending migrations to the database from DATABASE_URL.
 */
import { loadConfig, openDatabase } from '@draft-xi/server';

async function main(): Promise<void> {
  const handle = openDatabase(loadConfig().DATABASE_URL);
  try {
    await handle.migrate();
    console.log(`Migrations applied (${handle.dialect}).`);
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
