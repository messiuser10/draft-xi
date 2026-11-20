import type { MeView } from '@draft-xi/server/contracts';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from './session';

/** Renders children with the signed-in user (account or guest), or sends them to /login first. */
export function RequireSession({ children }: { children: (me: MeView) => ReactNode }) {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <div className="card h-40 animate-pulse" />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children(me)}</>;
}
