import type { FormationId } from './formations';
import { bestLineup, lineupFromPicks, type LineupOptions } from './lineup';
import type { SeasonTeamInput } from './season';
import type { EngineClub, EnginePlayer } from './types';

export interface HumanTeamInput {
  id: string;
  name: string;
  formation: FormationId;
  picks: readonly { slotKey: string; playerId: number }[];
}

export interface BuildLeagueInput {
  clubs: readonly EngineClub[];
  players: readonly EnginePlayer[];
  humans: readonly HumanTeamInput[];
  /** From the pre-draft strength snapshot, so drafting never changes who qualifies. */
  aiClubIds: readonly number[];
  /** Spec default: drafted players leave their real club's squad. */
  removeDraftedFromAi?: boolean;
  lineup?: LineupOptions & { strict?: boolean };
}

export const aiTeamId = (clubId: number) => `ai:${clubId}`;

/** One season team per human XI plus one per AI club (spec section 9, steps 1 and 2). */
export function buildLeagueTeams(input: BuildLeagueInput): SeasonTeamInput[] {
  const playersById = new Map(input.players.map((p) => [p.id, p]));
  const drafted = new Set<number>();

  const humanTeams = input.humans.map((h): SeasonTeamInput => {
    const picks = h.picks.map((pick) => {
      const player = playersById.get(pick.playerId);
      if (!player) throw new Error(`Unknown player ${pick.playerId} in ${h.name}`);
      if (drafted.has(player.id)) throw new Error(`${player.name} is drafted by two teams`);
      drafted.add(player.id);
      return { slotKey: pick.slotKey, player };
    });
    const sheet = lineupFromPicks(h.formation, picks, input.lineup);
    return { id: h.id, name: h.name, kind: 'human', formation: sheet.formation, lineup: sheet.lineup };
  });

  const removeDrafted = input.removeDraftedFromAi ?? true;
  const clubsById = new Map(input.clubs.map((c) => [c.id, c]));
  const aiTeams = input.aiClubIds.map((clubId): SeasonTeamInput => {
    const club = clubsById.get(clubId);
    if (!club) throw new Error(`Unknown AI club ${clubId}`);
    const squad = input.players.filter(
      (p) => p.clubId === clubId && !(removeDrafted && drafted.has(p.id)),
    );
    const sheet = bestLineup(squad, input.lineup);
    return { id: aiTeamId(clubId), name: club.name, kind: 'ai', formation: sheet.formation, lineup: sheet.lineup };
  });

  const teams = [...humanTeams, ...aiTeams];
  if (new Set(teams.map((t) => t.id)).size !== teams.length) throw new Error('Team ids must be unique');
  return teams;
}
