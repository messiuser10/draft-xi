import { playerValue, windowBudget } from '@draft-xi/server/contracts';
import type { GameSnapshot, LeagueView, MonteCarloView, PlaybackState, PoolView, SeasonView, TitlesRow, TradeView } from '@draft-xi/server/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIALECTS } from './helpers/db';
import { type Client, registeredClient, startTestServer, team, type TestServer, waitFor } from './helpers/server';

type Created = { game: { code: string; id: number } };

describe.each(DIALECTS)('season on %s', (_name, open) => {
  let server: TestServer;
  let host: Client;
  let code: string;
  beforeAll(async () => {
    server = await startTestServer(open);
    host = await registeredClient(server.app);
    const res = await host.post<Created>('/api/games', { name: 'Season Test', settings: { pickTimerSeconds: null }, team: team('Humans United') });
    code = res.body.game.code;
    await host.post(`/api/games/${code}/bots`, { level: 'hard' });
    await host.post(`/api/games/${code}/bots`, { level: 'medium' });
    await host.post(`/api/games/${code}/start`, { force: true });
    await waitFor(async () => (await snap(host, code)).game.status === 'drafting');
    await host.post(`/api/games/${code}/draft/end`);
    await waitFor(async () => (await snap(host, code)).game.status === 'draft_complete', 10_000);
  });
  afterAll(async () => server.close());

  const snap = async (c: Client, gameCode: string) => (await c.get<GameSnapshot>(`/api/games/${gameCode}`)).body;

  it('previews the 20-team league from the draft', async () => {
    const league = (await host.get<LeagueView>(`/api/games/${code}/league`)).body;
    expect(league.source).toBe('draft');
    expect(league.teams).toHaveLength(20);
    expect(league.teams.filter((t) => t.kind === 'human')).toHaveLength(3);
    expect(league.teams.map((t) => t.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('picks a captain and trades with a bot before the season', async () => {
    const view = await snap(host, code);
    expect(view.round?.phase).toBe('preseason');
    const me = view.me.participantId!;
    const mine = view.round!.rosters[me]!;
    expect(Object.keys(mine)).toHaveLength(11);
    const other = await registeredClient(server.app);
    expect((await other.put(`/api/games/${code}/captain`, { playerId: mine.ST })).status).toBe(403);
    const bot = view.participants.find((p) => p.isBot)!;
    expect((await host.put(`/api/games/${code}/captain`, { playerId: view.round!.rosters[bot.id]!.GK })).status).toBe(400);
    expect((await host.put(`/api/games/${code}/captain`, { playerId: mine.ST })).status).toBe(200);
    expect((await snap(host, code)).round?.captains[me]).toBe(mine.ST);

    // Goalkeeper for goalkeeper: the bot accepts when it gets at least as good a player.
    const pool = (await host.get<PoolView>('/api/pool')).body;
    const ovr = (id: number) => pool.players.find((p) => p.id === id)!.overall;
    const theirs = view.round!.rosters[bot.id]!.GK!;
    const res = await host.post<{ trade: TradeView }>(`/api/games/${code}/trades`, { toParticipantId: bot.id, offerPlayerId: mine.GK, requestPlayerId: theirs });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.trade.status).toBe(ovr(mine.GK!) >= ovr(theirs) ? 'accepted' : 'declined');
    const after = (await snap(host, code)).round!;
    if (res.body.trade.status === 'accepted') {
      expect(after.rosters[me]!.GK).toBe(theirs);
      expect(after.rosters[bot.id]!.GK).toBe(mine.GK);
    }
    // A keeper cannot take a striker's slot.
    const bad = await host.post(`/api/games/${code}/trades`, { toParticipantId: bot.id, offerPlayerId: after.rosters[me]!.ST, requestPlayerId: after.rosters[bot.id]!.GK });
    expect(bad.status).toBe(400);
    // No transfers before the season.
    expect((await host.post(`/api/games/${code}/transfers`, { slotKey: 'ST', playerId: 1 })).status).toBe(409);
  });

  it('only the host starts the season, which plays the first half and opens the mini window', async () => {
    const other = await registeredClient(server.app);
    expect((await other.post(`/api/games/${code}/season`)).status).toBe(403);
    const res = await host.post<{ season: { number: number } }>(`/api/games/${code}/season`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await host.post(`/api/games/${code}/season`)).status).toBe(409);

    const view = await snap(host, code);
    expect(view.game.status).toBe('completed');
    expect(view.seasons).toEqual([expect.objectContaining({ number: 1, matchdays: 19, championTeamId: null })]);
    expect(view.playback).toMatchObject({ seasonNumber: 1, matchday: 0, playing: true, cap: 19 });
    expect(view.round).toMatchObject({ phase: 'mini', seasonNumber: 1, transferLimit: 2 });
    // Nobody is connected in tests, so the window counts as watched; a player can still report watching.
    expect(view.round!.allWatched).toBe(true);
    expect((await host.post(`/api/games/${code}/window/watched`)).status).toBe(200);
    expect((await snap(host, code)).round!.watched).toContain(view.me.participantId);
    // Bots are done as soon as the window opens.
    for (const b of view.participants.filter((p) => p.isBot)) expect(view.round!.ready).toContain(b.id);

    const season = (await host.get<SeasonView>(`/api/games/${code}/seasons/1`)).body;
    expect(season.teams).toHaveLength(20);
    expect(season.fixtures).toHaveLength(190);
    expect(season.standings).toHaveLength(19);
    expect(season.championTeamId).toBeNull();
    const captain = season.teams.find((t) => t.participantId === view.me.participantId)!.lineup.find((s) => s.captain);
    expect(captain?.playerId).toBe(view.round!.captains[view.me.participantId!]);
    expect((await host.get(`/api/games/${code}/results`)).status).toBe(409);
    expect((await host.post(`/api/games/${code}/seasons`, { count: 2 })).status).toBe(409);
  });

  it('host controls synchronized playback, capped at the matchdays played', async () => {
    const other = await registeredClient(server.app);
    expect((await other.post(`/api/games/${code}/playback`, { action: 'pause' })).status).toBe(403);
    const paused = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'pause' });
    expect(paused.body.playback.playing).toBe(false);
    const jumped = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'jump', matchday: 12 });
    expect(jumped.body.playback.matchday).toBe(12);
    const fast = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'speed', speed: 5 });
    expect(fast.body.playback).toMatchObject({ speed: 5, matchday: 12 });
    const end = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'end' });
    expect(end.body.playback.matchday).toBe(19);
  });

  it('makes two budgeted transfers in the mini window, then replays the season with the new XI from matchday 20', async () => {
    const view = await snap(host, code);
    const me = view.me.participantId!;
    const before = (await host.get<SeasonView>(`/api/games/${code}/seasons/1`)).body;
    const pool = (await host.get<PoolView>('/api/pool')).body;
    const ovr = (id: number) => pool.players.find((p) => p.id === id)!.overall;
    // The budget comes from league points after matchday 19.
    const myTeam = before.teams.find((t) => t.participantId === me)!.id;
    const myPoints = before.standings[18]!.find((r) => r.teamId === myTeam)!.points;
    expect(view.round!.budgetGrants[me]).toBe(windowBudget('mini', myPoints));
    expect(view.round!.budgetLeft[me]).toBe(windowBudget('mini', myPoints));

    const taken = new Set(Object.values(view.round!.rosters).flatMap((r) => Object.values(r)));
    const freeKeepers = pool.players.filter((p) => p.primaryPosition === 'GK' && !taken.has(p.id)).sort((a, b) => a.overall - b.overall);
    const striker = pool.players.find((p) => p.primaryPosition === 'ST' && !taken.has(p.id))!;
    const oldKeeper = view.round!.rosters[me]!.GK!;
    expect((await host.post(`/api/games/${code}/transfers`, { slotKey: 'GK', playerId: striker.id })).status).toBe(400);
    expect((await host.post(`/api/games/${code}/transfers`, { slotKey: 'GK', playerId: [...taken][0] })).status).toBe(409);
    const tooDear = freeKeepers.find((p) => playerValue(p.overall) - playerValue(ovr(oldKeeper)) > view.round!.budgetLeft[me]!);
    if (tooDear) {
      const res = await host.post<{ error: { code: string } }>(`/api/games/${code}/transfers`, { slotKey: 'GK', playerId: tooDear.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('budget');
    }

    // Sell the keeper for the cheapest free one: the difference goes into the budget.
    const cheap = freeKeepers[0]!;
    expect((await host.post(`/api/games/${code}/transfers`, { slotKey: 'GK', playerId: cheap.id })).status).toBe(201);
    const mid = (await snap(host, code)).round!;
    expect(mid.budgetLeft[me]).toBe(windowBudget('mini', myPoints) + playerValue(ovr(oldKeeper)) - playerValue(cheap.overall));
    // Then the best keeper that budget buys.
    const keeper = [...freeKeepers].reverse().find((p) => p.id !== cheap.id && playerValue(p.overall) <= mid.budgetLeft[me]! + playerValue(cheap.overall))!;
    expect((await host.post(`/api/games/${code}/transfers`, { slotKey: 'GK', playerId: keeper.id })).status).toBe(201);
    const third = freeKeepers.find((p) => p.id !== keeper.id && p.id !== cheap.id)!;
    expect((await host.post(`/api/games/${code}/transfers`, { slotKey: 'GK', playerId: third.id })).status).toBe(409);
    const round = (await snap(host, code)).round!;
    expect(round.rosters[me]!.GK).toBe(keeper.id);
    expect(round.transfersUsed[me]).toBe(2);
    expect(round.budgetLeft[me]).toBeGreaterThanOrEqual(0);
    // Bots wait: they only shop when the window closes, after the humans.
    const bots = view.participants.filter((p) => p.isBot).map((p) => p.id);
    expect(round.moves.filter((m) => m.kind === 'transfer' && bots.includes(m.participantId))).toHaveLength(0);

    // The only human says done: the window closes and the second half is played.
    expect((await host.post(`/api/games/${code}/window/ready`, { ready: true })).status).toBe(200);
    await waitFor(async () => (await snap(host, code)).round?.phase === 'big', 10_000);
    const full = (await host.get<SeasonView>(`/api/games/${code}/seasons/1`)).body;
    expect(full.fixtures).toHaveLength(380);
    expect(full.standings).toHaveLength(38);
    expect(full.championTeamId).toBe(full.standings[37]![0]!.teamId);
    const score = (v: SeasonView, md: number) => v.fixtures.filter((f) => f.matchday <= md).map((f) => [f.matchday, f.homeGoals, f.awayGoals]);
    expect(score(full, 19)).toEqual(score(before, 19));
    expect(full.teams.find((t) => t.participantId === me)!.lineup.find((s) => s.slotKey === 'GK')!.playerId).toBe(keeper.id);
    const after = await snap(host, code);
    expect(after.playback).toMatchObject({ seasonNumber: 1, matchday: 19, cap: 38 });
    expect(after.round).toMatchObject({ phase: 'big', seasonNumber: 1, transferLimit: 4 });
    const botMoves = after.round!.moves.filter((m) => m.kind === 'transfer' && m.windowKind === 'mini' && bots.includes(m.participantId));
    expect(botMoves.length).toBeGreaterThan(0);
    expect(botMoves.every((m) => m.inPlayerId !== keeper.id)).toBe(true);
    for (const b of bots) expect(botMoves.filter((m) => m.participantId === b).length).toBeLessThanOrEqual(2);
    expect((await host.get(`/api/games/${code}/results`)).status).toBe(200);
  });

  it('plays season 2 after the big window, and the round ends after it', async () => {
    const other = await registeredClient(server.app);
    expect((await other.post(`/api/games/${code}/window/close`)).status).toBe(403);
    expect((await host.post(`/api/games/${code}/window/close`)).status).toBe(200);
    let view = await snap(host, code);
    expect(view.round).toMatchObject({ phase: 'mini', seasonNumber: 2 });
    expect(view.playback).toMatchObject({ seasonNumber: 2, matchday: 0, cap: 19 });
    const first = (await host.get<SeasonView>(`/api/games/${code}/seasons/1`)).body;
    expect((await host.post(`/api/games/${code}/window/close`)).status).toBe(200);
    view = await snap(host, code);
    expect(view.round?.phase).toBe('over');
    expect(view.seasons.map((s) => s.matchdays)).toEqual([38, 38]);
    const second = (await host.get<SeasonView>(`/api/games/${code}/seasons/2`)).body;
    expect(second.seed).not.toBe(first.seed);
    expect(second.fixtures).toHaveLength(380);
    const list = await host.get<{ seasons: unknown[]; titles: TitlesRow[] }>(`/api/games/${code}/seasons`);
    expect(list.body.titles.reduce((n, r) => n + r.titles, 0)).toBe(2);
    expect((await host.post(`/api/games/${code}/window/close`)).status).toBe(409);
    expect((await host.post(`/api/games/${code}/trades`, { toParticipantId: 1, offerPlayerId: 1, requestPlayerId: 2 })).status).toBe(409);
  });

  it('runs Expected Strength (Monte Carlo)', async () => {
    const res = await host.get<MonteCarloView>(`/api/games/${code}/montecarlo?runs=50`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(20);
    expect(res.body.rows.reduce((n, r) => n + r.titleChance, 0)).toBeCloseTo(1, 5);
    expect(res.body.goalsPerMatch).toBeGreaterThan(2);
  });
});
