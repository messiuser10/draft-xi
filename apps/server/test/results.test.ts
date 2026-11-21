import type {
  GameSnapshot,
  HallOfFameEntry,
  LeaderboardRow,
  ProfileView,
  RecordBookView,
  ResultsView,
  SeriesLeaderboardView,
  TeamPageView,
} from '@draft-xi/server/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIALECTS } from './helpers/db';
import { type Client, playRound, registeredClient, startTestServer, team, type TestServer, waitFor } from './helpers/server';

type Created = { game: { code: string; id: number } };

describe.each(DIALECTS)('results and history on %s', (_name, open) => {
  let server: TestServer;
  let host: Client;
  let rival: Client;
  let code: string;
  const snap = async (c: Client, gameCode: string) => (await c.get<GameSnapshot>(`/api/games/${gameCode}`)).body;

  beforeAll(async () => {
    server = await startTestServer(open);
    host = await registeredClient(server.app);
    rival = await registeredClient(server.app);
    const res = await host.post<Created>('/api/games', { name: 'Results Test', settings: { pickTimerSeconds: null }, team: team('Hosts FC') });
    code = res.body.game.code;
    await rival.post(`/api/games/${code}/join`, team('Rivals United'));
    await host.post(`/api/games/${code}/bots`, { level: 'medium' });
    await host.post(`/api/games/${code}/start`, { force: true });
    await waitFor(async () => (await snap(host, code)).game.status === 'drafting');
    await host.post(`/api/games/${code}/draft/end`);
    await waitFor(async () => (await snap(host, code)).game.status === 'draft_complete', 10_000);
    await playRound(host, code);
  });
  afterAll(async () => server.close());

  it('gives awards, draft grades, pick tags and head to head', async () => {
    const res = await rival.get<ResultsView>(`/api/games/${code}/results`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body;
    expect(r.finalTable).toHaveLength(20);
    expect(r.awards?.championTeamId).toBe(r.finalTable[0]!.teamId);
    expect(r.awards?.goldenBoot?.goals).toBeGreaterThan(0);
    expect(r.awards?.goldenGlove).not.toBeNull();
    expect(r.awards?.teamOfTheSeason?.slots).toHaveLength(11);
    expect(r.grades).toHaveLength(3);
    for (const g of r.grades) expect(g.grade).toMatch(/^[A-DF][+-]?$/);
    expect(r.picks).toHaveLength(33);
    for (const p of r.picks) expect(['Steal', 'Fair', 'Reach']).toContain(p.tag);
    // 3 humans: 3 pairs, each played twice.
    expect(r.headToHead).toHaveLength(3);
    for (const h of r.headToHead) {
      expect(h.fixtures).toHaveLength(2);
      expect(h.aWins + h.draws + h.bWins).toBe(2);
    }
    expect(r.summary).toContain('Results Test');
    expect(r.summary).toContain('Hosts FC');
  });

  it('serves team pages with splits and timeline', async () => {
    const r = (await host.get<ResultsView>(`/api/games/${code}/results`)).body;
    const human = r.teams.find((t) => t.kind === 'human')!;
    const page = (await host.get<TeamPageView>(`/api/games/${code}/teams/${human.id}`)).body;
    expect(page.timeline).toHaveLength(38);
    expect(page.home.played + page.away.played).toBe(38);
    expect(page.home.played).toBe(19);
    expect(page.players).toHaveLength(11);
    expect(page.home.points + page.away.points).toBe(page.finalRow!.points);
    expect(page.longestUnbeaten).toBeGreaterThanOrEqual(0);
    expect((await host.get(`/api/games/${code}/teams/999999`)).status).toBe(404);
  });

  it('exports JSON and CSV for the host only', async () => {
    expect((await rival.get(`/api/games/${code}/export?format=json`)).status).toBe(403);
    const json = await host.get<{ seasons: unknown[] }>(`/api/games/${code}/export?format=json`);
    expect(json.status).toBe(200);
    expect(json.body.seasons).toHaveLength(2);
    const csv = await server.app.inject({ method: 'GET', url: `/api/games/${code}/export?format=csv`, headers: { cookie: host.cookie } });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.trim().split('\n')).toHaveLength(41);
  });

  it('builds profiles, Hall of Fame, leaderboard and record book', async () => {
    const me = (await host.get<ProfileView>('/api/profile')).body;
    expect(me.gamesPlayed).toBe(1);
    expect(me.seasonsPlayed).toBe(2);
    expect(me.avgFinish).toBeGreaterThanOrEqual(1);
    expect(me.bestGrade).not.toBeNull();
    expect(me.games[0]?.finish).toBeGreaterThanOrEqual(1);
    // Rivalries: host and rival met twice a season, over two seasons.
    expect(me.rivals).toHaveLength(1);
    expect(me.rivals[0]!.played).toBe(4);
    expect(me.rivals[0]!.won + me.rivals[0]!.drawn + me.rivals[0]!.lost).toBe(4);
    const theirs = (await rival.get<ProfileView>('/api/profile')).body.rivals[0]!;
    expect(theirs.won).toBe(me.rivals[0]!.lost);
    expect(theirs.userId).not.toBe(me.rivals[0]!.userId);
    const fame = (await host.get<{ entries: HallOfFameEntry[] }>('/api/hall-of-fame')).body.entries;
    expect(fame).toHaveLength(1);
    expect(fame[0]!.gameCode).toBe(code);
    const board = (await host.get<{ rows: LeaderboardRow[] }>('/api/leaderboard')).body.rows;
    expect(board).toHaveLength(2);
    const records = (await host.get<RecordBookView>('/api/records')).body;
    expect(records.mostPoints?.value).toBeGreaterThan(50);
    expect(records.mostGoalsByDrafted?.value).toBeGreaterThan(0);
    expect(records.bestGoalDifference?.value).toBeGreaterThan(0);
  });

  it('awards one game leaderboard point for the round, and Play again keeps the series', async () => {
    const board = (await host.get<SeriesLeaderboardView>(`/api/games/${code}/leaderboard`)).body;
    expect(board.rounds).toEqual([expect.objectContaining({ roundNumber: 1, complete: true })]);
    expect(board.rows).toHaveLength(3);
    expect(board.rows.reduce((n, r) => n + r.points, 0)).toBeGreaterThanOrEqual(1);
    expect(board.rows[0]!.points).toBe(1);
    expect(board.rows[0]!.leaguePoints).toBe(Math.max(...board.rows.map((r) => r.leaguePoints)));

    expect((await rival.post(`/api/games/${code}/rematch`)).status).toBe(403);
    const res = await host.post<Created>(`/api/games/${code}/rematch`, { mode: 'next' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Asking again returns the same next round.
    expect((await host.post<Created>(`/api/games/${code}/rematch`, { mode: 'next' })).body.game.code).toBe(res.body.game.code);
    const fresh = await snap(host, res.body.game.code);
    expect(fresh.game.status).toBe('lobby');
    expect(fresh.participants.map((p) => p.teamName).sort()).toEqual((await snap(host, code)).participants.map((p) => p.teamName).sort());
    expect((await snap(host, code)).round?.nextCode).toBe(res.body.game.code);
    const nextBoard = (await host.get<SeriesLeaderboardView>(`/api/games/${res.body.game.code}/leaderboard`)).body;
    expect(nextBoard.roundNumber).toBe(2);
    expect(nextBoard.seriesId).toBe(board.seriesId);
    expect(nextBoard.rows.reduce((n, r) => n + r.points, 0)).toBe(board.rows.reduce((n, r) => n + r.points, 0));
  });

  it('Restart starts a new series with an empty leaderboard', async () => {
    const second = await host.post<Created>('/api/games', { name: 'Restart Test', settings: { pickTimerSeconds: null }, team: team('Restart FC') });
    const c = second.body.game.code;
    await host.post(`/api/games/${c}/bots`, { level: 'easy' });
    await host.post(`/api/games/${c}/start`, { force: true });
    await waitFor(async () => (await snap(host, c)).game.status === 'drafting');
    await host.post(`/api/games/${c}/draft/end`);
    await waitFor(async () => (await snap(host, c)).game.status === 'draft_complete', 10_000);
    expect((await host.post(`/api/games/${c}/rematch`, { mode: 'restart' })).status).toBe(409);
    await playRound(host, c);
    const res = await host.post<Created>(`/api/games/${c}/rematch`, { mode: 'restart' });
    expect(res.status).toBe(201);
    const board = (await host.get<SeriesLeaderboardView>(`/api/games/${res.body.game.code}/leaderboard`)).body;
    expect(board.roundNumber).toBe(1);
    expect(board.rounds).toHaveLength(1);
    expect(board.rows.every((r) => r.points === 0)).toBe(true);
  });
});
