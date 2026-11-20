/**
 * npm run data:validate
 * Checks data/players.seed.json, data/players.csv and data/clubs.json against the spec's data
 * rules. Exits with code 1 if there are errors.
 */
import { DATA_DIR, loadDataset, validateDataset } from '@draft-xi/server';

async function main(): Promise<number> {
  const dataset = await loadDataset();
  const result = validateDataset(dataset);

  console.log(`Data folder: ${DATA_DIR}`);
  console.log(`Source: ${dataset.source}\n`);
  console.log(`${'Club'.padEnd(28)} ${'Players'.padStart(7)} ${'GKs'.padStart(4)}`);
  for (const club of result.clubs) {
    console.log(
      `${club.name.padEnd(28)} ${String(club.players).padStart(7)} ${String(club.goalkeepers).padStart(4)}`,
    );
  }
  console.log(`${'Total'.padEnd(28)} ${String(result.totalPlayers).padStart(7)}\n`);

  for (const w of result.warnings) console.warn(`WARNING ${w.message}`);
  for (const e of result.errors) console.error(`ERROR   ${e.message}`);

  if (!result.ok) {
    console.error(`\nData validation failed: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
    return 1;
  }
  console.log(
    `Data OK: ${result.clubs.length} clubs, ${result.totalPlayers} players, ${result.warnings.length} warning(s).`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
