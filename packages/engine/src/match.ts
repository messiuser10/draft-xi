import type { FormationId } from './formations';
import type { LineupEntry } from './lineup';
import type { SimParams } from './params';
import type { TeamRating } from './ratings';
import type { Rng } from './rng';
import { DEFENSIVE_SLOTS, type SlotType } from './slots';
import type { TeamKind } from './types';

export interface SeasonTeam {
  id: string;
  name: string;
  kind: TeamKind;
  formation: FormationId;
  lineup: LineupEntry[];
  rating: TeamRating;
}

export interface LeagueAverages {
  attack: number;
  defense: number;
}

export function leagueAverages(ratings: readonly TeamRating[]): LeagueAverages {
  const n = Math.max(1, ratings.length);
  return {
    attack: ratings.reduce((s, r) => s + r.attack, 0) / n,
    defense: ratings.reduce((s, r) => s + r.defense, 0) / n,
  };
}

/** Expected goals before noise (spec section 9, step 5). */
export function expectedGoals(
  home: TeamRating,
  away: TeamRating,
  league: LeagueAverages,
  params: SimParams,
): { home: number; away: number } {
  const edge = (att: number, def: number) =>
    Math.exp(params.sensitivity * (att - league.attack - (def - league.defense)));
  return {
    home: params.baseGoals * params.homeAdvantage * edge(home.attack, away.defense),
    away: params.baseGoals * edge(away.attack, home.defense),
  };
}

export const XG_MIN = 0.15;
export const XG_MAX = 4.5;

export function simulateScore(
  home: TeamRating,
  away: TeamRating,
  league: LeagueAverages,
  params: SimParams,
  rng: Rng,
): { homeGoals: number; awayGoals: number } {
  const xg = expectedGoals(home, away, league, params);
  const sigma = Math.min(1, Math.max(0, params.chaos)) * 0.2;
  const noisy = (base: number) =>
    Math.min(XG_MAX, Math.max(XG_MIN, base * Math.exp(sigma * rng.normal())));
  const lambdaHome = noisy(xg.home);
  const lambdaAway = noisy(xg.away);
  const shared = Math.min(Math.max(0, params.sharedGoals), lambdaHome - 0.05, lambdaAway - 0.05);
  if (!(shared > 0)) return { homeGoals: rng.poisson(lambdaHome), awayGoals: rng.poisson(lambdaAway) };
  const both = rng.poisson(shared);
  return { homeGoals: rng.poisson(lambdaHome - shared) + both, awayGoals: rng.poisson(lambdaAway - shared) + both };
}

export type MatchEventType = 'goal' | 'assist' | 'yellow' | 'red';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  teamId: string;
  slotKey: string;
  /** Null for a generic reserve. */
  playerId: number | null;
  playerName: string;
}

export interface PlayerMatchLine {
  teamId: string;
  slotKey: string;
  playerId: number | null;
  playerName: string;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
  cleanSheet: boolean;
  rating: number;
}

const SCORER_WEIGHT: Record<SlotType, number> = {
  ST: 10,
  RW: 6,
  LW: 6,
  CAM: 5,
  RM: 4.5,
  LM: 4.5,
  CM: 2.5,
  CDM: 1,
  RB: 1,
  LB: 1,
  RWB: 1,
  LWB: 1,
  CB: 0.8,
  GK: 0.02,
};

const ASSIST_WEIGHT: Record<SlotType, number> = {
  CAM: 5,
  RW: 4.5,
  LW: 4.5,
  CM: 3.5,
  RM: 3.5,
  LM: 3.5,
  ST: 2.5,
  RB: 2,
  LB: 2,
  RWB: 2,
  LWB: 2,
  CDM: 1.5,
  CB: 0.6,
  GK: 0.1,
};

const CARD_WEIGHT: Record<SlotType, number> = {
  CDM: 1.6,
  CB: 1.5,
  RB: 1.3,
  LB: 1.3,
  RWB: 1.3,
  LWB: 1.3,
  CM: 1.2,
  RM: 0.9,
  LM: 0.9,
  CAM: 0.8,
  ST: 0.8,
  RW: 0.7,
  LW: 0.7,
  GK: 0.2,
};

export const ASSIST_CHANCE = 0.75;
export const YELLOWS_PER_TEAM = 1.7;
export const RED_CHANCE_PER_TEAM = 0.05;
const RATING_NOISE = 0.4;

const quality = (e: LineupEntry) => (e.effectiveOverall / 100) ** 2;

interface Side {
  teamId: string;
  lineup: readonly LineupEntry[];
}

/** Scorers, assists, cards, clean sheets and player ratings for a known score (step 6). */
export function generateMatchDetail(
  home: Side,
  away: Side,
  homeGoals: number,
  awayGoals: number,
  rng: Rng,
): { events: MatchEvent[]; lines: PlayerMatchLine[] } {
  const events: MatchEvent[] = [];
  const lines = new Map<string, PlayerMatchLine>();
  const lineFor = (teamId: string, e: LineupEntry): PlayerMatchLine => {
    const key = `${teamId}|${e.slotKey}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        teamId,
        slotKey: e.slotKey,
        playerId: e.player.id,
        playerName: e.player.name,
        goals: 0,
        assists: 0,
        yellows: 0,
        reds: 0,
        cleanSheet: false,
        rating: 0,
      };
      lines.set(key, line);
    }
    return line;
  };
  const event = (minute: number, type: MatchEventType, teamId: string, e: LineupEntry) => {
    events.push({ minute, type, teamId, slotKey: e.slotKey, playerId: e.player.id, playerName: e.player.name });
  };

  for (const side of [home, away]) for (const e of side.lineup) lineFor(side.teamId, e);

  const sides = [
    { side: home, goals: homeGoals, conceded: awayGoals },
    { side: away, goals: awayGoals, conceded: homeGoals },
  ];

  for (const { side, goals } of sides) {
    for (let g = 0; g < goals; g++) {
      const minute = rng.int(1, 94);
      const scorer = rng.weighted(side.lineup, (e) => SCORER_WEIGHT[e.slotType] * quality(e));
      event(minute, 'goal', side.teamId, scorer);
      lineFor(side.teamId, scorer).goals++;
      if (rng.chance(ASSIST_CHANCE)) {
        const mates = side.lineup.filter((e) => e !== scorer);
        const assister = rng.weighted(mates, (e) => ASSIST_WEIGHT[e.slotType] * quality(e));
        event(minute, 'assist', side.teamId, assister);
        lineFor(side.teamId, assister).assists++;
      }
    }
  }

  for (const { side } of sides) {
    const yellows = rng.poisson(YELLOWS_PER_TEAM);
    for (let c = 0; c < yellows; c++) {
      const who = rng.weighted(side.lineup, (e) => CARD_WEIGHT[e.slotType]);
      event(rng.int(1, 94), 'yellow', side.teamId, who);
      lineFor(side.teamId, who).yellows++;
    }
    if (rng.chance(RED_CHANCE_PER_TEAM)) {
      const who = rng.weighted(side.lineup, (e) => CARD_WEIGHT[e.slotType]);
      event(rng.int(1, 94), 'red', side.teamId, who);
      lineFor(side.teamId, who).reds++;
    }
  }

  for (const { side, goals, conceded } of sides) {
    const won = goals > conceded;
    for (const e of side.lineup) {
      const line = lineFor(side.teamId, e);
      line.cleanSheet = conceded === 0 && DEFENSIVE_SLOTS.has(e.slotType);
      const raw =
        6 +
        line.goals +
        0.6 * line.assists +
        (won ? 0.3 : 0) +
        (line.cleanSheet ? 0.6 : 0) +
        RATING_NOISE * rng.normal();
      line.rating = Math.round(Math.min(10, Math.max(4, raw)) * 10) / 10;
    }
  }

  const typeOrder: Record<MatchEventType, number> = { goal: 0, assist: 1, yellow: 2, red: 3 };
  events.sort((a, b) => a.minute - b.minute || typeOrder[a.type] - typeOrder[b.type]);
  return { events, lines: [...lines.values()] };
}
