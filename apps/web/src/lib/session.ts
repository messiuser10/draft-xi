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
