import type { LeagueTeamView, LeagueView, LineupSlotView, SeasonView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import type { PitchSlot } from '../components/Pitch';
import { api } from './api';
import type { PoolData } from './pool';

export function useLeague(code: string, key: unknown) {
  return useQuery({ queryKey: ['league', code, key], queryFn: () => api<LeagueView>(`/api/games/${code}/league`) });
}

/** `matchdays` is part of the key: a season is stored again once its second half is played. */
export function useSeason(code: string, n: number | null, matchdays?: number) {
  return useQuery({
    queryKey: ['season', code, n, matchdays],
    enabled: n !== null,
    staleTime: Infinity,
    queryFn: () => api<SeasonView>(`/api/games/${code}/seasons/${n}`),
  });
}

/** Pitch slots for a stored XI; optional per-player stat line. */
export function lineupSlots(lineup: readonly LineupSlotView[], pool: PoolData | undefined, stat?: (s: LineupSlotView) => string | undefined): PitchSlot[] {
  return lineup.map((s) => ({
    key: s.slotKey,
    type: s.slotType,
    x: s.x,
    y: s.y,
    player: {
      name: s.reserve ? 'Reserve' : s.name,
      overall: s.effectiveOverall,
      ringColor: (s.clubId !== null && pool?.clubsById.get(s.clubId)?.primaryColor) || '#94A3B8',
      note: s.reserve ? 'reserve' : s.outOfPosition ? 'out of pos.' : undefined,
      stat: stat?.(s),
    },
  }));
}

export const teamLabel = (t: LeagueTeamView) => (t.kind === 'human' ? 'Human' : 'AI');
