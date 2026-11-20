/**
 * One query API for both dialects.
 *
 * The SQLite and Postgres schemas are kept identical (same tables, columns and TypeScript types;
 * see test/schema-parity.test.ts), and Drizzle's select/insert/update/delete builders behave the
 * same on both. So application code is written once against the SQLite types, and on Postgres the
 * Postgres db and tables are supplied in their place.
 *
 * Rules for code using `Database`:
 * - Always `await` queries. Never call the SQLite-only `.get()`, `.all()` or `.run()`.
 * - Use `.returning()` to read back inserted or updated rows.
 * - Do not write raw dialect-specific SQL.
 * - Inside `transaction()`, only query through the `tx` argument (never `database.db`, which would
 *   wait for the transaction on a single-connection database) and await nothing but queries, so nothing else
 *   can interleave on the single SQLite connection.
 */
import { sql } from 'drizzle-orm';
import type { DbHandle, PgDb, SqliteDb } from './client';
import type * as sqliteSchema from './schema/sqlite';

export type AppDb = SqliteDb;
export type Tables = typeof sqliteSchema;

export interface Database {
  dialect: DbHandle['dialect'];
  db: AppDb;
  t: Tables;
  transaction<T>(fn: (tx: AppDb) => Promise<T>): Promise<T>;
  handle: DbHandle;
}

/** Serialises SQLite transactions, which share one connection. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createDatabase(handle: DbHandle): Database {
  if (handle.dialect === 'sqlite') {
    const db = handle.db;
    const mutex = new Mutex();
    return {
      dialect: 'sqlite',
      db,
      t: handle.schema,
      handle,
      transaction: (fn) =>
        mutex.run(async () => {
          db.run(sql`BEGIN IMMEDIATE`);
          try {
            const result = await fn(db);
            db.run(sql`COMMIT`);
            return result;
          } catch (err) {
            db.run(sql`ROLLBACK`);
            throw err;
          }
        }),
    };
  }

  const pgDb: PgDb = handle.db;
  return {
    dialect: 'postgres',
    db: pgDb as unknown as AppDb,
    t: handle.schema as unknown as Tables,
    handle,
    transaction: (fn) => pgDb.transaction((tx) => fn(tx as unknown as AppDb)),
  };
}

/** First row of a query result, or undefined. */
export function first<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}
