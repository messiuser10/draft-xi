import { isPosition, type Position, ratingTier, type RatingTier } from '@draft-xi/engine';
import type { PoolClubView, PoolPlayerView, PoolView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface PoolData extends PoolView {
  playersById: Map<number, PoolPlayerView>;
  clubsById: Map<number, PoolClubView>;
}

/** The draftable pool. Fetched once and cached: it only changes when an admin edits players. */
export function usePool() {
  return useQuery({
    queryKey: ['pool'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PoolData> => {
      const pool = await api<PoolView>('/api/pool');
      return {
        ...pool,
        playersById: new Map(pool.players.map((p) => [p.id, p])),
        clubsById: new Map(pool.clubs.map((c) => [c.id, c])),
      };
    },
  });
}

export function positionsOf(p: PoolPlayerView): Position[] {
  return [p.primaryPosition, ...p.altPositions].filter(isPosition);
}

/** The engine's view of a pool player, for fit checks and rating previews. */
export function toEngine(p: PoolPlayerView) {
  const [primary, ...alts] = positionsOf(p);
  return {
    id: p.id,
    clubId: p.clubId,
    name: p.name,
    primaryPosition: primary ?? 'CM',
    altPositions: alts,
    overall: p.overall,
    nationality: p.nationality,
  };
}

export const TIER_STYLE: Record<RatingTier, string> = {
  Elite: 'bg-fuchsia-500 text-white',
  Gold: 'bg-gold-500 text-night-950',
  Silver: 'bg-slate-300 text-night-950',
  Bronze: 'bg-amber-700 text-white',
};

export function TierBadge({ overall, withLabel = false }: { overall: number; withLabel?: boolean }) {
  const tier = ratingTier(overall);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${TIER_STYLE[tier]}`} title={`${tier} tier`}>
      {overall}
      {withLabel ? <span className="font-semibold uppercase tracking-wide">{tier}</span> : <span className="sr-only">{tier}</span>}
    </span>
  );
}

export function initialsOf(name: string): string {
  const words = name.split(/[\s.-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : (words[0]?.[1] ?? ''))).toUpperCase();
}

export function surnameOf(name: string): string {
  const words = name.split(' ').filter(Boolean);
  return words.length > 1 ? words.slice(1).join(' ') : name;
}
