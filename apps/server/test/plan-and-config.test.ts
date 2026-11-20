import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseDatabaseUrl, planChanges, REPO_ROOT } from '../src';

describe('planChanges', () => {
  type Row = { key: string; a: number; tags: string[] };
  const keyOf = (r: Row) => r.key;
  const fields = ['a', 'tags'] as const;

  it('inserts new rows, updates only changed fields, and counts unchanged rows', () => {
    const existing = [
      { id: 1, key: 'x', a: 1, tags: ['p'] },
      { id: 2, key: 'y', a: 2, tags: ['q'] },
      { id: 3, key: 'z', a: 3, tags: [] },
    ];
    const incoming: Row[] = [
      { key: 'x', a: 1, tags: ['p'] }, // unchanged
      { key: 'y', a: 2, tags: ['q', 'r'] }, // array changed
      { key: 'w', a: 9, tags: [] }, // new
    ];
    const plan = planChanges(existing, incoming, keyOf, fields);
    expect(plan.toInsert).toEqual([{ key: 'w', a: 9, tags: [] }]);
    expect(plan.toUpdate).toEqual([{ id: 2, key: 'y', values: { tags: ['q', 'r'] } }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.notInIncoming).toEqual(['z']);
  });
});

describe('parseDatabaseUrl', () => {
  it('selects Postgres for postgres:// and postgresql:// URLs', () => {
    expect(parseDatabaseUrl('postgres://u:p@localhost:5432/draft')).toEqual({
      dialect: 'postgres',
      connectionString: 'postgres://u:p@localhost:5432/draft',
    });
    expect(parseDatabaseUrl('postgresql://localhost/draft').dialect).toBe('postgres');
  });

  it('treats everything else as a SQLite file resolved from the repo root', () => {
    expect(parseDatabaseUrl('file:var/draft-xi.db')).toEqual({
      dialect: 'sqlite',
      filename: path.join(REPO_ROOT, 'var/draft-xi.db'),
    });
    expect(parseDatabaseUrl('./var/x.db')).toEqual({
      dialect: 'sqlite',
      filename: path.join(REPO_ROOT, 'var/x.db'),
    });
    expect(parseDatabaseUrl('/tmp/abs.db')).toEqual({ dialect: 'sqlite', filename: '/tmp/abs.db' });
    expect(parseDatabaseUrl('file:///tmp/abs.db')).toEqual({ dialect: 'sqlite', filename: '/tmp/abs.db' });
    expect(parseDatabaseUrl(':memory:')).toEqual({ dialect: 'sqlite', filename: ':memory:' });
  });

  it('rejects an empty value', () => {
    expect(() => parseDatabaseUrl('file:')).toThrow(/empty/);
  });
});

describe('loadConfig', () => {
  it('fills in defaults', () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: 'file:var/draft-xi.db',
      HOST: '127.0.0.1',
      PORT: 3000,
      START_COUNTDOWN_SECONDS: 5,
      BOT_PICK_DELAY_MS: 1500,
      DISCONNECT_GRACE_SECONDS: 60,
      COOKIE_SECURE: false,
    });
  });

  it('turns on secure cookies in production unless told otherwise', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('lowercases ADMIN_USERNAME and rejects bad values', () => {
    expect(loadConfig({ ADMIN_USERNAME: ' Boss ' }).ADMIN_USERNAME).toBe('boss');
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid environment/);
  });

  it('uses DATABASE_URL when set', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://h/db' }).DATABASE_URL).toBe('postgres://h/db');
  });
});
