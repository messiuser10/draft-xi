/**
 * npm run seed
 * Applies migrations, validates the files in data/, then loads clubs and players into the
 * database from DATABASE_URL. Safe to run repeatedly.
 */
import {
  type DbHandle,
  loadConfig,
  loadDataset,
  openDatabase,
  parseDatabaseUrl,
  type SeedCounts,
  seedDatabase,
  SeedValidationError,
  validateDataset,
} from '@draft-xi/server';

function describeTarget(url: string): string {
  const target = parseDatabaseUrl(url);
  return target.dialect === 'sqlite' ? `SQLite ${target.filename}` : 'Postgres (DATABASE_URL)';
}

function line(label: string, c: SeedCounts): string {
  return `${label.padEnd(8)} ${c.inserted} inserted, ${c.updated} updated, ${c.unchanged} unchanged`;
}

async function main(): Promise<number> {
  const { DATABASE_URL } = loadConfig();
  const dataset = await loadDataset();

  const validation = validateDataset(dataset);
  for (const w of validation.warnings) console.warn(`WARNING ${w.message}`);
  if (!validation.ok) {
    for (const e of validation.errors) console.error(`ERROR   ${e.message}`);
    console.error('\nSeed aborted: fix the data errors above (run `npm run data:validate`).');
    return 1;
  }

  let handle: DbHandle | undefined;
  try {
    handle = openDatabase(DATABASE_URL);
    console.log(`Database: ${describeTarget(DATABASE_URL)}`);
    await handle.migrate();
    const report = await seedDatabase(handle, dataset);
    console.log(line('Clubs', report.clubs));
    console.log(line('Players', report.players));
    for (const [label, c] of [
      ['clubs', report.clubs],
      ['players', report.players],
    ] as const) {
      if (c.notInFile.length > 0) {
        console.warn(
          `NOTE    ${c.notInFile.length} ${label} in the database are not in the seed files (left untouched):` +
            c.notInFile.map((k) => `\n    ${k}`).join(''),
        );
      }
    }
    console.log('Seed complete.');
    return 0;
  } catch (err) {
    if (err instanceof SeedValidationError) console.error(err.message);
    else throw err;
    return 1;
  } finally {
    await handle?.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
