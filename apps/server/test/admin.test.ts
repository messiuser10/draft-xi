import type {
  AdminClubView,
  AdminGameView,
  AdminOverview,
  AdminPlayerView,
  AdminSettingView,
  AdminUserView,
  AuditEntryView,
  ClubRankingView,
  GameSnapshot,
  ImportPreview,
  LabResultView,
} from '@draft-xi/server/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIALECTS } from './helpers/db';
import { type Client, guestClient, registeredClient, startTestServer, team, type TestServer, waitFor } from './helpers/server';

/** Every admin endpoint, with a body that would pass validation. */
const ENDPOINTS: [method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown][] = [
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/players'],
  ['POST', '/api/admin/players', { clubId: 1, fullName: 'Nobody', primaryPosition: 'ST', overall: 60, nationality: 'Nowhere' }],
  ['PATCH', '/api/admin/players/1', { overall: 99 }],
  ['DELETE', '/api/admin/players/1'],
  ['POST', '/api/admin/players/bulk', { ids: [1], patch: { isActive: false } }],
  ['GET', '/api/admin/players/export?format=csv'],
  ['POST', '/api/admin/players/import/preview', { format: 'csv', content: 'club,name\n' }],
  ['POST', '/api/admin/players/import/apply', { format: 'csv', content: 'club,name\n' }],
  ['GET', '/api/admin/players/duplicates'],
  ['GET', '/api/admin/clubs'],
  ['POST', '/api/admin/clubs', { name: 'X', shortName: 'XX', country: 'X', leagueName: 'X', primaryColor: '#000000', secondaryColor: '#FFFFFF' }],
  ['PATCH', '/api/admin/clubs/1', { inPool: false }],
  ['POST', '/api/admin/clubs/1/rebalance', { delta: 5 }],
  ['GET', '/api/admin/clubs/ranking?humans=3'],
  ['GET', '/api/admin/games'],
  ['POST', '/api/admin/games/ABCDEF/reset-draft'],
  ['POST', '/api/admin/games/ABCDEF/rerun'],
  ['POST', '/api/admin/games/ABCDEF/seed', { seed: 5 }],
  ['DELETE', '/api/admin/games/ABCDEF'],
  ['GET', '/api/admin/settings'],
  ['PUT', '/api/admin/settings/league.name', { value: 'Hacked' }],
  ['POST', '/api/admin/lab/run', { source: { clubIds: [1, 2] }, mode: 'season' }],
  ['POST', '/api/admin/lab/test-draft', { teams: 2 }],
  ['GET', '/api/admin/users'],
  ['PATCH', '/api/admin/users/1/role', { role: 'admin' }],
  ['POST', '/api/admin/users/1/ban', { banned: true }],
  ['GET', '/api/admin/users/1/games'],
  ['DELETE', '/api/admin/users/1'],
  ['GET', '/api/admin/audit'],
  ['PUT', '/api/admin/announcement', { text: 'pwned' }],
];

describe.each(DIALECTS)('admin panel on %s', (_name, open) => {
  let server: TestServer;
  let admin: Client;
  let user: Client;

  beforeAll(async () => {
    server = await startTestServer(open);
    admin = await registeredClient(server.app, 'boss');
    user = await registeredClient(server.app);
  });
  afterAll(async () => server.close());

  const call = (c: Client, method: string, url: string, body?: unknown) =>
    server.app.inject({ method: method as 'GET', url, ...(body === undefined ? {} : { payload: body as object }), headers: c.cookie ? { cookie: c.cookie } : {} });

  it('refuses every admin endpoint to normal users, guests and anonymous callers', async () => {
    const guest = await guestClient(server.app);
    const anon = new (user.constructor as new (app: unknown) => Client)(server.app);
    for (const [method, url, body] of ENDPOINTS) {
      expect((await call(user, method, url, body)).statusCode, `${method} ${url} as user`).toBe(403);
      expect((await call(guest, method, url, body)).statusCode, `${method} ${url} as guest`).toBe(403);
      expect((await call(anon, method, url, body)).statusCode, `${method} ${url} anonymous`).toBe(401);
    }
    // Nothing changed.
    expect((await admin.get<{ settings: AdminSettingView[] }>('/api/admin/settings')).body.settings.find((s) => s.key === 'league.name')?.value).toBe('Draft XI League');
  });

  it('shows an overview with counts and data health', async () => {
    const res = await admin.get<AdminOverview>('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.counts.clubs).toBe(20);
    expect(res.body.counts.players).toBeGreaterThan(440);
    expect(res.body.counts.users).toBe(2);
    expect(Array.isArray(res.body.health)).toBe(true);
  });

  it('searches, edits, bulk-edits and deletes players, with audit entries', async () => {
    const found = await admin.get<{ players: AdminPlayerView[]; total: number }>('/api/admin/players?search=haaland');
    expect(found.body.total).toBeGreaterThanOrEqual(1);
    const haaland = found.body.players[0]!;
    const edited = await admin.patch<{ player: AdminPlayerView }>(`/api/admin/players/${haaland.id}`, { overall: 95, sourceNote: 'checked' });
    expect(edited.body.player.overall).toBe(95);
    expect((await admin.patch(`/api/admin/players/${haaland.id}`, { overall: 120 })).status).toBe(400);

    const gks = await admin.get<{ players: AdminPlayerView[] }>('/api/admin/players?position=GK&pageSize=3');
    expect(gks.body.players.every((p) => p.primaryPosition === 'GK')).toBe(true);
    const ids = gks.body.players.map((p) => p.id);
    expect((await admin.post<{ updated: number }>('/api/admin/players/bulk', { ids, patch: { isInjured: true } })).body.updated).toBe(3);
    const injured = await admin.get<{ total: number }>('/api/admin/players?status=injured');
    expect(injured.body.total).toBe(3);

    const created = await admin.post<{ player: AdminPlayerView }>('/api/admin/players', { clubId: haaland.clubId, fullName: 'Test Youngster', primaryPosition: 'CM', altPositions: ['CDM'], overall: 65, nationality: 'Norway' });
    expect(created.status).toBe(201);
    expect((await admin.post('/api/admin/players', { clubId: haaland.clubId, fullName: 'Test Youngster', primaryPosition: 'CM', overall: 65, nationality: 'Norway' })).status).toBe(409);
    expect((await admin.del(`/api/admin/players/${created.body.player.id}`)).status).toBe(200);

    const audit = await admin.get<{ entries: AuditEntryView[] }>('/api/admin/audit?action=player');
    expect(audit.body.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['player.update', 'player.bulk', 'player.create', 'player.delete']));
  });

  it('previews an import with a diff, then applies it', async () => {
    const found = (await admin.get<{ players: AdminPlayerView[] }>('/api/admin/players?search=mbapp')).body.players[0]!;
    const csv = [
      'club,name,position,alt_positions,overall,nationality',
      `${found.clubName},${found.fullName},${found.primaryPosition},${found.altPositions.join('|')},${found.overall - 1},${found.nationality}`,
      `${found.clubName},Brand New Signing,LB,LWB,70,Spain`,
      'Nowhere FC,Ghost,ST,,70,Spain',
    ].join('\n');
    const preview = await admin.post<ImportPreview>('/api/admin/players/import/preview', { format: 'csv', content: csv });
    expect(preview.status).toBe(200);
    expect(preview.body.updated).toHaveLength(1);
    expect(preview.body.updated[0]!.changes.overall).toEqual([found.overall, found.overall - 1]);
    expect(preview.body.added).toHaveLength(1);
    expect(preview.body.errors).toEqual([{ row: 4, message: 'Unknown club "Nowhere FC"' }]);
    // Errors block the apply.
    expect((await admin.post('/api/admin/players/import/apply', { format: 'csv', content: csv })).status).toBe(400);
    const fixed = csv.split('\n').slice(0, 3).join('\n');
    const applied = await admin.post<ImportPreview>('/api/admin/players/import/apply', { format: 'csv', content: fixed });
    expect(applied.status).toBe(200);
    expect((await admin.get<{ total: number }>('/api/admin/players?search=brand new signing')).body.total).toBe(1);
    // Re-applying the same file changes nothing.
    const again = await admin.post<ImportPreview>('/api/admin/players/import/preview', { format: 'csv', content: fixed });
    expect(again.body.unchanged).toBe(2);
    // JSON export round-trips.
    const exported = await call(admin, 'GET', '/api/admin/players/export?format=json');
    expect(exported.statusCode).toBe(200);
    const back = await admin.post<ImportPreview>('/api/admin/players/import/preview', { format: 'json', content: exported.body });
    expect(back.status, JSON.stringify(back.body).slice(0, 400)).toBe(200);
    expect(back.body.added).toHaveLength(0);
    expect(back.body.updated).toHaveLength(0);
    expect(back.body.errors).toHaveLength(0);
  });

  it('finds duplicates and rebalances a club', async () => {
    const p = (await admin.get<{ players: AdminPlayerView[] }>('/api/admin/players?search=rodri')).body.players[0]!;
    const other = (await admin.get<{ clubs: AdminClubView[] }>('/api/admin/clubs')).body.clubs.find((c) => c.id !== p.clubId)!;
    await admin.post('/api/admin/players', { clubId: other.id, fullName: p.fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(), primaryPosition: 'RW', overall: 60, nationality: 'Egypt' });
    const dupes = (await admin.get<{ groups: AdminPlayerView[][] }>('/api/admin/players/duplicates')).body.groups;
    expect(dupes.some((g) => g.some((x) => x.id === p.id))).toBe(true);

    const before = (await admin.get<{ players: AdminPlayerView[] }>(`/api/admin/players?clubId=${other.id}&pageSize=200`)).body.players;
    const res = await admin.post<{ updated: number }>(`/api/admin/clubs/${other.id}/rebalance`, { delta: -3 });
    expect(res.body.updated).toBe(before.length);
    const after = (await admin.get<{ players: AdminPlayerView[] }>(`/api/admin/players?clubId=${other.id}&pageSize=200`)).body.players;
    const byId = new Map(after.map((x) => [x.id, x.overall]));
    for (const b of before) expect(byId.get(b.id)).toBe(Math.max(40, b.overall - 3));
  });

  it('edits clubs, overrides strength and previews AI clubs for N humans', async () => {
    const clubs = (await admin.get<{ clubs: AdminClubView[] }>('/api/admin/clubs')).body.clubs;
    const weakest = [...clubs].sort((a, b) => (a.strengthRating ?? 0) - (b.strengthRating ?? 0))[0]!;
    const before = (await admin.get<ClubRankingView>('/api/admin/clubs/ranking?humans=3')).body;
    expect(before.rows.filter((r) => r.isAi)).toHaveLength(17);
    expect(before.rows.find((r) => r.clubId === weakest.id)?.isAi).toBe(false);
    const patched = await admin.patch<{ club: AdminClubView }>(`/api/admin/clubs/${weakest.id}`, { strengthOverride: 99, primaryColor: '#123456' });
    expect(patched.body.club.strengthOverride).toBe(99);
    expect((await admin.patch(`/api/admin/clubs/${weakest.id}`, { primaryColor: 'red' })).status).toBe(400);
    const after = (await admin.get<ClubRankingView>('/api/admin/clubs/ranking?humans=3')).body;
    expect(after.rows[0]).toMatchObject({ clubId: weakest.id, rank: 1, overridden: true, isAi: true });

    const custom = await admin.post<{ club: AdminClubView }>('/api/admin/clubs', { name: 'Custom United', shortName: 'CUS', country: 'England', leagueName: 'Custom League', primaryColor: '#111111', secondaryColor: '#EEEEEE', inPool: false });
    expect(custom.status).toBe(201);
    await admin.patch(`/api/admin/clubs/${weakest.id}`, { strengthOverride: null });
  });

  it('validates settings by key and applies them', async () => {
    expect((await admin.req('PUT', '/api/admin/settings/league.name', { value: '' })).status).toBe(400);
    expect((await admin.req('PUT', '/api/admin/settings/no.such.key', { value: 1 })).status).toBe(404);
    const ok = await admin.req<{ setting: AdminSettingView }>('PUT', '/api/admin/settings/league.name', { value: 'Sunday League' });
    expect(ok.body.setting.value).toBe('Sunday League');
    expect((await user.get<{ leagueName: string }>('/api/site')).body.leagueName).toBe('Sunday League');
    const bands = { enabled: true, bands: [{ label: 'Winners', from: 1, to: 1, color: 'gold' }] };
    expect((await admin.req('PUT', '/api/admin/settings/table.bands', { value: bands })).status).toBe(200);
    expect((await user.get<{ tableBands: unknown }>('/api/site')).body.tableBands).toEqual(bands);

    // Maintenance blocks new games for everyone but admins.
    await admin.req('PUT', '/api/admin/settings/site.maintenance', { value: { enabled: true, message: 'Back soon' } });
    const blocked = await user.post<{ error: { code: string } }>('/api/games', { name: 'Nope', team: team('Blocked FC') });
    expect(blocked.status).toBe(503);
    await admin.req('PUT', '/api/admin/settings/site.maintenance', { value: { enabled: false, message: 'Back soon' } });

    expect((await admin.req('PUT', '/api/admin/announcement', { text: 'Cup final tonight' })).status).toBe(200);
    expect((await user.get<{ banner: string }>('/api/site')).body.banner).toBe('Cup final tonight');
    await admin.req('PUT', '/api/admin/announcement', { text: '' });
  });

  it('runs the Simulation Lab and a one-click Test Draft', async () => {
    const clubs = (await admin.get<{ clubs: AdminClubView[] }>('/api/admin/clubs')).body.clubs.filter((c) => c.inPool).slice(0, 20);
    const season = await admin.post<LabResultView>('/api/admin/lab/run', { source: { clubIds: clubs.map((c) => c.id) }, mode: 'season', seed: 42 });
    expect(season.status, JSON.stringify(season.body)).toBe(200);
    expect(season.body.table).toHaveLength(20);
    const again = await admin.post<LabResultView>('/api/admin/lab/run', { source: { clubIds: clubs.map((c) => c.id) }, mode: 'season', seed: 42 });
    expect(again.body.table).toEqual(season.body.table);
    expect((await admin.post('/api/admin/lab/run', { source: { clubIds: clubs.slice(0, 3).map((c) => c.id) }, mode: 'season' })).status).toBe(400);
    const mc = await admin.post<LabResultView>('/api/admin/lab/run', { source: { clubIds: clubs.map((c) => c.id) }, mode: 'montecarlo', runs: 20, params: { chaos: 0.8 } });
    expect(mc.body.monteCarlo?.runs).toBe(20);
    expect(mc.body.monteCarlo?.pointsByPosition).toHaveLength(20);
    expect(mc.body.summary.goalsPerMatch).toBeGreaterThan(1.5);

    const test = await admin.post<{ code: string }>('/api/admin/lab/test-draft', { teams: 3, level: 'easy' });
    expect(test.status, JSON.stringify(test.body)).toBe(201);
    const snap = (await admin.get<GameSnapshot>(`/api/games/${test.body.code}`)).body;
    expect(snap.game.status).toBe('completed');
    expect(snap.draft?.picks).toHaveLength(33);
    const fromGame = await admin.post<LabResultView>('/api/admin/lab/run', { source: { gameCode: test.body.code }, mode: 'season' });
    expect(fromGame.body.teams).toHaveLength(20);
  });

  it('manages games: reset draft, re-run, seed and delete', async () => {
    const games = (await admin.get<{ games: AdminGameView[] }>('/api/admin/games?status=completed')).body.games;
    const g = games[0]!;
    expect(g.humans + g.bots).toBe(3);
    const first = (await admin.get<{ fixtures: { homeGoals: number }[] }>(`/api/games/${g.code}/seasons/1`)).body;
    await admin.post(`/api/admin/games/${g.code}/seed`, { seed: 12345 });
    expect((await admin.post(`/api/admin/games/${g.code}/rerun`)).status).toBe(200);
    const rerun = (await admin.get<{ seed: number; fixtures: { homeGoals: number }[] }>(`/api/games/${g.code}/seasons/1`)).body;
    expect(rerun.seed).toBe(12345);
    expect(rerun.fixtures).not.toEqual(first.fixtures);
    expect((await admin.post(`/api/admin/games/${g.code}/reset-draft`)).status).toBe(409);

    // A drafting game can be reset to pick 1.
    const host = await registeredClient(server.app);
    const created = await host.post<{ game: { code: string } }>('/api/games', { name: 'Reset me', settings: { pickTimerSeconds: null }, team: team('Reset FC') });
    const code = created.body.game.code;
    await host.post(`/api/games/${code}/bots`, { level: 'easy' });
    // Admins may use host controls in any game.
    expect((await admin.post(`/api/games/${code}/start`, { force: true })).status).toBe(200);
    await waitFor(async () => (await admin.get<GameSnapshot>(`/api/games/${code}`)).body.game.status === 'drafting');
    await admin.post(`/api/games/${code}/draft/skip`);
    expect((await admin.get<GameSnapshot>(`/api/games/${code}`)).body.draft!.picks.length).toBeGreaterThan(0);
    expect((await admin.post(`/api/admin/games/${code}/reset-draft`)).status).toBe(200);
    const reset = (await admin.get<GameSnapshot>(`/api/games/${code}`)).body;
    expect(reset.game.currentPickNumber).toBe(1);
    expect(reset.draft!.picks).toHaveLength(0);

    expect((await admin.del(`/api/admin/games/${code}`)).status).toBe(200);
    expect((await admin.get(`/api/games/${code}`)).status).toBe(404);
  });

  it('bans, unbans and deletes users', async () => {
    const victim = await registeredClient(server.app, 'victim_user');
    const users = (await admin.get<{ users: AdminUserView[] }>('/api/admin/users?search=victim')).body.users;
    expect(users).toHaveLength(1);
    const id = users[0]!.id;
    const meId = (await admin.get<{ user: { id: number } }>('/api/auth/me')).body.user.id;
    expect((await admin.post(`/api/admin/users/${meId}/ban`, { banned: true })).status).toBe(400);
    await admin.post(`/api/admin/users/${id}/ban`, { banned: true });
    expect((await victim.get<{ user: unknown }>('/api/auth/me')).body.user ?? null).toBeNull();
    expect((await victim.post('/api/auth/login', { username: 'victim_user', password: 'correct horse' })).status).toBe(403);
    await admin.post(`/api/admin/users/${id}/ban`, { banned: false });
    expect((await victim.post('/api/auth/login', { username: 'victim_user', password: 'correct horse' })).status).toBe(200);
    expect((await admin.get<{ games: unknown[] }>(`/api/admin/users/${id}/games`)).body.games).toEqual([]);
    expect((await admin.del(`/api/admin/users/${id}`)).status).toBe(200);
    expect((await admin.get<{ users: AdminUserView[] }>('/api/admin/users?search=victim')).body.users).toHaveLength(0);
  });

  it('filters the audit log and exports CSV', async () => {
    const all = (await admin.get<{ entries: AuditEntryView[] }>('/api/admin/audit?actor=boss&limit=500')).body.entries;
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((e) => e.actor.toLowerCase().includes('boss'))).toBe(true);
    const csv = await call(admin, 'GET', '/api/admin/audit?format=csv&action=user');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('user.ban');
    const future = (await admin.get<{ entries: AuditEntryView[] }>('/api/admin/audit?from=2999-01-01')).body.entries;
    expect(future).toHaveLength(0);
  });
});
