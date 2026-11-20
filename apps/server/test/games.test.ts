import type { GameSnapshot } from '@draft-xi/server/contracts';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIALECTS } from './helpers/db';
import { Client, guestClient, registeredClient, startTestServer, team, type TestServer, waitFor } from './helpers/server';

type Created = { game: { code: string; id: number; status: string } };

describe.each(DIALECTS)('games on %s', (_name, open) => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer(open);
  });
  afterAll(async () => server.close());

  const create = async (host: Client, name = 'Sunday League', settings: Record<string, unknown> = {}, teamName = 'Host FC') => {
    const res = await host.post<Created>('/api/games', { name, settings, team: team(teamName) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.game;
  };
  const snap = async (c: Client, code: string) => (await c.get<GameSnapshot>(`/api/games/${code}`)).body;

  it('requires a session to create, and anyone can spectate by code', async () => {
    const anon = new Client(server.app);
    expect((await anon.post('/api/games', { name: 'Nope', team: team('Nope FC') })).status).toBe(401);
    const host = await registeredClient(server.app);
    const game = await create(host);
    const view = await snap(anon, game.code);
    expect(view.game.status).toBe('lobby');
    expect(view.participants).toHaveLength(1);
    expect(view.participants[0]?.isHost).toBe(true);
    expect(view.aiClubCount).toBe(19);
    expect(view.me.participantId).toBeNull();
    expect((await anon.get('/api/games/ZZZZZZ')).status).toBe(404);
  });

  it('lets players join, rejects duplicate and profane team names, and enforces max players', async () => {
    const host = await registeredClient(server.app);
    const game = await create(host, 'Small', { maxHumans: 2 });
    const guest = await guestClient(server.app);
    expect((await guest.post(`/api/games/${game.code}/join`, team('host fc'))).status).toBe(409);
    expect((await guest.post(`/api/games/${game.code}/join`, team('Shit Town'))).status).toBe(400);
    expect((await guest.post(`/api/games/${game.code}/join`, team('Guest Rovers'))).status).toBe(201);
    // Joining again is idempotent.
    expect((await guest.post(`/api/games/${game.code}/join`, team('Guest Rovers'))).status).toBe(201);
    const third = await guestClient(server.app);
    const full = await third.post<{ error: { code: string } }>(`/api/games/${game.code}/join`, team('Third Wheel'));
    expect(full.body.error.code).toBe('game_full');
    const view = await snap(guest, game.code);
    expect(view.participants.map((p) => p.teamName)).toEqual(['Host FC', 'Guest Rovers']);
    expect(view.aiClubCount).toBe(18);
  });

  it('only lets the host use host controls', async () => {
    const host = await registeredClient(server.app);
    const game = await create(host);
    const other = await registeredClient(server.app);
    await other.post(`/api/games/${game.code}/join`, team('Other FC'));
    for (const [method, url, body] of [
      ['PATCH', `/api/games/${game.code}/settings`, { settings: { draftMode: 'linear' } }],
      ['POST', `/api/games/${game.code}/bots`, { level: 'easy' }],
      ['POST', `/api/games/${game.code}/order`, { randomize: true }],
      ['POST', `/api/games/${game.code}/start`, { force: true }],
      ['POST', `/api/games/${game.code}/cancel`, {}],
    ] as const) {
      expect((await other.req(method, url, body)).status, url).toBe(403);
    }
    const hostSnap = await snap(host, game.code);
    const hostParticipant = hostSnap.participants.find((p) => p.isHost)!;
    expect((await other.del(`/api/games/${game.code}/participants/${hostParticipant.id}`)).status).toBe(403);
  });

  it('applies settings limits from app_settings', async () => {
    const host = await registeredClient(server.app);
    const game = await create(host);
    const tooMany = await host.patch<{ error: { code: string } }>(`/api/games/${game.code}/settings`, { settings: { maxHumans: 12 } });
    expect(tooMany.body.error.code).toBe('max_humans');
    const badTimer = await host.patch<{ error: { code: string } }>(`/api/games/${game.code}/settings`, { settings: { pickTimerSeconds: 5 } });
    expect(badTimer.body.error.code).toBe('pick_timer');
    const forced = await host.patch(`/api/games/${game.code}/settings`, { settings: { formationRule: 'forced', forcedFormation: '3-5-2' } });
    expect(forced.status).toBe(200);
    expect((await snap(host, game.code)).participants[0]?.formation).toBe('3-5-2');
  });

  it('handles bots, kicks, pick order and host transfer', async () => {
    const host = await registeredClient(server.app);
    const game = await create(host);
    const bot = await host.post<{ participantId: number }>(`/api/games/${game.code}/bots`, { level: 'hard' });
    expect(bot.status).toBe(201);
    const p2 = await registeredClient(server.app);
    await p2.post(`/api/games/${game.code}/join`, team('Second XI'));
    let view = await snap(host, game.code);
    expect(view.participants).toHaveLength(3);
    expect(view.participants.find((p) => p.isBot)).toMatchObject({ botLevel: 'hard', isReady: true, displayName: 'Bot (Hard)' });

    const ids = view.participants.map((p) => p.id).reverse();
    expect((await host.post(`/api/games/${game.code}/order`, { order: ids })).status).toBe(200);
    expect((await host.post(`/api/games/${game.code}/order`, { order: ids.slice(1) })).status).toBe(400);
    view = await snap(host, game.code);
    expect(view.participants.map((p) => p.id)).toEqual(ids);

    expect((await host.del(`/api/games/${game.code}/participants/${bot.body.participantId}`)).status).toBe(200);
    const second = view.participants.find((p) => p.teamName === 'Second XI')!;
    await host.post(`/api/games/${game.code}/host`, { participantId: second.id });
    view = await snap(p2, game.code);
    expect(view.me.isHost).toBe(true);
    expect((await host.post(`/api/games/${game.code}/bots`, { level: 'easy' })).status).toBe(403);

    // Kicked players cannot rejoin.
    const hostRow = view.participants.find((p) => p.teamName === 'Host FC')!;
    await p2.del(`/api/games/${game.code}/participants/${hostRow.id}`);
    expect((await host.post(`/api/games/${game.code}/join`, team('Back Again'))).status).toBe(403);
  });

  it('refuses to start until everyone is ready and has a formation, unless forced', async () => {
    const host = await registeredClient(server.app);
    const game = await create(host);
    const p2 = await guestClient(server.app);
    await p2.post(`/api/games/${game.code}/join`, team('Late FC', null));
    const notReady = await host.post<{ error: { code: string } }>(`/api/games/${game.code}/start`, {});
    expect(notReady.body.error.code).toBe('not_ready');
    const noFormation = await host.post<{ error: { code: string } }>(`/api/games/${game.code}/start`, { force: true });
    expect(noFormation.body.error.code).toBe('no_formation');
    expect((await snap(host, game.code)).poolHealth.warnings.some((w) => w.includes('not chosen a formation'))).toBe(true);
  });

  it('starts after the countdown with a strength snapshot and the strongest (20 - N) AI clubs', async () => {
    const host = await registeredClient(server.app);
    const game = await create(host, 'Three Up');
    const p2 = await registeredClient(server.app);
    const p3 = await guestClient(server.app);
    await p2.post(`/api/games/${game.code}/join`, team('Two FC'));
    await p3.post(`/api/games/${game.code}/join`, team('Three FC', '4-4-2'));
    for (const c of [host, p2, p3]) await c.patch(`/api/games/${game.code}/me`, { isReady: true });

    const start = await host.post<{ startsAt: string }>(`/api/games/${game.code}/start`, {});
    expect(start.status).toBe(200);
    expect((await snap(host, game.code)).startsAt).toBe(start.body.startsAt);
    await waitFor(async () => (await snap(host, game.code)).game.status === 'drafting');

    const view = await snap(p3, game.code);
    expect(view.game.currentPickNumber).toBe(1);
    expect(view.game.currentParticipantId).toBe(view.participants.find((p) => p.pickOrder === 1)?.id);
    expect(view.game.pickDeadline).not.toBeNull();
    expect(view.kickoff?.strengths).toHaveLength(20);
    expect(view.kickoff?.aiClubIds).toHaveLength(17);
    const top17 = view.kickoff!.strengths.filter((s) => s.rank <= 17).map((s) => s.clubId);
    expect([...view.kickoff!.aiClubIds].sort()).toEqual([...top17].sort());
    expect(view.participants.map((p) => p.pickOrder)).toEqual([1, 2, 3]);

    const [row] = await server.database.db.select().from(server.database.t.games).where(eq(server.database.t.games.id, view.game.id));
    expect(row?.seed).toBeGreaterThan(0);
    // The lobby is locked now.
    expect((await p2.patch(`/api/games/${game.code}/me`, { teamName: 'Renamed' })).status).toBe(409);
    expect((await new Client(server.app).post(`/api/games/${game.code}/join`, team('Too Late'))).status).toBe(401);

    const audit = await server.database.db.select().from(server.database.t.auditLog).where(eq(server.database.t.auditLog.gameId, view.game.id));
    expect(audit.map((a) => a.action)).toContain('game.start');
  });

  it('Play Solo creates a started game with 19 AI clubs', async () => {
    const g = await guestClient(server.app, 'Solo Sam');
    const res = await g.post<Created>('/api/games/solo', { team: team('Lone Wolves') });
    expect(res.status).toBe(201);
    expect(res.body.game.status).toBe('drafting');
    const view = await snap(g, res.body.game.code);
    expect(view.kickoff?.aiClubIds).toHaveLength(19);
    expect(view.participants).toHaveLength(1);
  });

  it('cancels a game when the host leaves alone, and hands over host otherwise', async () => {
    const host = await registeredClient(server.app);
    const solo = await create(host, 'Lonely');
    await host.post(`/api/games/${solo.code}/leave`);
    expect((await snap(host, solo.code)).game.status).toBe('cancelled');

    const game = await create(host, 'Shared');
    const p2 = await registeredClient(server.app);
    await p2.post(`/api/games/${game.code}/join`, team('Heir FC'));
    await host.post(`/api/games/${game.code}/leave`);
    const view = await snap(p2, game.code);
    expect(view.game.status).toBe('lobby');
    expect(view.me.isHost).toBe(true);
  });

  it('lists public lobbies only', async () => {
    const host = await registeredClient(server.app);
    const pub = await create(host, 'Open Doors', { visibility: 'public' });
    const priv = await create(await registeredClient(server.app), 'Secret Club');
    const res = await host.get<{ lobbies: { code: string }[] }>('/api/games/public');
    const codes = res.body.lobbies.map((l) => l.code);
    expect(codes).toContain(pub.code);
    expect(codes).not.toContain(priv.code);
  });

  it('pushes a snapshot on subscribe, then events, over Socket.IO', async () => {
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const address = server.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const host = await registeredClient(server.app);
    const game = await create(host, 'Live Game');

    const socket: Socket = connect(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      extraHeaders: { cookie: host.cookie },
    });
    const snapshots: GameSnapshot[] = [];
    const events: { type: string }[] = [];
    socket.on('game:snapshot', (s: GameSnapshot) => snapshots.push(s));
    socket.on('game:event', (e: { type: string }) => events.push(e));
    try {
      const ack: unknown = await socket.emitWithAck('game:subscribe', game.code);
      expect(ack).toMatchObject({ ok: true });
      expect(snapshots[0]?.me.isHost).toBe(true);
      await waitFor(async () => (await snap(host, game.code)).participants[0]?.isConnected === true);

      const p2 = await guestClient(server.app);
      await p2.post(`/api/games/${game.code}/join`, team('Socket City'));
      await host.post(`/api/games/${game.code}/chat`, { body: 'hello' });
      await waitFor(() => events.some((e) => e.type === 'chat:message'));
      expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['participant:joined', 'pool:health', 'chat:message']));

      const bad: unknown = await socket.emitWithAck('game:subscribe', 'nope');
      expect(bad).toMatchObject({ ok: false });
    } finally {
      socket.disconnect();
    }
    await waitFor(async () => (await snap(host, game.code)).participants[0]?.isConnected === false);
  });
});
