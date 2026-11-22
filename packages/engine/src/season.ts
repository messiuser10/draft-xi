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
import { rateTeam, round2, type TeamRating } from './ratings';
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
  /** Stop after this matchday, e.g. the first half before a mid-season transfer window. */
  lastMatchday?: number;
  /**
   * Squads change from this matchday on (after a mid-season transfer window). Earlier matchdays
   * are identical to a run without changes, because every random draw is keyed by matchday.
   */
  changes?: { fromMatchday: number; teams: readonly SeasonTeamInput[] };
}

/** Matchdays in the first half of a 20-team season; the mid-season window opens after it. */
export const HALF_SEASON_MATCHDAYS = 19;

export const INJURY_CHANCE = 0.01;
export const INJURY_MIN_MATCHES = 1;
export const INJURY_MAX_MATCHES = 5;
export const INJURY_REPLACEMENT_DROP = 10;

export function rateTeams(inputs: readonly SeasonTeamInput[], params: SimParams): SeasonTeam[] {
  const rated = inputs.map((t) => ({ ...t, rating: rateTeam(t.lineup, { chemistry: params.chemistry }) }));
  return catchUpAi(spreadAi(rated, params.aiSpread), params.aiCatchUp);
}

/**
 * Lifts every AI club by `share` of the gap between the drafted teams' average and the best AI
 * club (see SimParams.aiCatchUp), so AI clubs keep their order but the top ones can contend.
 */
export function catchUpAi<T extends { kind: SeasonTeamInput['kind']; rating: TeamRating }>(teams: readonly T[], share: number): T[] {
  const k = Math.min(1, Math.max(0, share));
  const ai = teams.filter((t) => t.kind === 'ai');
  const drafted = teams.filter((t) => t.kind !== 'ai');
  if (k === 0 || ai.length === 0 || drafted.length === 0) return [...teams];
  const best = ai.reduce((a, b) => (b.rating.strength > a.rating.strength ? b : a)).rating;
  const avg = (f: (r: TeamRating) => number) => drafted.reduce((s, t) => s + f(t.rating), 0) / drafted.length;
  const liftAtt = Math.max(0, k * (avg((r) => r.attack) - best.attack));
  const liftDef = Math.max(0, k * (avg((r) => r.defense) - best.defense));
  if (liftAtt === 0 && liftDef === 0) return [...teams];
  return teams.map((t) => {
    if (t.kind !== 'ai') return t;
    const attack = round2(t.rating.attack + liftAtt);
    const defense = round2(t.rating.defense + liftDef);
    return { ...t, rating: { ...t.rating, attack, defense, strength: round2((attack + defense) / 2) } };
  });
}

/** Pulls AI clubs' attack and defense towards the AI average by `spread` (see SimParams.aiSpread). */
export function spreadAi<T extends { kind: SeasonTeamInput['kind']; rating: TeamRating }>(teams: readonly T[], spread: number): T[] {
  const k = Math.min(1, Math.max(0, spread));
  const ai = teams.filter((t) => t.kind === 'ai');
  if (k === 1 || ai.length < 2) return [...teams];
  const mean = (f: (r: TeamRating) => number) => ai.reduce((s, t) => s + f(t.rating), 0) / ai.length;
  const att = mean((r) => r.attack);
  const def = mean((r) => r.defense);
  return teams.map((t) => {
    if (t.kind !== 'ai') return t;
    const attack = round2(att + k * (t.rating.attack - att));
    const defense = round2(def + k * (t.rating.defense - def));
    return { ...t, rating: { ...t.rating, attack, defense, strength: round2((attack + defense) / 2) } };
  });
}

/** Adds each team's seeded season form (see SimParams.form) to its attack and defense. */
export function withForm<T extends { id: string; rating: TeamRating }>(teams: readonly T[], seed: number, form: number): T[] {
  if (!(form > 0)) return [...teams];
  return teams.map((t) => {
    const swing = form * deriveRng(seed, 'form', t.id).normal();
    const attack = round2(t.rating.attack + swing);
    const defense = round2(t.rating.defense + swing);
    return { ...t, rating: { ...t.rating, attack, defense, strength: round2((attack + defense) / 2) } };
  });
}

/** How much of a team's streak carries over from one matchday to the next. */
export const STREAK_MEMORY = 0.85;

/**
 * A team's streak for every matchday (index 0 = matchday 1): a seeded AR(1) walk whose spread
 * stays at `size` rating points all season.
 */
export function streakSeries(seed: number, teamId: string, matchdays: number, size: number): number[] {
  if (!(size > 0)) return Array.from({ length: matchdays }, () => 0);
  const rng = deriveRng(seed, 'streak', teamId);
  const fresh = Math.sqrt(1 - STREAK_MEMORY * STREAK_MEMORY);
  const out: number[] = [];
  let level = size * rng.normal();
  for (let i = 0; i < matchdays; i++) {
    if (i > 0) level = STREAK_MEMORY * level + fresh * size * rng.normal();
    out.push(level);
  }
  return out;
}

function shiftRating(rating: TeamRating, by: number): TeamRating {
  if (by === 0) return rating;
  const attack = round2(rating.attack + by);
  const defense = round2(rating.defense + by);
  return { ...rating, attack, defense, strength: round2((attack + defense) / 2) };
}

function statKey(teamId: string, slotKey: string, playerId: number | null): string {
  return playerId === null ? `r:${teamId}:${slotKey}` : `p${playerId}@${teamId}`;
}

/** Simulates a full double round robin. Pure and deterministic for a given seed (spec section 9). */
export function simulateSeason(inputs: readonly SeasonTeamInput[], options: SeasonOptions): SeasonResult {
  const params = resolveParams(options.params);
  const full = (options.detail ?? 'full') === 'full';
  const seed = options.seed >>> 0;
  const firstTeams = withForm(rateTeams(inputs, params), seed, params.form);
  const laterTeams = options.changes ? withForm(rateTeams(options.changes.teams, params), seed, params.form) : null;
  const changeFrom = options.changes?.fromMatchday ?? Number.POSITIVE_INFINITY;
  const firstById = new Map(firstTeams.map((t) => [t.id, t]));
  const laterById = laterTeams ? new Map(laterTeams.map((t) => [t.id, t])) : firstById;
  const firstLeague = leagueAverages(firstTeams.map((t) => t.rating));
  const laterLeague = laterTeams ? leagueAverages(laterTeams.map((t) => t.rating)) : firstLeague;
  const teams = laterTeams ?? firstTeams;
  const schedule = generateFixtures(
    teams.map((t) => t.id),
    seed,
  );
  const table = new LeagueTable(
    teams.map((t) => t.id),
    params.points,
    seed,
    params.tiebreakers,
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
    if (!changed) return { lineup: team.lineup, rating: team.rating };
    // Keep the team's (possibly AI-spread) rating and take off only what the injuries cost.
    const whole = rateTeam(team.lineup, { chemistry: params.chemistry });
    const hurt = rateTeam(lineup, { chemistry: params.chemistry });
    const attack = round2(team.rating.attack + hurt.attack - whole.attack);
    const defense = round2(team.rating.defense + hurt.defense - whole.defense);
    return { lineup, rating: { ...hurt, attack, defense, strength: round2((attack + defense) / 2) } };
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
  const totalMatchdays = schedule.reduce((m, f) => Math.max(m, f.matchday), 0);
  const lastMatchday = Math.min(options.lastMatchday ?? Number.POSITIVE_INFINITY, totalMatchdays);
  // Always the whole season's series, so a half-season run and the full replay agree.
  const streaks = new Map<string, number[]>();
  const streakOf = (teamId: string) => {
    let series = streaks.get(teamId);
    if (!series) streaks.set(teamId, (series = streakSeries(seed, teamId, totalMatchdays, params.streaks)));
    return series;
  };

  for (let md = 1; md <= lastMatchday; md++) {
    const byId = md >= changeFrom ? laterById : firstById;
    const league = md >= changeFrom ? laterLeague : firstLeague;
    for (const f of schedule.filter((x) => x.matchday === md)) {
      const home = byId.get(f.homeTeamId)!;
      const away = byId.get(f.awayTeamId)!;
      const homeSide = currentSide(home);
      const awaySide = currentSide(away);
      const homeRating = shiftRating(homeSide.rating, streakOf(home.id)[md - 1] ?? 0);
      const awayRating = shiftRating(awaySide.rating, streakOf(away.id)[md - 1] ?? 0);
      const matchKey = `${md}:${home.id}:${away.id}`;

      const score = simulateScore(
        homeRating,
        awayRating,
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
