/**
 * Results and history (spec section 10): awards, draft grades, pick tags, head to head, team
 * pages, exports, rematch, profiles, Hall of Fame, leaderboard and record book. Everything is
 * derived from the stored seasons, so results never change when an admin edits players later.
 */
import {
  computeAwards,
  draftGrade,
  type DraftPickRecord,
  type FormationId,
  isPosition,
  type PlayerSeasonStat,
  poolRanks,
  type Position,
  type SeasonResult,
  tagPick,
} from '@draft-xi/engine';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { actorOf, type AuthUser, requireUser } from '../auth/service';
import { writeAudit } from '../audit';
import {
  type AwardPlayerView,
  type AwardsView,
  type DraftGradeView,
  type DraftValueView,
  type HallOfFameEntry,
  type HeadToHeadView,
  type LeaderboardRow,
  type LeagueTeamView,
  type PickGradeView,
  type PlayerStatView,
  type ProfileGameView,
  type ProfileView,
  type RecordBookView,
  type RecordEntry,
  type ResultsView,
  SEASON_MATCHDAYS,
  type SeasonView,
  type SplitView,
  type StandingView,
  type TeamPageView,
  type TrophyView,
} from '../contracts';
import type { Database } from '../db/database';
import { conflict, forbidden, notFound } from '../errors';
import { getSetting } from '../settings/app-settings';
import type { DraftService } from './draft';
import { loadPool } from './pool';
import type { SeasonService } from './season';
import type { GameHub, GameService } from './service';
import { type GameRow, settingsOf } from './views';

const round2 = (n: number) => Math.round(n * 100) / 100;
const LEAGUE_SIZE = 20;

export class ResultsService {
  constructor(
    private readonly database: Database,
    private readonly seasons: SeasonService,
    private readonly draft: DraftService,
    private readonly games: GameService,
    private hub: GameHub,
  ) {}

  setHub(hub: GameHub): void {
    this.hub = hub;
  }

  // ---------- Season Complete ----------

  async results(code: string, seasonNumber?: number): Promise<ResultsView> {
    const game = await this.games.getByCode(code);
    const list = await this.seasons.list(game.id);
    if (list.length === 0) throw conflict('not_ready', 'No season has been played yet');
    const number = seasonNumber ?? list.at(-1)!.number;
    const season = await this.seasons.season(code, number);
    const finalTable = season.standings[SEASON_MATCHDAYS - 1] ?? season.standings.at(-1) ?? [];
    const teamById = new Map(season.teams.map((t) => [t.id, t]));
    const teamOfParticipant = new Map(season.teams.filter((t) => t.participantId !== null).map((t) => [t.participantId!, t]));

    const picks = await this.draft.picksOf(this.database.db, game.id);
    const players = await this.playersById(season, picks.map((p) => p.playerId));
    const pool = await loadPool(this.database);
    const rankPool = new Map(pool.players.map((p) => [p.id, { id: p.id, overall: p.overall }]));
    for (const p of players.values()) if (!rankPool.has(p.id)) rankPool.set(p.id, { id: p.id, overall: p.overall });
    const ranks = poolRanks([...rankPool.values()]);

    const pickViews: PickGradeView[] = picks.map((p) => {
      const player = players.get(p.playerId);
      const poolRank = ranks.get(p.playerId) ?? p.pickNumber;
      return {
        pickNumber: p.pickNumber,
        round: p.round,
        participantId: p.participantId,
        teamId: teamOfParticipant.get(p.participantId)?.id ?? null,
        playerId: p.playerId,
        playerName: player?.name ?? 'Player',
        slotKey: p.slotKey,
        overall: player?.overall ?? 0,
        poolRank,
        tag: tagPick(p.pickNumber, poolRank),
        autoPicked: p.autoPicked,
      };
    });

    const grades: DraftGradeView[] = season.teams
      .filter((t) => t.kind === 'human' && t.participantId !== null)
      .map((t) => {
        const finish = finalTable.find((r) => r.teamId === t.id)?.position ?? LEAGUE_SIZE;
        const g = draftGrade(t.rank, finish, season.teams.length);
        return { participantId: t.participantId!, teamId: t.id, teamName: t.name, preseasonRank: t.rank, finish, grade: g.grade, score: g.score };
      })
      .sort((a, b) => b.score - a.score || a.finish - b.finish);

    const awards = await this.awards(game, season, finalTable, players, picks, teamOfParticipant);
    const headToHead = headToHeadOf(season);
    const view: ResultsView = {
      gameCode: game.joinCode,
      gameName: game.name,
      season: number,
      seasonCount: list.length,
      championTeamId: season.championTeamId,
      teams: season.teams,
      finalTable,
      awards,
      grades,
      picks: pickViews,
      headToHead,
      summary: '',
    };
    view.summary = summaryText(view, teamById);
    return view;
  }

  private async awards(
    game: GameRow,
    season: SeasonView,
    finalTable: readonly StandingView[],
    players: Map<number, { id: number; name: string; overall: number; positions: Position[] }>,
    picks: readonly { participantId: number; playerId: number; pickNumber: number }[],
    teamOfParticipant: Map<number, LeagueTeamView>,
  ): Promise<AwardsView | null> {
    if (!season.championTeamId) return null;
    const teamById = new Map(season.teams.map((t) => [t.id, t]));
    const slotOf = new Map<string, string>();
    for (const team of season.teams) for (const s of team.lineup) if (s.playerId !== null) slotOf.set(`p${s.playerId}@${team.id}`, s.slotType);

    const stats: PlayerSeasonStat[] = season.playerStats.map((s) => ({
      key: `p${s.playerId}@${s.teamId}`,
      teamId: s.teamId,
      slotKey: slotOf.get(`p${s.playerId}@${s.teamId}`) ?? '',
      playerId: s.playerId,
      playerName: s.name,
      appearances: s.appearances,
      goals: s.goals,
      assists: s.assists,
      cleanSheets: s.cleanSheets,
      yellows: 0,
      reds: 0,
      ratingSum: s.avgRating * s.appearances,
      avgRating: s.avgRating,
    }));
    // computeAwards only reads these fields of a SeasonResult.
    const shaped = {
      championTeamId: season.championTeamId,
      playerStats: stats,
      table: finalTable.map((r) => ({ played: r.played })),
      teams: season.teams.map((t) => ({
        id: t.id,
        lineup: t.lineup.map((s) => ({ player: { id: s.playerId, positions: s.playerId === null ? [] : (players.get(s.playerId)?.positions ?? []) } })),
      })),
    } as unknown as SeasonResult;
    const draftPicks: DraftPickRecord[] = picks.flatMap((p) => {
      const team = teamOfParticipant.get(p.participantId);
      return team ? [{ playerId: p.playerId, teamId: team.id, pickNumber: p.pickNumber }] : [];
    });
    const formations: FormationId[] = await getSetting(this.database, 'formations.enabled');
    const compatibility = await getSetting(this.database, 'positions.compatibility');
    const a = computeAwards(shaped, { picks: draftPicks, formations, compatibility });

    const byKey = new Map(season.playerStats.map((s) => [`p${s.playerId}@${s.teamId}`, s]));
    const view = (s: PlayerSeasonStat | null | undefined): AwardPlayerView | null => {
      if (!s || s.playerId === null) return null;
      const stat = byKey.get(s.key);
      if (!stat) return null;
      return toAwardPlayer(stat, teamById.get(stat.teamId)?.name ?? 'Team');
    };
    const value = (d: { stat: PlayerSeasonStat; pickNumber: number; performanceRank: number; delta: number } | null): DraftValueView | null => {
      const base = d ? view(d.stat) : null;
      return d && base ? { ...base, pickNumber: d.pickNumber, performanceRank: d.performanceRank, delta: d.delta } : null;
    };
    const tots = a.teamOfTheSeason
      ? {
          formation: a.teamOfTheSeason.formation,
          slots: a.teamOfTheSeason.slots.flatMap(({ slot, stat }) => {
            const v = view(stat);
            const team = teamById.get(stat.teamId);
            const src = team?.lineup.find((l) => l.playerId === stat.playerId);
            if (!v || !src) return [];
            return [{ ...src, slotKey: slot.key, slotType: slot.type, x: slot.x, y: slot.y, stat: v }];
          }),
        }
      : null;
    return {
      championTeamId: season.championTeamId,
      championName: teamById.get(season.championTeamId)?.name ?? 'Champion',
      goldenBoot: view(a.goldenBoot),
      playmaker: view(a.playmaker),
      goldenGlove: view(a.goldenGlove),
      playerOfTheSeason: view(a.playerOfTheSeason),
      teamOfTheSeason: tots,
      bestDraftSteal: value(a.bestDraftSteal),
      biggestFlop: value(a.biggestFlop),
    };
  }

  /** Name, overall and positions for every lineup player and pick, even inactive ones. */
  private async playersById(season: SeasonView, extra: readonly number[]) {
    const ids = new Set<number>(extra);
    for (const team of season.teams) for (const s of team.lineup) if (s.playerId !== null) ids.add(s.playerId);
    const out = new Map<number, { id: number; name: string; overall: number; positions: Position[] }>();
    if (ids.size === 0) return out;
    const { db, t } = this.database;
    const rows = await db.select().from(t.players).where(inArray(t.players.id, [...ids]));
    for (const p of rows) {
      const positions = [p.primaryPosition, ...p.altPositions].filter(isPosition);
      out.set(p.id, { id: p.id, name: p.displayName, overall: p.overall, positions });
    }
    return out;
  }

  // ---------- Team pages ----------

  async team(code: string, seasonNumber: number | undefined, teamId: string): Promise<TeamPageView> {
    const game = await this.games.getByCode(code);
    const list = await this.seasons.list(game.id);
    if (list.length === 0) throw conflict('not_ready', 'No season has been played yet');
    const number = seasonNumber ?? list.at(-1)!.number;
    const season = await this.seasons.season(code, number);
    const team = season.teams.find((t) => t.id === teamId);
    if (!team) throw notFound('That team is not in this season');
    return teamPage(game.joinCode, season, team);
  }

  // ---------- Export and rematch ----------

  async export(code: string, userIn: AuthUser | null, format: 'json' | 'csv'): Promise<{ body: string; contentType: string; filename: string }> {
    const game = await this.games.getByCode(code);
    const user = requireUser(userIn);
    if (game.hostUserId !== user.id && user.role !== 'admin') throw forbidden('Only the host can export results');
    const list = await this.seasons.list(game.id);
    if (list.length === 0) throw conflict('not_ready', 'No season has been played yet');
    const seasons = [];
    for (const s of list) seasons.push(await this.results(code, s.number));
    const base = `draft-xi-${game.joinCode.toLowerCase()}`;
    await writeAudit(this.database.db, this.database.t, { actor: actorOf(user), action: 'game.export', target: `game:${game.joinCode}`, gameId: game.id, details: { format } });
    if (format === 'json') {
      const body = JSON.stringify(
        {
          game: { code: game.joinCode, name: game.name, settings: game.settings, seed: game.seed },
          seasons: seasons.map((r) => ({
            number: r.season,
            champion: r.awards?.championName ?? null,
            table: r.finalTable.map((row) => ({ ...row, team: r.teams.find((t) => t.id === row.teamId)?.name })),
            awards: r.awards,
            grades: r.grades,
            picks: r.picks,
          })),
        },
        null,
        2,
      );
      return { body, contentType: 'application/json', filename: `${base}.json` };
    }
    const lines = ['season,position,team,kind,played,won,drawn,lost,goals_for,goals_against,goal_difference,points'];
    for (const r of seasons) {
      for (const row of r.finalTable) {
        const team = r.teams.find((t) => t.id === row.teamId);
        lines.push(
          [r.season, row.position, csvCell(team?.name ?? ''), team?.kind ?? '', row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference, row.points].join(','),
        );
      }
    }
    return { body: `${lines.join('\n')}\n`, contentType: 'text/csv', filename: `${base}.csv` };
  }

  /** Rematch: a new lobby with the same settings and the same teams (humans not yet ready). */
  async rematch(code: string, userIn: AuthUser | null): Promise<GameRow> {
    const old = await this.games.getByCode(code);
    const user = requireUser(userIn);
    if (old.hostUserId !== user.id && user.role !== 'admin') throw forbidden('Only the host can start a rematch');
    if (old.status !== 'completed') throw conflict('not_ready', 'Finish the season before a rematch');
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(and(eq(t.participants.gameId, old.id), isNotNull(t.participants.teamName)));
    const hostPart = parts.find((p) => p.userId === user.id);
    const team = {
      teamName: hostPart?.teamName ?? `${user.displayName} XI`.slice(0, 24),
      color: hostPart?.color ?? '#22C55E',
      monogram: hostPart?.monogram ?? 'XI',
      formation: (hostPart?.formation ?? null) as FormationId | null,
    };
    const name = old.name.startsWith('Rematch: ') ? old.name : `Rematch: ${old.name}`.slice(0, 40);
    const created = await this.games.create(user, { name, settings: settingsOf(old), team });
    let order = 2;
    for (const p of parts) {
      if (p.id === hostPart?.id) continue;
      await db
        .insert(t.participants)
        .values({
          gameId: created.id,
          userId: p.userId,
          teamName: p.teamName,
          color: p.color,
          monogram: p.monogram,
          formation: p.formation,
          pickOrder: order++,
          isReady: p.isBot,
          isBot: p.isBot,
          botLevel: p.botLevel,
        })
        .onConflictDoNothing();
    }
    await writeAudit(db, t, { actor: actorOf(user), action: 'game.rematch', target: `game:${old.joinCode}`, gameId: old.id, details: { newCode: created.joinCode } });
    this.hub.emit(old.id, { type: 'game:rematch', code: created.joinCode });
    return created;
  }

  // ---------- Profiles and history ----------

  /** Every final table row of a human team managed by a real user, with its game and season. */
  private async humanFinals(userId?: number) {
    const { db, t } = this.database;
    const where = [eq(t.standingRows.matchday, SEASON_MATCHDAYS), eq(t.seasonTeams.kind, 'human'), isNotNull(t.participants.userId), eq(t.participants.isBot, false)];
    if (userId !== undefined) where.push(eq(t.participants.userId, userId));
    return db
      .select({ row: t.standingRows, team: t.seasonTeams, part: t.participants, season: t.seasons, game: t.games })
      .from(t.standingRows)
      .innerJoin(t.seasonTeams, eq(t.standingRows.seasonTeamId, t.seasonTeams.id))
      .innerJoin(t.participants, eq(t.seasonTeams.participantId, t.participants.id))
      .innerJoin(t.seasons, eq(t.standingRows.seasonId, t.seasons.id))
      .innerJoin(t.games, eq(t.seasons.gameId, t.games.id))
      .where(and(...where))
      .orderBy(desc(t.seasons.createdAt));
  }

  /** Pre-season strength rank of each season team within its season. */
  private async preseasonRanks(seasonIds: readonly number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (seasonIds.length === 0) return out;
    const { db, t } = this.database;
    const rows = await db.select().from(t.seasonTeams).where(inArray(t.seasonTeams.seasonId, [...new Set(seasonIds)]));
    const bySeason = new Map<number, typeof rows>();
    for (const r of rows) bySeason.set(r.seasonId, [...(bySeason.get(r.seasonId) ?? []), r]);
    for (const list of bySeason.values()) {
      list
        .sort((a, b) => (b.attackRating + b.defenseRating) / 2 - (a.attackRating + a.defenseRating) / 2 || a.name.localeCompare(b.name))
        .forEach((r, i) => out.set(r.id, i + 1));
    }
    return out;
  }

  async profile(userId: number): Promise<ProfileView> {
    const { db, t } = this.database;
    const [user] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
    if (!user) throw notFound('No such user');
    const finals = await this.humanFinals(userId);
    const ranks = await this.preseasonRanks(finals.map((f) => f.season.id));
    const titles = finals.filter((f) => f.row.position === 1);
    const grades = finals.map((f) => draftGrade(ranks.get(f.team.id) ?? LEAGUE_SIZE, f.row.position, LEAGUE_SIZE));
    const best = grades.sort((a, b) => b.score - a.score)[0];

    const partRows = await db
      .select({ part: t.participants, game: t.games })
      .from(t.participants)
      .innerJoin(t.games, eq(t.participants.gameId, t.games.id))
      .where(and(eq(t.participants.userId, userId), isNotNull(t.participants.teamName)))
      .orderBy(desc(t.games.createdAt))
      .limit(50);
    const games: ProfileGameView[] = partRows.map(({ part, game }) => {
      const first = finals.find((f) => f.game.id === game.id && f.season.seasonNumber === 1);
      return {
        gameCode: game.joinCode,
        gameName: game.name,
        status: game.status,
        teamName: part.teamName ?? 'Team',
        finish: first?.row.position ?? null,
        grade: first ? draftGrade(ranks.get(first.team.id) ?? LEAGUE_SIZE, first.row.position, LEAGUE_SIZE).grade : null,
        createdAt: game.createdAt.toISOString(),
      };
    });
    const trophies: TrophyView[] = titles.map((f) => ({
      gameCode: f.game.joinCode,
      gameName: f.game.name,
      seasonNumber: f.season.seasonNumber,
      teamName: f.team.name,
      points: f.row.points,
      createdAt: f.season.createdAt.toISOString(),
    }));
    return {
      user: { id: user.id, displayName: user.displayName, username: user.username, isGuest: user.isGuest },
      gamesPlayed: partRows.filter(({ game }) => game.status !== 'lobby' && game.status !== 'cancelled').length,
      seasonsPlayed: finals.length,
      titles: titles.length,
      avgFinish: finals.length ? round2(finals.reduce((n, f) => n + f.row.position, 0) / finals.length) : null,
      bestGrade: best?.grade ?? null,
      trophies,
      games,
    };
  }

  async hallOfFame(limit = 30): Promise<HallOfFameEntry[]> {
    const { db, t } = this.database;
    const rows = await db
      .select({ season: t.seasons, game: t.games, team: t.seasonTeams })
      .from(t.seasons)
      .innerJoin(t.games, eq(t.seasons.gameId, t.games.id))
      .innerJoin(t.seasonTeams, eq(t.seasons.championSeasonTeamId, t.seasonTeams.id))
      .where(eq(t.seasons.seasonNumber, 1))
      .orderBy(desc(t.seasons.createdAt))
      .limit(limit);
    if (rows.length === 0) return [];
    const finals = await db
      .select()
      .from(t.standingRows)
      .where(and(eq(t.standingRows.matchday, SEASON_MATCHDAYS), inArray(t.standingRows.seasonTeamId, rows.map((r) => r.team.id))));
    const partIds = rows.flatMap((r) => (r.team.participantId === null ? [] : [r.team.participantId]));
    const managers = new Map<number, string>();
    if (partIds.length > 0) {
      const ms = await db
        .select({ id: t.participants.id, name: t.users.displayName })
        .from(t.participants)
        .innerJoin(t.users, eq(t.participants.userId, t.users.id))
        .where(inArray(t.participants.id, partIds));
      for (const m of ms) managers.set(m.id, m.name);
    }
    return rows.map(({ season, game, team }) => ({
      gameCode: game.joinCode,
      gameName: game.name,
      seasonNumber: season.seasonNumber,
      championName: team.name,
      championIsHuman: team.kind === 'human',
      managerName: team.participantId === null ? null : (managers.get(team.participantId) ?? null),
      points: finals.find((f) => f.seasonTeamId === team.id)?.points ?? 0,
      createdAt: season.createdAt.toISOString(),
    }));
  }

  /** Global leaderboard: titles, then average finish, over every season a user's team played. */
  async leaderboard(limit = 50): Promise<LeaderboardRow[]> {
    const finals = await this.humanFinals();
    const acc = new Map<number, { name: string; titles: number; seasons: number; pos: number }>();
    const { db, t } = this.database;
    const ids = [...new Set(finals.map((f) => f.part.userId!))];
    const names = new Map<number, string>();
    if (ids.length > 0) for (const u of await db.select().from(t.users).where(inArray(t.users.id, ids))) names.set(u.id, u.displayName);
    for (const f of finals) {
      const id = f.part.userId!;
      const a = acc.get(id) ?? { name: names.get(id) ?? 'Player', titles: 0, seasons: 0, pos: 0 };
      if (f.row.position === 1) a.titles++;
      a.seasons++;
      a.pos += f.row.position;
      acc.set(id, a);
    }
    return [...acc.entries()]
      .map(([userId, a]) => ({ userId, displayName: a.name, titles: a.titles, seasons: a.seasons, avgFinish: round2(a.pos / a.seasons) }))
      .sort((a, b) => b.titles - a.titles || a.avgFinish - b.avgFinish || b.seasons - a.seasons)
      .slice(0, limit);
  }

  async records(): Promise<RecordBookView> {
    const { db, t } = this.database;
    const finalRow = (order: 'points' | 'gd') =>
      db
        .select({ row: t.standingRows, team: t.seasonTeams, season: t.seasons, game: t.games })
        .from(t.standingRows)
        .innerJoin(t.seasonTeams, eq(t.standingRows.seasonTeamId, t.seasonTeams.id))
        .innerJoin(t.seasons, eq(t.standingRows.seasonId, t.seasons.id))
        .innerJoin(t.games, eq(t.seasons.gameId, t.games.id))
        .where(eq(t.standingRows.matchday, SEASON_MATCHDAYS))
        .orderBy(order === 'points' ? desc(t.standingRows.points) : desc(t.standingRows.goalDifference), asc(t.seasons.createdAt))
        .limit(1);
    const [pts] = await finalRow('points');
    const [gd] = await finalRow('gd');
    const [scorer] = await db
      .select({ stat: t.playerSeasonStats, team: t.seasonTeams, season: t.seasons, game: t.games, player: t.players })
      .from(t.playerSeasonStats)
      .innerJoin(t.seasonTeams, eq(t.playerSeasonStats.seasonTeamId, t.seasonTeams.id))
      .innerJoin(t.seasons, eq(t.playerSeasonStats.seasonId, t.seasons.id))
      .innerJoin(t.games, eq(t.seasons.gameId, t.games.id))
      .innerJoin(t.players, eq(t.playerSeasonStats.playerId, t.players.id))
      .where(eq(t.seasonTeams.kind, 'human'))
      .orderBy(desc(t.playerSeasonStats.goals), asc(t.seasons.createdAt))
      .limit(1);
    const entry = (
      r: { team: { name: string }; season: { seasonNumber: number }; game: { joinCode: string; name: string } } | undefined,
      value: number,
      label: string,
    ): RecordEntry | null =>
      r ? { value, label, teamName: r.team.name, gameCode: r.game.joinCode, gameName: r.game.name, seasonNumber: r.season.seasonNumber } : null;
    return {
      mostPoints: entry(pts, pts?.row.points ?? 0, `${pts?.row.points ?? 0} points`),
      mostGoalsByDrafted: entry(scorer, scorer?.stat.goals ?? 0, `${scorer?.player.displayName ?? ''}, ${scorer?.stat.goals ?? 0} goals`),
      bestGoalDifference: entry(gd, gd?.row.goalDifference ?? 0, `${(gd?.row.goalDifference ?? 0) > 0 ? '+' : ''}${gd?.row.goalDifference ?? 0} goal difference`),
    };
  }
}

function toAwardPlayer(s: PlayerStatView, teamName: string): AwardPlayerView {
  return {
    playerId: s.playerId,
    name: s.name,
    teamId: s.teamId,
    teamName,
    appearances: s.appearances,
    goals: s.goals,
    assists: s.assists,
    cleanSheets: s.cleanSheets,
    avgRating: s.avgRating,
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Head to head for every pair of human teams in one season. */
export function headToHeadOf(season: SeasonView): HeadToHeadView[] {
  const humans = season.teams.filter((t) => t.kind === 'human').sort((a, b) => a.name.localeCompare(b.name));
  const out: HeadToHeadView[] = [];
  for (let i = 0; i < humans.length; i++) {
    for (let j = i + 1; j < humans.length; j++) {
      const a = humans[i]!.id;
      const b = humans[j]!.id;
      const h: HeadToHeadView = { teamAId: a, teamBId: b, aWins: 0, draws: 0, bWins: 0, aGoals: 0, bGoals: 0, fixtures: [] };
      for (const f of season.fixtures) {
        if (!((f.homeTeamId === a && f.awayTeamId === b) || (f.homeTeamId === b && f.awayTeamId === a))) continue;
        const ag = f.homeTeamId === a ? f.homeGoals : f.awayGoals;
        const bg = f.homeTeamId === a ? f.awayGoals : f.homeGoals;
        h.aGoals += ag;
        h.bGoals += bg;
        if (ag > bg) h.aWins++;
        else if (bg > ag) h.bWins++;
        else h.draws++;
        h.fixtures.push({ fixtureId: f.id, matchday: f.matchday, homeTeamId: f.homeTeamId, homeGoals: f.homeGoals, awayGoals: f.awayGoals });
      }
      out.push(h);
    }
  }
  return out;
}

const emptySplit = (): SplitView => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });

export function teamPage(gameCode: string, season: SeasonView, team: LeagueTeamView): TeamPageView {
  const names = new Map(season.teams.map((t) => [t.id, t.name]));
  const finalTable = season.standings[SEASON_MATCHDAYS - 1] ?? season.standings.at(-1) ?? [];
  const stats = new Map(season.playerStats.filter((s) => s.teamId === team.id).map((s) => [s.playerId, s]));
  const players = team.lineup.map((s) => {
    const st = s.playerId === null ? undefined : stats.get(s.playerId);
    return { ...s, appearances: st?.appearances ?? 0, goals: st?.goals ?? 0, assists: st?.assists ?? 0, cleanSheets: st?.cleanSheets ?? 0, avgRating: st?.avgRating ?? 0 };
  });
  const home = emptySplit();
  const away = emptySplit();
  const timeline: TeamPageView['timeline'] = [];
  let biggestWin: TeamPageView['biggestWin'] = null;
  let run = 0;
  let longestUnbeaten = 0;
  for (const f of season.fixtures) {
    const isHome = f.homeTeamId === team.id;
    if (!isHome && f.awayTeamId !== team.id) continue;
    const gf = isHome ? f.homeGoals : f.awayGoals;
    const ga = isHome ? f.awayGoals : f.homeGoals;
    const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
    const split = isHome ? home : away;
    split.played++;
    split.goalsFor += gf;
    split.goalsAgainst += ga;
    if (result === 'W') split.won++;
    else if (result === 'D') split.drawn++;
    else split.lost++;
    split.points = split.won * 3 + split.drawn;
    const opponentId = isHome ? f.awayTeamId : f.homeTeamId;
    const position = season.standings[f.matchday - 1]?.find((r) => r.teamId === team.id)?.position ?? 0;
    timeline.push({ matchday: f.matchday, fixtureId: f.id, opponentId, opponentName: names.get(opponentId) ?? 'Opponent', home: isHome, goalsFor: gf, goalsAgainst: ga, result, position });
    if (result === 'W' && (!biggestWin || gf - ga > biggestWin.goalsFor - biggestWin.goalsAgainst || (gf - ga === biggestWin.goalsFor - biggestWin.goalsAgainst && gf > biggestWin.goalsFor))) {
      biggestWin = { fixtureId: f.id, matchday: f.matchday, opponentName: names.get(opponentId) ?? 'Opponent', goalsFor: gf, goalsAgainst: ga, home: isHome };
    }
  }
  timeline.sort((a, b) => a.matchday - b.matchday);
  for (const m of timeline) {
    run = m.result === 'L' ? 0 : run + 1;
    longestUnbeaten = Math.max(longestUnbeaten, run);
  }
  const top = [...stats.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists)[0];
  return {
    gameCode,
    season: season.number,
    team,
    finalRow: finalTable.find((r) => r.teamId === team.id) ?? null,
    players,
    timeline,
    home,
    away,
    biggestWin,
    longestUnbeaten,
    topScorer: top && top.goals > 0 ? { playerId: top.playerId, name: top.name, goals: top.goals } : null,
  };
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function summaryText(r: ResultsView, teams: Map<string, LeagueTeamView>): string {
  const name = (id: string) => teams.get(id)?.name ?? 'Team';
  const lines = [`${r.gameName}: season ${r.season}`];
  if (r.awards) lines.push(`Champions: ${r.awards.championName}`);
  const humans = r.finalTable.filter((row) => teams.get(row.teamId)?.kind === 'human');
  for (const row of humans) {
    const grade = r.grades.find((g) => g.teamId === row.teamId)?.grade;
    lines.push(`${ordinal(row.position)} ${name(row.teamId)}, ${row.points} pts (${row.won}W ${row.drawn}D ${row.lost}L)${grade ? `, draft grade ${grade}` : ''}`);
  }
  const a = r.awards;
  if (a?.goldenBoot) lines.push(`Golden Boot: ${a.goldenBoot.name} (${a.goldenBoot.teamName}), ${a.goldenBoot.goals} goals`);
  if (a?.playerOfTheSeason) lines.push(`Player of the Season: ${a.playerOfTheSeason.name}, ${a.playerOfTheSeason.avgRating.toFixed(2)} avg`);
  if (a?.bestDraftSteal) lines.push(`Steal of the draft: ${a.bestDraftSteal.name} (pick ${a.bestDraftSteal.pickNumber})`);
  lines.push('Draft XI League, an unofficial fan game');
  return lines.join('\n');
}
