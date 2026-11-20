/**
 * Seasons (spec sections 9 and 10): builds the 20 teams from the draft, runs the engine once,
 * stores everything (teams, 380 fixtures, events, a table per matchday, player stats) and
 * serves it back for playback. Also Run It Back, multi-season, Monte Carlo and playback state.
 */
import { randomInt } from 'node:crypto';
import {
  aiTeamId,
  buildLeagueTeams,
  type HumanTeamInput,
  type LineupEntry,
  monteCarlo,
  rateTeams,
  resolveParams,
  type SeasonTeamInput,
  type SimParams,
  simulateSeason,
} from '@draft-xi/engine';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { actorOf, type AuthUser, requireUser } from '../auth/service';
import { SYSTEM_ACTOR, writeAudit } from '../audit';
import {
  type FixtureView,
  type KeyMomentView,
  type LeagueTeamView,
  type LeagueView,
  type LineupSlotView,
  type MonteCarloView,
  type PlaybackState,
  playbackMatchday,
  type playbackSchema,
  SEASON_MATCHDAYS,
  type SeasonListItem,
  type SeasonView,
  type StandingView,
  type TitlesRow,
} from '../contracts';
import type { Database } from '../db/database';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { getSetting } from '../settings/app-settings';
import type { DraftService } from './draft';
import { loadPool, type Pool } from './pool';
import type { GameHub } from './service';
import { byPickOrder, formationOf, type GameRow, type ParticipantRow, settingsOf, toGameView } from './views';
import type { z } from 'zod';

type SeasonTeamRow = Database['t']['seasonTeams']['$inferSelect'];

/** Stored in `season_teams.lineup`. */
interface StoredLineup {
  slots: LineupSlotView[];
}

interface TeamMeta {
  kind: 'human' | 'ai';
  participantId: number | null;
  clubId: number | null;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  monogram: string;
}

const CHUNK = 200;

function chunks<T>(rows: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function toSlotView(e: LineupEntry): LineupSlotView {
  return {
    slotKey: e.slotKey,
    slotType: e.slotType,
    x: e.x,
    y: e.y,
    playerId: e.player.id,
    name: e.player.name,
    overall: e.player.overall,
    effectiveOverall: e.effectiveOverall,
    clubId: e.player.clubId,
    nationality: e.player.nationality,
    outOfPosition: e.outOfPosition,
    reserve: e.reserve,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class SeasonService {
  private readonly monteCarloCache = new Map<string, MonteCarloView>();

  constructor(
    private readonly database: Database,
    private hub: GameHub,
    private readonly draft: DraftService,
  ) {
    draft.onDraftComplete = async (gameId) => {
      const game = await this.getById(gameId);
      if (game.status === 'draft_complete') await this.startFirst(game, null);
    };
  }

  setHub(hub: GameHub): void {
    this.hub = hub;
  }

  // ---------- Starting seasons ----------

  /** Host presses Start Season after the draft. */
  async start(code: string, userIn: AuthUser | null): Promise<SeasonListItem> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status !== 'draft_complete') throw conflict('not_ready', 'The season starts once the draft is complete');
    return this.startFirst(game, user);
  }

  private async startFirst(game: GameRow, user: AuthUser | null): Promise<SeasonListItem> {
    this.draft.cancelAutoStart(game.id);
    const { db, t } = this.database;
    // Claim the start, so a double click (or the auto-start racing the host) runs it once.
    const [claimed] = await db
      .update(t.games)
      .set({ status: 'simulating' })
      .where(and(eq(t.games.id, game.id), eq(t.games.status, 'draft_complete')))
      .returning();
    if (!claimed) throw conflict('not_ready', 'The season has already started');
    this.hub.emit(game.id, { type: 'game:updated', game: toGameView(claimed) });
    try {
      const season = await this.simulateAndStore(claimed, 1, claimed.seed ?? randomInt(1, 2 ** 31), user);
      await this.finishRun(claimed, 1);
      return season;
    } catch (err) {
      const [reverted] = await db.update(t.games).set({ status: 'draft_complete' }).where(eq(t.games.id, game.id)).returning();
      if (reverted) this.hub.emit(game.id, { type: 'game:updated', game: toGameView(reverted) });
      throw err;
    }
  }

  /** Run It Back (count 1) or Multi-season (2 to 10): same teams, new seeds, kept in history. */
  async runMore(code: string, userIn: AuthUser | null, count: number): Promise<SeasonListItem[]> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status !== 'completed') throw conflict('not_ready', 'Finish the first season before running more');
    const { db, t } = this.database;
    const [claimed] = await db
      .update(t.games)
      .set({ status: 'simulating' })
      .where(and(eq(t.games.id, game.id), eq(t.games.status, 'completed')))
      .returning();
    if (!claimed) throw conflict('busy', 'A season is already being simulated');
    this.hub.emit(game.id, { type: 'game:updated', game: toGameView(claimed) });
    const created: SeasonListItem[] = [];
    try {
      const [last] = await db
        .select({ n: t.seasons.seasonNumber })
        .from(t.seasons)
        .where(eq(t.seasons.gameId, game.id))
        .orderBy(desc(t.seasons.seasonNumber))
        .limit(1);
      const start = (last?.n ?? 0) + 1;
      for (let i = 0; i < count; i++) {
        created.push(await this.simulateAndStore(claimed, start + i, randomInt(1, 2 ** 31), user));
      }
    } finally {
      await this.finishRun(claimed, created.at(-1)?.number ?? null);
    }
    return created;
  }

  private async finishRun(game: GameRow, showSeason: number | null): Promise<void> {
    const { db, t } = this.database;
    const prev = (game.playbackState as PlaybackState | null) ?? null;
    const playback: PlaybackState | null =
      showSeason === null
        ? prev
        : { seasonNumber: showSeason, matchday: 0, playing: true, speed: prev?.speed ?? 1, anchorAt: new Date().toISOString() };
    const [done] = await db
      .update(t.games)
      .set({ status: 'completed', playbackState: playback })
      .where(eq(t.games.id, game.id))
      .returning();
    if (done) this.hub.emit(game.id, { type: 'game:updated', game: toGameView(done) });
    this.hub.resync(game.id);
  }

  private async simulateAndStore(game: GameRow, seasonNumber: number, seed: number, user: AuthUser | null): Promise<SeasonListItem> {
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const picks = await this.draft.picksOf(db, game.id);
    const pool = await loadPool(this.database);
    const params = resolveParams(await getSetting(this.database, 'simulation.parameters'));
    const { inputs, meta } = await this.buildTeams(game, parts, picks, pool, params);
    const result = simulateSeason(inputs, { seed, params });
    const teamsById = new Map(result.teams.map((x) => [x.id, x]));

    const season = await this.database.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.seasons)
        .values({ gameId: game.id, seasonNumber, seed: result.seed, status: 'completed', parametersSnapshot: { ...params } })
        .returning();
      if (!row) throw new Error('Insert returned no season');

      const teamRowIds = new Map<string, number>();
      for (const input of inputs) {
        const m = meta.get(input.id)!;
        const rated = teamsById.get(input.id)!;
        const lineup: StoredLineup = { slots: rated.lineup.map(toSlotView) };
        const [teamRow] = await tx
          .insert(t.seasonTeams)
          .values({
            seasonId: row.id,
            kind: m.kind,
            participantId: m.participantId,
            clubId: m.clubId,
            name: m.name,
            primaryColor: m.primaryColor,
            secondaryColor: m.secondaryColor,
            lineup: { ...lineup },
            formation: rated.formation,
            attackRating: rated.rating.attack,
            defenseRating: rated.rating.defense,
            chemistryBonus: rated.rating.chemistry,
          })
          .returning({ id: t.seasonTeams.id });
        teamRowIds.set(input.id, teamRow!.id);
      }
      const tid = (id: string) => teamRowIds.get(id)!;

      const events: { fixtureId: number; minute: number; type: 'goal' | 'assist' | 'yellow' | 'red'; playerId: number | null; seasonTeamId: number }[] = [];
      for (let md = 1; md <= SEASON_MATCHDAYS; md++) {
        const day = result.fixtures.filter((f) => f.matchday === md);
        if (day.length === 0) continue;
        const inserted = await tx
          .insert(t.fixtures)
          .values(day.map((f) => ({ seasonId: row.id, matchday: md, homeTeamId: tid(f.homeTeamId), awayTeamId: tid(f.awayTeamId), homeGoals: f.homeGoals, awayGoals: f.awayGoals })))
          .returning({ id: t.fixtures.id, home: t.fixtures.homeTeamId, away: t.fixtures.awayTeamId });
        for (const f of day) {
          const fx = inserted.find((x) => x.home === tid(f.homeTeamId) && x.away === tid(f.awayTeamId))!;
          for (const e of f.events) {
            events.push({ fixtureId: fx.id, minute: e.minute, type: e.type, playerId: e.playerId, seasonTeamId: tid(e.teamId) });
          }
        }
      }
      for (const batch of chunks(events)) await tx.insert(t.matchEvents).values(batch);

      const standingRows = result.standings.flatMap((table, i) =>
        table.map((s) => ({
          seasonId: row.id,
          matchday: i + 1,
          seasonTeamId: tid(s.teamId),
          played: s.played,
          won: s.won,
          drawn: s.drawn,
          lost: s.lost,
          goalsFor: s.goalsFor,
          goalsAgainst: s.goalsAgainst,
          goalDifference: s.goalDifference,
          points: s.points,
          position: s.position,
          form: s.form,
        })),
      );
      for (const batch of chunks(standingRows)) await tx.insert(t.standingRows).values(batch);

      const stats = result.playerStats.flatMap((s) =>
        s.playerId === null
          ? []
          : [
              {
                seasonId: row.id,
                playerId: s.playerId,
                seasonTeamId: tid(s.teamId),
                appearances: s.appearances,
                goals: s.goals,
                assists: s.assists,
                cleanSheets: s.cleanSheets,
                yellows: s.yellows,
                reds: s.reds,
                ratingSum: s.ratingSum,
                avgRating: s.avgRating,
              },
            ],
      );
      for (const batch of chunks(stats)) await tx.insert(t.playerSeasonStats).values(batch);

      const championId = tid(result.championTeamId);
      await tx.update(t.seasons).set({ championSeasonTeamId: championId }).where(eq(t.seasons.id, row.id));
      await writeAudit(tx, t, {
        actor: user ? actorOf(user) : SYSTEM_ACTOR,
        action: 'season.simulate',
        target: `game:${game.joinCode}`,
        gameId: game.id,
        details: { seasonNumber, seed: result.seed },
      });
      const champ = meta.get(result.championTeamId)!;
      return {
        number: seasonNumber,
        seed: result.seed,
        championTeamId: championId,
        championName: champ.name,
        championIsHuman: champ.kind === 'human',
        createdAt: row.createdAt.toISOString(),
      } satisfies SeasonListItem;
    });
    return season;
  }

  /** The 20 season teams: one per drafting team plus the AI clubs chosen at the start. */
  private async buildTeams(
    game: GameRow,
    parts: readonly ParticipantRow[],
    picks: readonly { participantId: number; playerId: number; slotKey: string }[],
    pool: Pool,
    params: SimParams,
  ): Promise<{ inputs: SeasonTeamInput[]; meta: Map<string, TeamMeta> }> {
    const settings = settingsOf(game);
    const formations = await getSetting(this.database, 'formations.enabled');
    const compatibility = await getSetting(this.database, 'positions.compatibility');
    // Drafted players stay in their team even if an admin later deactivates them.
    const drafted = new Set(picks.map((p) => p.playerId));
    const missing = [...drafted].filter((id) => !pool.players.some((p) => p.id === id));
    const players = [...pool.players];
    if (missing.length > 0) {
      const { db, t } = this.database;
      const rows = await db.select().from(t.players).where(inArray(t.players.id, missing));
      for (const p of rows) {
        players.push({ id: p.id, clubId: p.clubId, name: p.displayName, primaryPosition: p.primaryPosition, altPositions: p.altPositions, overall: p.overall, nationality: p.nationality });
      }
    }

    const ordered = byPickOrder(parts);
    const humans: HumanTeamInput[] = ordered.map((p) => ({
      id: `p${p.id}`,
      name: p.teamName ?? 'Team',
      formation: formationOf(p) ?? '4-3-3',
      picks: picks.filter((k) => k.participantId === p.id).map((k) => ({ slotKey: k.slotKey, playerId: k.playerId })),
    }));
    const aiClubIds = game.aiClubIds ?? [];
    const inputs = buildLeagueTeams({
      clubs: pool.engineClubs,
      players,
      humans,
      aiClubIds,
      removeDraftedFromAi: settings.removeDraftedFromAi,
      lineup: {
        formations,
        compatibility,
        outOfPositionPenalty: params.outOfPositionPenalty,
        reserveRating: params.reserveRating,
        strict: false,
      },
    });
    const meta = new Map<string, TeamMeta>();
    for (const p of ordered) {
      meta.set(`p${p.id}`, {
        kind: 'human',
        participantId: p.id,
        clubId: null,
        name: p.teamName ?? 'Team',
        primaryColor: p.color ?? '#22C55E',
        secondaryColor: '#FFFFFF',
        monogram: p.monogram ?? 'XI',
      });
    }
    for (const id of aiClubIds) {
      const club = pool.clubs.find((c) => c.id === id);
      meta.set(aiTeamId(id), {
        kind: 'ai',
        participantId: null,
        clubId: id,
        name: club?.name ?? `Club ${id}`,
        primaryColor: club?.primaryColor ?? '#64748B',
        secondaryColor: club?.secondaryColor ?? '#FFFFFF',
        monogram: club?.shortName ?? 'AI',
      });
    }
    return { inputs, meta };
  }

  /** The 20 season inputs for a game as it stands (Simulation Lab). */
  async teamsForGame(code: string): Promise<{ inputs: SeasonTeamInput[]; names: Map<string, string>; seed: number | null }> {
    const game = await this.getByCode(code);
    if (game.strengthSnapshot === null) throw conflict('not_started', 'That game has not started its draft');
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const picks = await this.draft.picksOf(db, game.id);
    const pool = await loadPool(this.database);
    const params = resolveParams(await getSetting(this.database, 'simulation.parameters'));
    const { inputs, meta } = await this.buildTeams(game, parts, picks, pool, params);
    return { inputs, names: new Map([...meta].map(([id, m]) => [id, m.name])), seed: game.seed };
  }

  /** Drops cached Expected Strength for a game (after a reset or re-run). */
  forget(gameId: number): void {
    for (const key of this.monteCarloCache.keys()) if (key.startsWith(`${gameId}:`)) this.monteCarloCache.delete(key);
  }

  // ---------- Reads ----------

  async list(gameId: number): Promise<SeasonListItem[]> {
    const { db, t } = this.database;
    const rows = await db
      .select({ s: t.seasons, champ: t.seasonTeams })
      .from(t.seasons)
      .leftJoin(t.seasonTeams, eq(t.seasons.championSeasonTeamId, t.seasonTeams.id))
      .where(eq(t.seasons.gameId, gameId))
      .orderBy(asc(t.seasons.seasonNumber));
    return rows.map(({ s, champ }) => ({
      number: s.seasonNumber,
      seed: s.seed,
      championTeamId: s.championSeasonTeamId,
      championName: champ?.name ?? null,
      championIsHuman: champ?.kind === 'human',
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async snapshotExtras(game: GameRow): Promise<{ seasons: SeasonListItem[]; playback: PlaybackState | null }> {
    if (game.status !== 'simulating' && game.status !== 'completed') return { seasons: [], playback: null };
    return { seasons: await this.list(game.id), playback: (game.playbackState as PlaybackState | null) ?? null };
  }

  async season(code: string, seasonNumber: number): Promise<SeasonView> {
    const game = await this.getByCode(code);
    const { db, t } = this.database;
    const [season] = await db
      .select()
      .from(t.seasons)
      .where(and(eq(t.seasons.gameId, game.id), eq(t.seasons.seasonNumber, seasonNumber)))
      .limit(1);
    if (!season) throw notFound('That season has not been played');
    const teamRows = await db.select().from(t.seasonTeams).where(eq(t.seasonTeams.seasonId, season.id)).orderBy(asc(t.seasonTeams.id));
    const pool = await loadPool(this.database);
    const teams = this.rankTeams(teamRows.map((r) => this.teamView(r, pool)));
    const names = new Map<number, string>();
    for (const team of teams) for (const s of team.lineup) if (s.playerId !== null) names.set(s.playerId, s.name);

    const fixtureRows = await db.select().from(t.fixtures).where(eq(t.fixtures.seasonId, season.id)).orderBy(asc(t.fixtures.matchday), asc(t.fixtures.id));
    const eventRows = await db
      .select({ e: t.matchEvents })
      .from(t.matchEvents)
      .innerJoin(t.fixtures, eq(t.matchEvents.fixtureId, t.fixtures.id))
      .where(eq(t.fixtures.seasonId, season.id))
      .orderBy(asc(t.matchEvents.id));
    const eventsByFixture = new Map<number, FixtureView['events']>();
    for (const { e } of eventRows) {
      const list = eventsByFixture.get(e.fixtureId) ?? [];
      list.push({
        minute: e.minute,
        type: e.type,
        teamId: String(e.seasonTeamId),
        playerId: e.playerId,
        playerName: e.playerId === null ? 'Reserve' : (names.get(e.playerId) ?? 'Player'),
      });
      eventsByFixture.set(e.fixtureId, list);
    }
    const fixtures: FixtureView[] = fixtureRows.map((f) => ({
      id: f.id,
      matchday: f.matchday,
      homeTeamId: String(f.homeTeamId),
      awayTeamId: String(f.awayTeamId),
      homeGoals: f.homeGoals ?? 0,
      awayGoals: f.awayGoals ?? 0,
      events: (eventsByFixture.get(f.id) ?? []).sort((a, b) => a.minute - b.minute),
    }));

    const standingRows = await db
      .select()
      .from(t.standingRows)
      .where(eq(t.standingRows.seasonId, season.id))
      .orderBy(asc(t.standingRows.matchday), asc(t.standingRows.position));
    const standings: StandingView[][] = [];
    for (const r of standingRows) {
      (standings[r.matchday - 1] ??= []).push({
        teamId: String(r.seasonTeamId),
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        goalDifference: r.goalDifference,
        points: r.points,
        position: r.position,
        form: r.form,
      });
    }

    const statRows = await db.select().from(t.playerSeasonStats).where(eq(t.playerSeasonStats.seasonId, season.id));
    const playerStats = statRows.map((s) => ({
      playerId: s.playerId,
      teamId: String(s.seasonTeamId),
      name: names.get(s.playerId) ?? 'Player',
      appearances: s.appearances,
      goals: s.goals,
      assists: s.assists,
      cleanSheets: s.cleanSheets,
      avgRating: s.avgRating,
    }));

    return {
      number: season.seasonNumber,
      seed: season.seed,
      championTeamId: season.championSeasonTeamId === null ? null : String(season.championSeasonTeamId),
      teams,
      fixtures,
      standings,
      keyMoments: keyMoments(fixtures, standings, teams),
      playerStats,
    };
  }

  /** League Teams page: from the latest season once one exists, else from the current picks. */
  async league(code: string): Promise<LeagueView> {
    const game = await this.getByCode(code);
    if (game.status === 'lobby' || game.strengthSnapshot === null) {
      throw conflict('not_started', 'The league is set when the draft starts');
    }
    const { db, t } = this.database;
    const pool = await loadPool(this.database);
    const [latest] = await db.select().from(t.seasons).where(eq(t.seasons.gameId, game.id)).orderBy(desc(t.seasons.seasonNumber)).limit(1);
    if (latest) {
      const rows = await db.select().from(t.seasonTeams).where(eq(t.seasonTeams.seasonId, latest.id));
      return { source: 'season', teams: this.rankTeams(rows.map((r) => this.teamView(r, pool))) };
    }
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const picks = await this.draft.picksOf(db, game.id);
    const params = resolveParams(await getSetting(this.database, 'simulation.parameters'));
    const { inputs, meta } = await this.buildTeams(game, parts, picks, pool, params);
    const rated = rateTeams(inputs, params);
    const teams = rated.map((r): LeagueTeamView => {
      const m = meta.get(r.id)!;
      return {
        id: r.id,
        ...m,
        formation: r.formation,
        attack: r.rating.attack,
        defense: r.rating.defense,
        chemistry: r.rating.chemistry,
        overall: r.rating.overall,
        strength: r.rating.strength,
        rank: 0,
        lineup: r.lineup.map(toSlotView),
      };
    });
    return { source: 'draft', teams: this.rankTeams(teams) };
  }

  async titles(code: string): Promise<TitlesRow[]> {
    const game = await this.getByCode(code);
    const { db, t } = this.database;
    const rows = await db
      .select({ r: t.standingRows, team: t.seasonTeams })
      .from(t.standingRows)
      .innerJoin(t.seasons, eq(t.standingRows.seasonId, t.seasons.id))
      .innerJoin(t.seasonTeams, eq(t.standingRows.seasonTeamId, t.seasonTeams.id))
      .where(and(eq(t.seasons.gameId, game.id), eq(t.standingRows.matchday, SEASON_MATCHDAYS)));
    const acc = new Map<string, { name: string; kind: 'human' | 'ai'; titles: number; pos: number; pts: number; n: number }>();
    for (const { r, team } of rows) {
      const key = team.kind === 'human' ? `p${team.participantId}` : `c${team.clubId}`;
      const a = acc.get(key) ?? { name: team.name, kind: team.kind, titles: 0, pos: 0, pts: 0, n: 0 };
      if (r.position === 1) a.titles++;
      a.pos += r.position;
      a.pts += r.points;
      a.n++;
      acc.set(key, a);
    }
    return [...acc.values()]
      .map((a) => ({ name: a.name, kind: a.kind, titles: a.titles, avgPosition: round2(a.pos / a.n), avgPoints: round2(a.pts / a.n) }))
      .sort((a, b) => b.titles - a.titles || a.avgPosition - b.avgPosition);
  }

  /** Expected Strength: 1,000 simulated seasons of the same 20 teams. Cached per game. */
  async monteCarlo(code: string, runs: number): Promise<MonteCarloView> {
    const game = await this.getByCode(code);
    if (game.status !== 'draft_complete' && game.status !== 'completed' && game.status !== 'simulating') {
      throw conflict('not_ready', 'Expected Strength is available once the draft is complete');
    }
    const key = `${game.id}:${runs}`;
    const cached = this.monteCarloCache.get(key);
    if (cached) return cached;
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const picks = await this.draft.picksOf(db, game.id);
    const pool = await loadPool(this.database);
    const params = resolveParams(await getSetting(this.database, 'simulation.parameters'));
    const { inputs, meta } = await this.buildTeams(game, parts, picks, pool, params);
    const result = monteCarlo(inputs, { seed: game.seed ?? 1, runs, params });
    const view: MonteCarloView = {
      runs: result.runs,
      rows: result.rows.map((r) => ({
        teamId: r.teamId,
        name: meta.get(r.teamId)?.name ?? r.teamId,
        kind: meta.get(r.teamId)?.kind ?? 'ai',
        avgPoints: r.avgPoints,
        avgPosition: r.avgPosition,
        titleChance: r.titleChance,
        top4Chance: r.top4Chance,
        bottom3Chance: r.bottom3Chance,
      })),
      goalsPerMatch: result.goalsPerMatch,
      homeWinRate: result.homeWinRate,
    };
    this.monteCarloCache.set(key, view);
    return view;
  }

  // ---------- Playback ----------

  /** Synchronized playback: the host drives `games.playback_state` and every screen follows. */
  async playback(code: string, userIn: AuthUser | null, input: z.infer<typeof playbackSchema>): Promise<PlaybackState> {
    const game = await this.getByCode(code);
    this.requireHost(game, userIn);
    if (game.status !== 'completed') throw conflict('not_ready', 'There is no season to play back yet');
    const now = Date.now();
    const prev = (game.playbackState as PlaybackState | null) ?? { seasonNumber: 1, matchday: 0, playing: false, speed: 1, anchorAt: new Date(now).toISOString() };
    const current = playbackMatchday(prev, now);
    let next: PlaybackState = { ...prev, matchday: current, anchorAt: new Date(now).toISOString() };
    if (input.seasonNumber !== undefined && input.seasonNumber !== prev.seasonNumber) {
      const seasons = await this.list(game.id);
      if (!seasons.some((s) => s.number === input.seasonNumber)) throw badRequest('no_season', 'That season has not been played');
      next = { ...next, seasonNumber: input.seasonNumber, matchday: 0 };
    }
    switch (input.action) {
      case 'play':
        next = { ...next, playing: true, matchday: next.matchday >= SEASON_MATCHDAYS ? 0 : next.matchday };
        break;
      case 'pause':
        next = { ...next, playing: false };
        break;
      case 'speed':
        if (input.speed === undefined) throw badRequest('speed', 'Choose a speed');
        next = { ...next, speed: input.speed };
        break;
      case 'jump':
        if (input.matchday === undefined) throw badRequest('matchday', 'Choose a matchday');
        next = { ...next, matchday: input.matchday };
        break;
      case 'end':
        next = { ...next, matchday: SEASON_MATCHDAYS, playing: false };
        break;
    }
    const { db, t } = this.database;
    await db.update(t.games).set({ playbackState: next }).where(eq(t.games.id, game.id));
    this.hub.emit(game.id, { type: 'playback:updated', playback: next });
    return next;
  }

  // ---------- Internals ----------

  private teamView(r: SeasonTeamRow, pool: Pool): LeagueTeamView {
    const lineup: LineupSlotView[] = (r.lineup as unknown as StoredLineup).slots ?? [];
    const overall = lineup.length > 0 ? round2(lineup.reduce((n, s) => n + s.effectiveOverall, 0) / lineup.length) : 0;
    const club = r.clubId === null ? undefined : pool.clubs.find((c) => c.id === r.clubId);
    return {
      id: String(r.id),
      kind: r.kind,
      participantId: r.participantId,
      clubId: r.clubId,
      name: r.name,
      primaryColor: r.primaryColor,
      secondaryColor: r.secondaryColor,
      monogram: club?.shortName ?? r.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase(),
      formation: r.formation,
      attack: r.attackRating,
      defense: r.defenseRating,
      chemistry: r.chemistryBonus,
      overall,
      strength: round2((r.attackRating + r.defenseRating) / 2),
      rank: 0,
      lineup,
    };
  }

  private rankTeams(teams: LeagueTeamView[]): LeagueTeamView[] {
    return [...teams]
      .sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name))
      .map((team, i) => ({ ...team, rank: i + 1 }));
  }

  private async getByCode(code: string): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.joinCode, code.toUpperCase())).limit(1);
    if (!game) throw notFound('No game with that code');
    return game;
  }

  private async getById(id: number): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, id)).limit(1);
    if (!game) throw notFound('Game not found');
    return game;
  }

  private requireHost(game: GameRow, userIn: AuthUser | null): AuthUser {
    const user = requireUser(userIn);
    if (game.hostUserId === user.id || user.role === 'admin') return user;
    throw forbidden('Only the host can do that');
  }
}

/**
 * Key Moments (spec section 10): hat-tricks, 4-goal margins, upsets (a side at least six
 * places lower beating a top-five team), new league leaders and human-versus-human games.
 */
export function keyMoments(fixtures: readonly FixtureView[], standings: readonly StandingView[][], teams: readonly LeagueTeamView[]): KeyMomentView[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const name = (id: string) => byId.get(id)?.name ?? 'A team';
  const out: KeyMomentView[] = [];
  for (const f of fixtures) {
    const score = `${name(f.homeTeamId)} ${f.homeGoals}-${f.awayGoals} ${name(f.awayTeamId)}`;
    const ids = [f.homeTeamId, f.awayTeamId];
    const goals = new Map<string, { n: number; name: string; teamId: string }>();
    for (const e of f.events) {
      if (e.type !== 'goal' || e.playerId === null) continue;
      const g = goals.get(`${e.playerId}`) ?? { n: 0, name: e.playerName, teamId: e.teamId };
      g.n++;
      goals.set(`${e.playerId}`, g);
    }
    for (const g of goals.values()) {
      if (g.n >= 3) out.push({ matchday: f.matchday, kind: 'hat_trick', text: `${g.name} scores ${g.n === 3 ? 'a hat-trick' : g.n} for ${name(g.teamId)} (${score})`, fixtureId: f.id, teamIds: [g.teamId] });
    }
    if (Math.abs(f.homeGoals - f.awayGoals) >= 4) out.push({ matchday: f.matchday, kind: 'big_win', text: `Rout: ${score}`, fixtureId: f.id, teamIds: ids });
    if (byId.get(f.homeTeamId)?.kind === 'human' && byId.get(f.awayTeamId)?.kind === 'human') {
      out.push({ matchday: f.matchday, kind: 'human_derby', text: `Drafters' derby: ${score}`, fixtureId: f.id, teamIds: ids });
    }
    const before = standings[f.matchday - 2];
    if (before && f.homeGoals !== f.awayGoals) {
      const winner = f.homeGoals > f.awayGoals ? f.homeTeamId : f.awayTeamId;
      const loser = winner === f.homeTeamId ? f.awayTeamId : f.homeTeamId;
      const wp = before.find((r) => r.teamId === winner)?.position ?? 0;
      const lp = before.find((r) => r.teamId === loser)?.position ?? 99;
      if (lp <= 5 && wp - lp >= 6) {
        out.push({ matchday: f.matchday, kind: 'upset', text: `Upset: ${name(winner)} (${ordinal(wp)}) beat ${name(loser)} (${ordinal(lp)}), ${score}`, fixtureId: f.id, teamIds: [winner, loser] });
      }
    }
  }
  for (let md = 2; md <= standings.length; md++) {
    const leader = standings[md - 1]?.[0]?.teamId;
    const prev = standings[md - 2]?.[0]?.teamId;
    if (leader && prev && leader !== prev) {
      out.push({ matchday: md, kind: 'new_leader', text: `${name(leader)} go top of the league`, fixtureId: null, teamIds: [leader] });
    }
  }
  return out.sort((a, b) => a.matchday - b.matchday);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

