import { PGlite } from '@electric-sql/pglite';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type DbHandle, MIGRATIONS_DIR, openDatabase, pgSchema, type PostgresHandle } from '../../src';

export function openSqliteMemory(): DbHandle {
  return openDatabase(':memory:');
}

/** In-process Postgres (WASM), so the Postgres schema and migrations are tested for real. */
export function openPglite(): PostgresHandle {
  const client = new PGlite();
  const db = drizzle(client, { schema: pgSchema });
  return {
    dialect: 'postgres',
    db,
    schema: pgSchema,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR.postgres }),
    close: () => client.close(),
  };
}

export const DIALECTS: [string, () => DbHandle][] = [
  ['sqlite', openSqliteMemory],
  ['postgres', openPglite],
];

/** Runs raw SQL on either dialect. Errors surface as promise rejections. */
export async function exec(handle: DbHandle, query: SQL): Promise<void> {
  if (handle.dialect === 'sqlite') handle.db.run(query);
  else await handle.db.execute(query);
}

export async function rows<T>(handle: DbHandle, query: SQL): Promise<T[]> {
  if (handle.dialect === 'sqlite') return handle.db.all<T>(query);
  // node-postgres and PGlite both return `{ rows }`; the shared PgDatabase type can't express it.
  const result: unknown = await handle.db.execute(query);
  return (result as { rows: T[] }).rows;
}

export async function selectClubs(handle: DbHandle) {
  return handle.dialect === 'sqlite'
    ? handle.db.select().from(handle.schema.clubs).all()
    : handle.db.select().from(handle.schema.clubs);
}

export async function selectPlayers(handle: DbHandle) {
  return handle.dialect === 'sqlite'
    ? handle.db.select().from(handle.schema.players).all()
    : handle.db.select().from(handle.schema.players);
}
