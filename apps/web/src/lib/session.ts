import type { GameSettings, MeView } from '@draft-xi/server/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { resetSocket } from './socket';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: MeView | null }>('/api/auth/me').then((r) => r.user),
    staleTime: 60_000,
  });
}

export interface SiteInfo {
  leagueName: string;
  banner: string;
  registrationsOpen: boolean;
  publicLobbiesEnabled: boolean;
  maxHumansLimit: number;
  timerRange: { min: number; max: number };
  formations: string[];
  gameDefaults: GameSettings;
  tableBands: TableBands;
  maintenance: { enabled: boolean; message: string };
}

export type BandColor = 'gold' | 'green' | 'blue' | 'red' | 'purple';
export interface TableBands {
  enabled: boolean;
  bands: { label: string; from: number; to: number; color: BandColor }[];
}

export const DEFAULT_BANDS: TableBands = {
  enabled: true,
  bands: [
    { label: 'Champion', from: 1, to: 1, color: 'gold' },
    { label: 'Top four', from: 2, to: 4, color: 'green' },
    { label: 'Next tier', from: 5, to: 6, color: 'blue' },
    { label: 'Bottom three', from: 18, to: 20, color: 'red' },
  ],
};

export const BAND_BORDER: Record<BandColor, string> = {
  gold: 'border-l-gold-500',
  green: 'border-l-pitch-500',
  blue: 'border-l-sky-500',
  red: 'border-l-red-500',
  purple: 'border-l-purple-500',
};

/** The colour band for a final position, if any. */
export function bandFor(bands: TableBands | undefined, position: number) {
  const b = bands ?? DEFAULT_BANDS;
  return b.enabled ? b.bands.find((x) => position >= x.from && position <= x.to) : undefined;
}

export function useSite() {
  return useQuery({ queryKey: ['site'], queryFn: () => api<SiteInfo>('/api/site'), staleTime: 5 * 60_000 });
}

/** Sign-in style mutations: on success, refresh /me and reconnect the socket with the new cookie. */
export function useAuthMutation<I>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => api<{ user: MeView }>(path, { body: input }).then((r) => r.user),
    onSuccess: (user) => {
      qc.setQueryData(['me'], user);
      resetSocket();
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/auth/logout', { body: {} }),
    onSuccess: () => {
      qc.setQueryData(['me'], null);
      resetSocket();
    },
  });
}
