import { type Fixture, generateFixtures } from './fixtures';
import type { FormationId } from './formations';
import { type LineupEntry, reservePlayer } from './lineup';
import {
  generateMatchDetail,
  leagueAverages,
  type MatchEvent,
  type SeasonTeam,
  simulateScore,
} from './match';
import { resolveParams, type SimParams } from './params';
import { rateTeam, round2 } from './ratings';
import { deriveRng } from './rng';
import { LeagueTable, type StandingRow } from './table';
import type { TeamKind } from './types';

export interface SeasonTeamInput {
  id: string;
  name: string;
  kind: TeamKind;
  formation: FormationId;
  lineup: LineupEntry[];
}

export interface PlayedFixture extends Fixture {
  homeGoals: number;
  awayGoals: number;
  /** Empty in fast mode. */
  events: MatchEvent[];
}

export interface PlayerSeasonStat {
  /** Stable id within the season: "p<playerId>@<teamId>" or "r:<teamId>:<slotKey>" for reserves. */
  key: string;
  teamId: string;
  slotKey: string;
  playerId: number | null;
  playerName: string;
  appearances: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  yellows: number;
  reds: number;
  ratingSum: number;
  avgRating: number;
}

export interface SeasonSummary {
  matches: number;
  goals: number;
  homeWins: number;
  draws: number;
  awayWins: number;
}

export interface SeasonResult {
  seed: number;
  params: SimParams;
  teams: SeasonTeam[];
  fixtures: PlayedFixture[];
  /** standings[i] is the table after matchday i + 1. Empty in fast mode. */
  standings: StandingRow[][];
  table: StandingRow[];
  playerStats: PlayerSeasonStat[];
  championTeamId: string;
  summary: SeasonSummary;
}

export interface SeasonOptions {
  seed: number;
  params?: Partial<SimParams>;
  /** "fast" skips events, player stats and per-matchday tables (used by Monte Carlo). Scores are identical. */
  detail?: 'full' | 'fast';
}

export const INJURY_CHANCE = 0.01;
export const INJURY_MIN_MATCHES = 1;
export const INJURY_MAX_MATCHES = 5;
export const INJURY_REPLACEMENT_DROP = 10;

export function rateTeams(inputs: readonly SeasonTeamInput[], params: SimParams): SeasonTeam[] {
  return inputs.map((t) => ({ ...t, rating: rateTeam(t.lineup, { chemistry: params.chemistry }) }));
}

function statKey(teamId: string, slotKey: string, playerId: number | null): string {
  return playerId === null ? `r:${teamId}:${slotKey}` : `p${playerId}@${teamId}`;
}

/** Simulates a full double round robin. Pure and deterministic for a given seed (spec section 9). */
export function simulateSeason(inputs: readonly SeasonTeamInput[], options: SeasonOptions): SeasonResult {
  const params = resolveParams(options.params);
  const full = (options.detail ?? 'full') === 'full';
  const seed = options.seed >>> 0;
  const teams = rateTeams(inputs, params);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const league = leagueAverages(teams.map((t) => t.rating));
  const schedule = generateFixtures(
    teams.map((t) => t.id),
    seed,
  );
  const table = new LeagueTable(
    teams.map((t) => t.id),
    params.points,
    seed,
  );

  // Injury state: slotKey -> first team-match index the player is available again.
  const injuredUntil = new Map(teams.map((t) => [t.id, new Map<string, number>()]));
  const matchesPlayed = new Map(teams.map((t) => [t.id, 0]));

  const currentSide = (team: SeasonTeam) => {
    if (!params.injuries) return { lineup: team.lineup, rating: team.rating };
    const idx = matchesPlayed.get(team.id) ?? 0;
    const out = injuredUntil.get(team.id)!;
    let changed = false;
    const lineup = team.lineup.map((e) => {
      const until = out.get(e.slotKey);
      if (until === undefined || idx >= until || e.reserve) return e;
      changed = true;
      const rating = Math.max(40, e.player.overall - INJURY_REPLACEMENT_DROP);
      return {
        ...e,
        player: reservePlayer(e.slotType, rating, `Reserve for ${e.player.name}`),
        effectiveOverall: rating,
        outOfPosition: false,
        reserve: true,
      };
    });
    return changed
      ? { lineup, rating: rateTeam(lineup, { chemistry: params.chemistry }) }
      : { lineup: team.lineup, rating: team.rating };
  };

  const rollInjuries = (team: SeasonTeam, lineup: readonly LineupEntry[], key: string) => {
    if (!params.injuries) return;
    const rng = deriveRng(seed, 'injury', key, team.id);
    const idx = matchesPlayed.get(team.id) ?? 0;
    const out = injuredUntil.get(team.id)!;
    for (const e of lineup) {
      if (e.reserve) continue;
      if (rng.chance(INJURY_CHANCE)) {
        out.set(e.slotKey, idx + 1 + rng.int(INJURY_MIN_MATCHES, INJURY_MAX_MATCHES));
      }
    }
  };

  const stats = new Map<string, PlayerSeasonStat>();
  const fixtures: PlayedFixture[] = [];
  const standings: StandingRow[][] = [];
  const summary: SeasonSummary = { matches: 0, goals: 0, homeWins: 0, draws: 0, awayWins: 0 };
  const lastMatchday = schedule.reduce((m, f) => Math.max(m, f.matchday), 0);

  for (let md = 1; md <= lastMatchday; md++) {
    for (const f of schedule.filter((x) => x.matchday === md)) {
      const home = byId.get(f.homeTeamId)!;
      const away = byId.get(f.awayTeamId)!;
      const homeSide = currentSide(home);
      const awaySide = currentSide(away);
      const matchKey = `${md}:${home.id}:${away.id}`;

      const score = simulateScore(
        homeSide.rating,
        awaySide.rating,
        league,
        params,
        deriveRng(seed, 'score', md, home.id, away.id),
      );
      let events: MatchEvent[] = [];
      if (full) {
        const detail = generateMatchDetail(
          { teamId: home.id, lineup: homeSide.lineup },
          { teamId: away.id, lineup: awaySide.lineup },
          score.homeGoals,
          score.awayGoals,
          deriveRng(seed, 'events', md, home.id, away.id),
        );
        events = detail.events;
        for (const line of detail.lines) {
          const key = statKey(line.teamId, line.slotKey, line.playerId);
          const s =
            stats.get(key) ??
            ({
              key,
              teamId: line.teamId,
              slotKey: line.slotKey,
              playerId: line.playerId,
              playerName: line.playerId === null ? `Reserve (${line.slotKey})` : line.playerName,
              appearances: 0,
              goals: 0,
              assists: 0,
              cleanSheets: 0,
              yellows: 0,
              reds: 0,
              ratingSum: 0,
              avgRating: 0,
            } satisfies PlayerSeasonStat);
          s.appearances++;
          s.goals += line.goals;
          s.assists += line.assists;
          s.cleanSheets += line.cleanSheet ? 1 : 0;
          s.yellows += line.yellows;
          s.reds += line.reds;
          s.ratingSum = round2(s.ratingSum + line.rating);
          stats.set(key, s);
        }
      }

      rollInjuries(home, homeSide.lineup, matchKey);
      rollInjuries(away, awaySide.lineup, matchKey);
      matchesPlayed.set(home.id, (matchesPlayed.get(home.id) ?? 0) + 1);
      matchesPlayed.set(away.id, (matchesPlayed.get(away.id) ?? 0) + 1);

      const played = { ...f, homeGoals: score.homeGoals, awayGoals: score.awayGoals, events };
      fixtures.push(played);
      table.record(played);
      summary.matches++;
      summary.goals += score.homeGoals + score.awayGoals;
      if (score.homeGoals > score.awayGoals) summary.homeWins++;
      else if (score.homeGoals === score.awayGoals) summary.draws++;
      else summary.awayWins++;
    }
    if (full) standings.push(table.standings());
  }

  const finalTable = full ? (standings[standings.length - 1] ?? table.standings()) : table.standings();
  const playerStats = [...stats.values()].map((s) => ({
    ...s,
    avgRating: s.appearances > 0 ? round2(s.ratingSum / s.appearances) : 0,
  }));

  return {
    seed,
    params,
    teams,
    fixtures,
    standings,
    table: finalTable,
    playerStats,
    championTeamId: finalTable[0]!.teamId,
    summary,
  };
}
