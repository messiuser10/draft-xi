import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** apps/server/src -> repo root. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Owner-supplied seed data: players.csv, players.seed.json, clubs.json. */
export const DATA_DIR = path.join(REPO_ROOT, 'data');

export const MIGRATIONS_DIR = {
  sqlite: fileURLToPath(new URL('../drizzle/sqlite', import.meta.url)),
  postgres: fileURLToPath(new URL('../drizzle/pg', import.meta.url)),
} as const;
