import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig } from '../../src/config';
import type { DbHandle } from '../../src/db/client';
import { createDatabase, type Database } from '../../src/db/database';
import { loadDataset } from '../../src/data/dataset';
import { seedDatabase } from '../../src/data/seed';
import { type BuiltServer, buildServer } from '../../src/http/app';
import { ensureAppSettings } from '../../src/settings/app-settings';

export interface TestServer extends BuiltServer {
  handle: DbHandle;
  database: Database;
}

/** A migrated, seeded server on the given database. Start countdown is 50 ms. */
export async function startTestServer(open: () => DbHandle, env: Record<string, string> = {}): Promise<TestServer> {
  const handle = open();
  await handle.migrate();
  await seedDatabase(handle, await loadDataset());
  const database = createDatabase(handle);
  await ensureAppSettings(database);
  const config = loadConfig({ NODE_ENV: 'test', START_COUNTDOWN_SECONDS: '0.05', ADMIN_USERNAME: 'boss', ...env });
  const server = await buildServer({ config, database, bcryptCost: 4, authRateLimit: 1000 });
  return {
    ...server,
    handle,
    database,
    close: async () => {
      await server.close();
      await handle.close();
    },
  };
}

/** A cookie-carrying HTTP client over app.inject. */
export class Client {
  cookie = '';
  constructor(private readonly app: FastifyInstance) {}

  async req<T = Record<string, unknown>>(method: InjectOptions['method'], url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      ...(body === undefined ? {} : { payload: body as InjectOptions['payload'] }),
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const setCookie = res.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) this.cookie = first.split(';')[0] ?? '';
    return { status: res.statusCode, body: res.json<T>() };
  }

  get = <T = Record<string, unknown>>(url: string) => this.req<T>('GET', url);
  post = <T = Record<string, unknown>>(url: string, body: unknown = {}) => this.req<T>('POST', url, body);
  patch = <T = Record<string, unknown>>(url: string, body: unknown = {}) => this.req<T>('PATCH', url, body);
  del = <T = Record<string, unknown>>(url: string) => this.req<T>('DELETE', url);
}

let counter = 0;

export async function registeredClient(app: FastifyInstance, username?: string): Promise<Client> {
  const c = new Client(app);
  const name = username ?? `user${++counter}_${Math.floor(Math.random() * 1e6)}`;
  const res = await c.post('/api/auth/register', { username: name, password: 'correct horse' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return c;
}

export async function guestClient(app: FastifyInstance, displayName = 'Guesty'): Promise<Client> {
  const c = new Client(app);
  await c.post('/api/auth/guest', { displayName });
  return c;
}

export const team = (teamName: string, formation: string | null = '4-3-3') => ({
  teamName,
  color: '#22C55E',
  monogram: teamName.slice(0, 2).toUpperCase(),
  formation,
});

export const waitFor = async (check: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
