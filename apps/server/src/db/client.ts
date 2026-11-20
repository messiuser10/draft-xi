import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { loadConfig } from '../config';
import { MIGRATIONS_DIR, REPO_ROOT } from '../paths';
import * as pgSchema from './schema/pg';
import * as sqliteSchema from './schema/sqlite';

export type SqliteSchema = typeof sqliteSchema;
export type PgSchema = typeof pgSchema;
export type SqliteDb = BetterSQLite3Database<SqliteSchema>;
/** Any Postgres driver (node-postgres in production, PGlite in tests). */
export type PgDb = PgDatabase<PgQueryResultHKT, PgSchema>;

interface HandleBase {
  /** Applies any pending migrations. Safe to call repeatedly. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface SqliteHandle extends HandleBase {
  dialect: 'sqlite';
  db: SqliteDb;
  schema: SqliteSchema;
}

export interface PostgresHandle extends HandleBase {
  dialect: 'postgres';
  db: PgDb;
  schema: PgSchema;
}

export type DbHandle = SqliteHandle | PostgresHandle;

export type DatabaseTarget =
  | { dialect: 'postgres'; connectionString: string }
  | { dialect: 'sqlite'; filename: string };

/**
 * `postgres://` and `postgresql://` URLs select Postgres. Anything else is a SQLite file
 * path (optionally prefixed with `file:`), resolved from the repo root, or `:memory:`.
 */
export function parseDatabaseUrl(url: string): DatabaseTarget {
  const trimmed = url.trim();
  if (/^postgres(ql)?:\/\//i.test(trimmed)) {
    return { dialect: 'postgres', connectionString: trimmed };
  }
  let filename = trimmed;
  if (filename.startsWith('file://')) filename = fileURLToPath(filename);
  else if (filename.startsWith('file:')) filename = filename.slice('file:'.length);
  if (filename === '') throw new Error('DATABASE_URL is empty');
  if (filename === ':memory:') return { dialect: 'sqlite', filename };
  return { dialect: 'sqlite', filename: path.resolve(REPO_ROOT, filename) };
}

export function createSqliteHandle(client: Database.Database): SqliteHandle {
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  const db = drizzleSqlite(client, { schema: sqliteSchema });
  return {
    dialect: 'sqlite',
    db,
    schema: sqliteSchema,
    migrate: () => {
      migrateSqlite(db, { migrationsFolder: MIGRATIONS_DIR.sqlite });
      return Promise.resolve();
    },
    close: () => {
      client.close();
      return Promise.resolve();
    },
  };
}

export function openDatabase(url: string = loadConfig().DATABASE_URL): DbHandle {
  const target = parseDatabaseUrl(url);

  if (target.dialect === 'postgres') {
    const pool = new pg.Pool({ connectionString: target.connectionString });
    const db = drizzleNodePg(pool, { schema: pgSchema });
    return {
      dialect: 'postgres',
      db,
      schema: pgSchema,
      migrate: () => migrateNodePg(db, { migrationsFolder: MIGRATIONS_DIR.postgres }),
      close: () => pool.end(),
    };
  }

  if (target.filename !== ':memory:') {
    mkdirSync(path.dirname(target.filename), { recursive: true });
  }
  const client = new Database(target.filename);
  if (target.filename !== ':memory:') {
    client.pragma('journal_mode = WAL');
    client.pragma('synchronous = NORMAL');
  }
  return createSqliteHandle(client);
}
