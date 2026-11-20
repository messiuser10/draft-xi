import type { Position } from './positions';

/** A real player as the engine sees him. Overall is the only rating. */
export interface EnginePlayer {
  id: number;
  clubId: number;
  name: string;
  primaryPosition: Position;
  altPositions: readonly Position[];
  overall: number;
  nationality: string;
}

export interface EngineClub {
  id: number;
  name: string;
}

export type TeamKind = 'human' | 'ai';
