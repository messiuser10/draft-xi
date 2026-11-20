/** Loads the owner's data files as engine input. Test-only I/O; the engine itself never reads files. */
import { readFileSync } from 'node:fs';
import {
  buildLeagueTeams,
  computeClubStrengths,
  createRng,
  type EngineClub,
  type EnginePlayer,
  FORMATION_IDS,
  hashSeed,
  type Position,
  type SeasonTeamInput,
  selectAiClubIds,
  simulateRandomDraft,
  type SimulatedPick,
} from '../../src';

const DATA = new URL('../../../../data/', import.meta.url);

interface RawClub {
  name: string;
  strength_rating: number;
  best_formation: string;
  strength_rank: number;
}
interface RawPlayer {
  club: string;
  name: string;
  primary_position: Position;
  alt_positions: Position[];
  overall: number;
  nationality: string;
}

export const rawClubs = JSON.parse(readFileSync(new URL('clubs.json', DATA), 'utf8')) as RawClub[];
const rawPlayers = (JSON.parse(readFileSync(new URL('players.seed.json', DATA), 'utf8')) as { players: RawPlayer[] })
  .players;

export const clubs: EngineClub[] = rawClubs.map((c, i) => ({ id: i + 1, name: c.name }));
const clubIdByName = new Map(clubs.map((c) => [c.name, c.id]));
export const clubId = (name: string): number => clubIdByName.get(name)!;

export const players: EnginePlayer[] = rawPlayers.map((p, i) => ({
  id: i + 1,
  clubId: clubIdByName.get(p.club)!,
  name: p.name,
  primaryPosition: p.primary_position,
  altPositions: p.alt_positions,
  overall: p.overall,
  nationality: p.nationality,
}));

export const playerByName = (name: string, club?: string): EnginePlayer =>
  players.find((p) => p.name === name && (club === undefined || p.clubId === clubId(club)))!;

export const squadOf = (club: string): EnginePlayer[] => players.filter((p) => p.clubId === clubId(club));

/** A league with `humans` random-draft teams plus the strongest AI clubs. */
export function makeLeague(humans: number, seed: number): { teams: SeasonTeamInput[]; picks: SimulatedPick[] } {
  const ai = selectAiClubIds(computeClubStrengths(clubs, players), humans);
  const rng = createRng(hashSeed(seed, 'test-draft'));
  const drafters = Array.from({ length: humans }, () => ({ formation: rng.pick(FORMATION_IDS) }));
  const picks = simulateRandomDraft(players, drafters, rng);
  const teams = buildLeagueTeams({
    clubs,
    players,
    aiClubIds: ai,
    humans: drafters.map((d, i) => ({
      id: `h:${i + 1}`,
      name: `Human ${i + 1}`,
      formation: d.formation,
      picks: picks.filter((p) => p.participantIndex === i).map((p) => ({ slotKey: p.slotKey, playerId: p.player.id })),
    })),
  });
  return { teams, picks };
}
