import { type EngineClub, type EnginePlayer, isPosition, type Position } from '@draft-xi/engine';
import type { Dataset } from './dataset';

export interface EngineData {
  clubs: EngineClub[];
  players: EnginePlayer[];
}

/**
 * The seed files as engine input. Ids are 1-based file order, which is stable for a given file;
 * database code maps them to real ids by club and player name.
 */
export function datasetToEngine(dataset: Dataset): EngineData {
  const clubs = dataset.clubs.map((c, i) => ({ id: i + 1, name: c.name }));
  const clubIdByName = new Map(clubs.map((c) => [c.name, c.id]));
  const players = dataset.players.flatMap((p, i): EnginePlayer[] => {
    const clubId = clubIdByName.get(p.club);
    if (clubId === undefined || !isPosition(p.primary_position)) return [];
    return [
      {
        id: i + 1,
        clubId,
        name: p.name,
        primaryPosition: p.primary_position,
        altPositions: p.alt_positions.filter(isPosition) satisfies Position[],
        overall: p.overall,
        nationality: p.nationality,
      },
    ];
  });
  return { clubs, players };
}
