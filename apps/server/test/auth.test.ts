import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { containsProfanity } from '../src/settings/profanity';
import { DIALECTS } from './helpers/db';
import { Client, guestClient, registeredClient, startTestServer, type TestServer } from './helpers/server';

describe.each(DIALECTS)('auth on %s', (_name, open) => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer(open);
  });
  afterAll(async () => server.close());

  it('registers, reads /me from the cookie, logs out and back in', async () => {
    const c = new Client(server.app);
    const reg = await c.post<{ user: { username: string; role: string } }>('/api/auth/register', {
      username: 'Alice_1',
      password: 'correct horse',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ username: 'alice_1', role: 'user' });
    expect(c.cookie).toMatch(/^dxl_session=/);

    expect((await c.get<{ user: { username: string } }>('/api/auth/me')).body.user.username).toBe('alice_1');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.user).toBeNull();

    const bad = await c.post('/api/auth/login', { username: 'alice_1', password: 'wrong password' });
    expect(bad.status).toBe(401);
    const good = await c.post('/api/auth/login', { username: 'ALICE_1', password: 'correct horse' });
    expect(good.status).toBe(200);
  });

  it('stores only a hash of the session token', async () => {
    const c = await registeredClient(server.app);
    const token = c.cookie.split('=')[1] ?? '';
    const rows = await server.database.db.select().from(server.database.t.sessions);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === token)).toBe(false);
  });

  it('rejects duplicate usernames case-insensitively and invalid input', async () => {
    await registeredClient(server.app, 'dupe');
    const c = new Client(server.app);
    expect((await c.post('/api/auth/register', { username: 'DUPE', password: 'correct horse' })).status).toBe(409);
    const invalid = await c.post<{ error: { code: string } }>('/api/auth/register', { username: 'a', password: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('invalid_input');
  });

  it('makes ADMIN_USERNAME an admin, who can promote others; normal users are refused', async () => {
    const admin = await registeredClient(server.app, 'boss');
    expect((await admin.get<{ user: { role: string } }>('/api/auth/me')).body.user.role).toBe('admin');

    const normal = await registeredClient(server.app, 'normie');
    const me = await normal.get<{ user: { id: number } }>('/api/auth/me');
    expect((await normal.get('/api/admin/users')).status).toBe(403);
    expect((await normal.patch(`/api/admin/users/${me.body.user.id}/role`, { role: 'admin' })).status).toBe(403);
    expect((await new Client(server.app).get('/api/admin/users')).status).toBe(401);

    const promoted = await admin.patch<{ user: { role: string } }>(`/api/admin/users/${me.body.user.id}/role`, { role: 'admin' });
    expect(promoted.body.user.role).toBe('admin');
    expect((await normal.get('/api/admin/users')).status).toBe(200);

    const adminMe = await admin.get<{ user: { id: number } }>('/api/auth/me');
    expect((await admin.patch(`/api/admin/users/${adminMe.body.user.id}/role`, { role: 'user' })).status).toBe(400);
  });

  it('creates guest sessions with only a display name', async () => {
    const g = await guestClient(server.app, 'Sunday Striker');
    const me = await g.get<{ user: { isGuest: boolean; username: null; displayName: string } }>('/api/auth/me');
    expect(me.body.user).toMatchObject({ isGuest: true, username: null, displayName: 'Sunday Striker' });
  });
});

describe('profanity filter', () => {
  const words = ['fuck', 'shit', 'cunt'];
  it('blocks listed words, look-alikes and spaced spellings', () => {
    expect(containsProfanity('Fuck FC', words)).toBe(true);
    expect(containsProfanity('Sh1t Town', words)).toBe(true);
    expect(containsProfanity('f u c k', words)).toBe(true);
  });
  it('allows innocent names that contain a listed word inside another', () => {
    expect(containsProfanity('Scunthorpe United', words)).toBe(false);
    expect(containsProfanity('Arsenal Legends', words)).toBe(false);
  });
});
