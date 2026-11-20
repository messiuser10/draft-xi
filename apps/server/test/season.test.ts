import type { GameSnapshot, LeagueView, MonteCarloView, PlaybackState, SeasonView, TitlesRow } from '@draft-xi/server/contracts';
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

  it('only the host starts the season, which stores 380 fixtures and 38 tables', async () => {
    const other = await registeredClient(server.app);
    expect((await other.post(`/api/games/${code}/season`)).status).toBe(403);
    const res = await host.post<{ season: { number: number } }>(`/api/games/${code}/season`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await host.post(`/api/games/${code}/season`)).status).toBe(409);

    const view = await snap(host, code);
    expect(view.game.status).toBe('completed');
    expect(view.seasons).toHaveLength(1);
    expect(view.playback).toMatchObject({ seasonNumber: 1, matchday: 0, playing: true });

    const season = (await host.get<SeasonView>(`/api/games/${code}/seasons/1`)).body;
    expect(season.teams).toHaveLength(20);
    expect(season.fixtures).toHaveLength(380);
    expect(season.standings).toHaveLength(38);
    for (const team of season.teams) {
      const home = season.fixtures.filter((f) => f.homeTeamId === team.id).length;
      const away = season.fixtures.filter((f) => f.awayTeamId === team.id).length;
      expect([home, away]).toEqual([19, 19]);
    }
    const final = season.standings[37]!;
    for (const row of final) expect(row.points).toBe(3 * row.won + row.drawn);
    expect(final.reduce((n, r) => n + r.goalsFor, 0)).toBe(final.reduce((n, r) => n + r.goalsAgainst, 0));
    expect(season.championTeamId).toBe(final[0]!.teamId);
    const goals = season.fixtures.reduce((n, f) => n + f.homeGoals + f.awayGoals, 0);
    expect(season.fixtures.reduce((n, f) => n + f.events.filter((e) => e.type === 'goal').length, 0)).toBe(goals);

    // Drafted players never play for their real club's AI side.
    const drafted = new Set(season.teams.filter((t) => t.kind === 'human').flatMap((t) => t.lineup.map((s) => s.playerId)));
    for (const ai of season.teams.filter((t) => t.kind === 'ai')) {
      expect(ai.lineup).toHaveLength(11);
      for (const s of ai.lineup) if (s.playerId !== null) expect(drafted.has(s.playerId)).toBe(false);
    }
    expect((await host.get<LeagueView>(`/api/games/${code}/league`)).body.source).toBe('season');
  });

  it('host controls synchronized playback', async () => {
    const other = await registeredClient(server.app);
    expect((await other.post(`/api/games/${code}/playback`, { action: 'pause' })).status).toBe(403);
    const paused = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'pause' });
    expect(paused.body.playback.playing).toBe(false);
    const jumped = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'jump', matchday: 20 });
    expect(jumped.body.playback.matchday).toBe(20);
    const fast = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'speed', speed: 5 });
    expect(fast.body.playback).toMatchObject({ speed: 5, matchday: 20 });
    const end = await host.post<{ playback: PlaybackState }>(`/api/games/${code}/playback`, { action: 'end' });
    expect(end.body.playback.matchday).toBe(38);
  });

  it('runs it back and multi-season with a titles table, all kept in history', async () => {
    const first = (await host.get<SeasonView>(`/api/games/${code}/seasons/1`)).body;
    const res = await host.post<{ seasons: { number: number; seed: number }[] }>(`/api/games/${code}/seasons`, { count: 3 });
    expect(res.status).toBe(201);
    expect(res.body.seasons.map((s) => s.number)).toEqual([2, 3, 4]);
    const second = (await host.get<SeasonView>(`/api/games/${code}/seasons/2`)).body;
    expect(second.seed).not.toBe(first.seed);
    expect(second.fixtures.map((f) => [f.homeGoals, f.awayGoals])).not.toEqual(first.fixtures.map((f) => [f.homeGoals, f.awayGoals]));
    const list = await host.get<{ seasons: unknown[]; titles: TitlesRow[] }>(`/api/games/${code}/seasons`);
    expect(list.body.seasons).toHaveLength(4);
    expect(list.body.titles.reduce((n, r) => n + r.titles, 0)).toBe(4);
    expect(list.body.titles).toHaveLength(20);
    expect((await snap(host, code)).playback?.seasonNumber).toBe(4);
  });

  it('runs Expected Strength (Monte Carlo)', async () => {
    const res = await host.get<MonteCarloView>(`/api/games/${code}/montecarlo?runs=50`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(20);
    expect(res.body.rows.reduce((n, r) => n + r.titleChance, 0)).toBeCloseTo(1, 5);
    expect(res.body.goalsPerMatch).toBeGreaterThan(2);
  });
});
