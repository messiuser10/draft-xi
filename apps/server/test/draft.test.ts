import { fitsSlot, getFormation, isPosition, type Position } from '@draft-xi/engine';
import type { GameSnapshot, PoolPlayerView, PoolView } from '@draft-xi/server/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIALECTS } from './helpers/db';
import { type Client, guestClient, registeredClient, startTestServer, team, type TestServer, waitFor } from './helpers/server';

type Created = { game: { code: string; id: number } };
type ErrorBody = { error: { code: string; message: string } };

const positions = (p: PoolPlayerView): Position[] => [p.primaryPosition, ...p.altPositions].filter(isPosition);

describe.each(DIALECTS)('draft on %s', (_name, open) => {
  let server: TestServer;
  let pool: PoolView;
  beforeAll(async () => {
    server = await startTestServer(open);
    pool = (await (await guestClient(server.app)).get<PoolView>('/api/pool')).body;
  });
  afterAll(async () => server.close());

  const snap = async (c: Client, code: string) => (await c.get<GameSnapshot>(`/api/games/${code}`)).body;
  const { t } = { t: () => server.database.t };

  /** Host plus guests, started and drafting. Default: no pick timer so nothing fires on its own. */
  async function startDraft(settings: Record<string, unknown> = {}, guests = 1) {
    const host = await registeredClient(server.app);
    const res = await host.post<Created>('/api/games', { name: 'Draft Night', settings: { pickTimerSeconds: null, ...settings }, team: team('Host FC') });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const code = res.body.game.code;
    const others: Client[] = [];
    for (let i = 0; i < guests; i++) {
      const g = await guestClient(server.app, `Guest ${i + 1}`);
      expect((await g.post(`/api/games/${code}/join`, team(`Guest Team ${i + 1}`))).status).toBe(201);
      others.push(g);
    }
    await host.post(`/api/games/${code}/order`, { order: (await snap(host, code)).participants.map((p) => p.id) });
    expect((await host.post(`/api/games/${code}/start`, { force: true })).status).toBe(200);
    await waitFor(async () => (await snap(host, code)).game.status === 'drafting');
    return { host, others, code, gameId: res.body.game.id };
  }

  const best = (slotType: string, taken: Set<number> = new Set()) =>
    [...pool.players]
      .sort((a, b) => b.overall - a.overall)
      .find((p) => !taken.has(p.id) && p.primaryPosition === slotType)!;

  it('rejects out-of-turn picks, wrong slots and taken players; the loser keeps the turn', async () => {
    const { host, others, code } = await startDraft();
    const guest = others[0]!;
    const view = await snap(host, code);
    const [hostTeam, guestTeam] = view.participants;
    expect(view.game.currentParticipantId).toBe(hostTeam!.id);
    expect(view.draft?.totalPicks).toBe(22);

    const striker = best('ST');
    const outOfTurn = await guest.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: striker.id, slotKey: 'ST' });
    expect(outOfTurn.status).toBe(403);
    expect(outOfTurn.body.error.code).toBe('not_your_turn');

    // A striker in goal, and a left-back at centre-back, are both refused.
    const inGoal = await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: striker.id, slotKey: 'GK' });
    expect(inGoal.status).toBe(400);
    expect(inGoal.body.error.code).toBe('wrong_slot');
    const leftBack = best('LB');
    const lbAtCb = await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: leftBack.id, slotKey: 'LCB' });
    expect(lbAtCb.body.error.code).toBe('wrong_slot');
    expect((await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: striker.id, slotKey: 'XX' })).body.error.code).toBe('wrong_slot');

    expect((await host.post(`/api/games/${code}/picks`, { playerId: striker.id, slotKey: 'ST' })).status).toBe(201);
    const after = await snap(guest, code);
    expect(after.game.currentParticipantId).toBe(guestTeam!.id);
    expect(after.game.currentPickNumber).toBe(2);

    const taken = await guest.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: striker.id, slotKey: 'ST' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/Someone just drafted that player/);
    expect((await snap(guest, code)).game.currentParticipantId).toBe(guestTeam!.id);

    // Snake: picks 2 and 3 both belong to the guest.
    expect((await guest.post(`/api/games/${code}/picks`, { playerId: best('GK').id, slotKey: 'GK' })).status).toBe(201);
    expect((await snap(guest, code)).game.currentParticipantId).toBe(guestTeam!.id);
  });

  it('lets exactly one of two simultaneous picks win', async () => {
    const { host, others, code } = await startDraft();
    const player = best('CM');
    const results = await Promise.all([
      host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: player.id, slotKey: 'LCM' }),
      host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: player.id, slotKey: 'RCM' }),
      others[0]!.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: player.id, slotKey: 'LCM' }),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409 || r.status === 403)).toBe(true);
    const view = await snap(host, code);
    expect(view.draft?.picks).toHaveLength(1);
    expect(view.game.currentPickNumber).toBe(2);
  });

  it('auto-picks on timer expiry, queue first, then the best legal player', async () => {
    const { host, others, code, gameId } = await startDraft();
    const guest = others[0]!;
    const { db } = server.database;
    const games = t().games;
    expect((await host.post(`/api/games/${code}/picks`, { playerId: best('ST').id, slotKey: 'ST' })).status).toBe(201);

    // Guest queues a goalkeeper ranked well below the best; expiry takes him anyway.
    const keepers = pool.players.filter((p) => p.primaryPosition === 'GK').sort((a, b) => a.overall - b.overall);
    const queued = keepers[0]!;
    expect((await guest.req('PUT', `/api/games/${code}/queue`, { playerIds: [queued.id] })).status).toBe(200);
    expect((await snap(guest, code)).draft?.myQueue).toEqual([queued.id]);

    await db.update(games).set({ pickDeadline: new Date(Date.now() - 1000) }).where(eq(games.id, gameId));
    await server.ctx.draft.schedule(gameId);
    await waitFor(async () => ((await snap(guest, code)).draft?.picks.length ?? 0) === 2);
    const second = (await snap(guest, code)).draft!.picks[1]!;
    expect(second).toMatchObject({ playerId: queued.id, slotKey: 'GK', autoPicked: true });

    // Empty queue: the best available player for the scarcest open slot.
    await db.update(games).set({ pickDeadline: new Date(Date.now() - 1000) }).where(eq(games.id, gameId));
    await server.ctx.draft.schedule(gameId);
    await waitFor(async () => ((await snap(guest, code)).draft?.picks.length ?? 0) === 3);
    const third = (await snap(guest, code)).draft!.picks[2]!;
    const player = pool.players.find((p) => p.id === third.playerId)!;
    const slot = getFormation('4-3-3').slots.find((s) => s.key === third.slotKey)!;
    expect(fitsSlot({ primaryPosition: positions(player)[0]!, altPositions: positions(player).slice(1) }, slot.type)).toBe(true);
    expect(third.autoPicked).toBe(true);
  });

  it('pauses (freezing the clock for everyone) and resumes with the time that was left', async () => {
    const { host, others, code } = await startDraft({ pickTimerSeconds: 60 });
    expect((await others[0]!.post(`/api/games/${code}/draft/pause`)).status).toBe(403);
    expect((await host.post(`/api/games/${code}/draft/pause`)).status).toBe(200);
    const paused = await snap(host, code);
    expect(paused.game.status).toBe('paused');
    expect(paused.game.pickDeadline).toBeNull();
    expect(paused.game.pausedRemainingMs).toBeGreaterThan(55_000);
    const pick = await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: best('ST').id, slotKey: 'ST' });
    expect(pick.body.error.code).toBe('paused');
    await new Promise((r) => setTimeout(r, 150));
    expect((await host.post(`/api/games/${code}/draft/resume`)).status).toBe(200);
    const resumed = await snap(host, code);
    const left = Date.parse(resumed.game.pickDeadline!) - Date.parse(resumed.serverTime);
    // The 150 ms spent paused did not count.
    expect(Math.abs(left - paused.game.pausedRemainingMs!)).toBeLessThan(120);
    expect((await host.post(`/api/games/${code}/draft/extend`, { seconds: 30 })).status).toBe(200);
    expect(Date.parse((await snap(host, code)).game.pickDeadline!)).toBeGreaterThan(Date.parse(resumed.game.pickDeadline!) + 29_000);
  });

  it('restores the exact state on refresh and supports undo and skip', async () => {
    const { host, code } = await startDraft();
    await host.post(`/api/games/${code}/picks`, { playerId: best('ST').id, slotKey: 'ST' });
    expect((await host.post(`/api/games/${code}/draft/skip`)).status).toBe(200);
    const before = await snap(host, code);
    expect(before.draft?.picks).toHaveLength(2);
    expect(before.draft?.picks[1]?.autoPicked).toBe(true);
    // A fresh request (a refresh) sees the same picks and turn.
    const again = await snap(host, code);
    expect(again.draft?.picks).toEqual(before.draft?.picks);
    expect(again.game.currentParticipantId).toBe(before.game.currentParticipantId);

    expect((await host.post(`/api/games/${code}/draft/undo`)).status).toBe(200);
    const undone = await snap(host, code);
    expect(undone.draft?.picks).toHaveLength(1);
    expect(undone.game.currentPickNumber).toBe(2);
    expect(undone.game.currentParticipantId).toBe(before.draft?.picks[1]?.participantId);
    const audit = await server.database.db.select().from(t().auditLog).where(eq(t().auditLog.gameId, undone.game.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['draft.skip', 'draft.undo']));
  });

  it('applies the host policy to a team that stays disconnected', async () => {
    const { host, code, gameId } = await startDraft();
    const view = await snap(host, code);
    const guestTeam = view.participants[1]!;
    await host.post(`/api/games/${code}/picks`, { playerId: best('ST').id, slotKey: 'ST' });
    // The guest is on the clock and offline; the grace period in tests is 100 ms.
    await server.ctx.draft.connectionChanged(gameId, guestTeam.id, false);
    await waitFor(async () => ((await snap(host, code)).draft?.picks.length ?? 0) >= 3);
    const after = await snap(host, code);
    expect(after.participants[1]?.autoDraft).toBe('autopick');
    expect(after.draft?.picks.slice(1, 3).every((p) => p.participantId === guestTeam.id && p.autoPicked)).toBe(true);
    // Reconnecting hands the team back.
    await server.ctx.draft.connectionChanged(gameId, guestTeam.id, true);
    expect((await snap(host, code)).participants[1]?.autoDraft).toBeNull();

    expect((await host.post(`/api/games/${code}/draft/disconnect-policy`, { policy: 'bot' })).status).toBe(200);
    expect((await snap(host, code)).game.settings.disconnectPolicy).toBe('bot');
  });

  it('bots draft legal teams and ending early fills every slot', async () => {
    const host = await registeredClient(server.app);
    const res = await host.post<Created>('/api/games', { name: 'Bot Night', settings: { pickTimerSeconds: null }, team: team('Humans FC') });
    const code = res.body.game.code;
    for (const level of ['easy', 'medium', 'hard']) expect((await host.post(`/api/games/${code}/bots`, { level })).status).toBe(201);
    await host.post(`/api/games/${code}/order`, { order: (await snap(host, code)).participants.map((p) => p.id).reverse() });
    await host.post(`/api/games/${code}/start`, { force: true });
    // Three bots pick first; the human is last in round 1.
    await waitFor(async () => (await snap(host, code)).draft?.picks.length === 3);
    const mid = await snap(host, code);
    expect(mid.game.currentParticipantId).toBe(mid.participants.find((p) => !p.isBot)!.id);
    expect(mid.draft!.picks.every((p) => !p.autoPicked)).toBe(true);

    expect((await host.post(`/api/games/${code}/draft/end`)).status).toBe(200);
    await waitFor(async () => (await snap(host, code)).game.status === 'draft_complete', 10_000);
    const done = await snap(host, code);
    expect(done.draft?.picks).toHaveLength(44);
    expect(new Set(done.draft!.picks.map((p) => p.playerId)).size).toBe(44);
    for (const team of done.participants) {
      const mine = done.draft!.picks.filter((p) => p.participantId === team.id);
      expect(mine).toHaveLength(11);
      const slots = getFormation(team.formation!).slots;
      for (const pick of mine) {
        const player = pool.players.find((p) => p.id === pick.playerId)!;
        const slot = slots.find((s) => s.key === pick.slotKey)!;
        expect(fitsSlot({ primaryPosition: positions(player)[0]!, altPositions: positions(player).slice(1) }, slot.type)).toBe(true);
      }
    }
    expect((await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: best('ST').id, slotKey: 'ST' })).body.error.code).toBe('not_drafting');
  });

  it('Pack Pick only allows the five offered players and one reroll', async () => {
    const { host, code } = await startDraft({ draftMode: 'pack' });
    const view = await snap(host, code);
    const pack = view.draft!.pack!;
    expect(pack).toHaveLength(5);
    const outside = pool.players.find((p) => !pack.includes(p.id) && p.primaryPosition === 'ST')!;
    expect((await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: outside.id, slotKey: 'ST' })).body.error.code).toBe('not_in_pack');
    const rerolled = await host.post<{ options: number[] }>(`/api/games/${code}/pack/reroll`);
    expect(rerolled.status).toBe(200);
    expect(rerolled.body.options).not.toEqual(pack);
    expect((await host.post<ErrorBody>(`/api/games/${code}/pack/reroll`)).body.error.code).toBe('no_rerolls');
    const choice = pool.players.find((p) => p.id === rerolled.body.options[0])!;
    const slot = getFormation('4-3-3').slots.find((s) => fitsSlot({ primaryPosition: positions(choice)[0]!, altPositions: positions(choice).slice(1) }, s.type))!;
    expect((await host.post(`/api/games/${code}/picks`, { playerId: choice.id, slotKey: slot.key })).status).toBe(201);
  });

  it('enforces the club cap', async () => {
    const { host, others, code } = await startDraft({ clubCap: 1 });
    const guest = others[0]!;
    const st = best('ST');
    expect((await host.post(`/api/games/${code}/picks`, { playerId: st.id, slotKey: 'ST' })).status).toBe(201);
    const gk = pool.players.find((p) => p.primaryPosition === 'GK' && p.clubId !== st.clubId)!;
    const st2 = pool.players.find((p) => p.primaryPosition === 'ST' && p.id !== st.id && p.clubId !== gk.clubId)!;
    expect((await guest.post(`/api/games/${code}/picks`, { playerId: gk.id, slotKey: 'GK' })).status).toBe(201);
    // The guest already has a player from the keeper's club.
    const capped = pool.players.find((p) => p.clubId === gk.clubId && p.primaryPosition === 'ST')!;
    expect((await guest.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: capped.id, slotKey: 'ST' })).body.error.code).toBe('club_cap');
    expect((await guest.post(`/api/games/${code}/picks`, { playerId: st2.id, slotKey: 'ST' })).status).toBe(201);
    const sameClub = pool.players.find((p) => p.clubId === st.clubId && p.primaryPosition === 'GK')!;
    const res = await host.post<ErrorBody>(`/api/games/${code}/picks`, { playerId: sameClub.id, slotKey: 'GK' });
    expect(res.body.error.code).toBe('club_cap');
  });
});
