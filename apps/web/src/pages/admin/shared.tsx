/** Admin panel shell (spec section 11): tab navigation, admin-only guard and small helpers. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { useMe } from '../../lib/session';
import { useToasts } from '../../lib/socket';

const TABS = [
  ['', 'Overview'],
  ['players', 'Players'],
  ['clubs', 'Clubs'],
  ['games', 'Games'],
  ['settings', 'Settings'],
  ['lab', 'Simulation Lab'],
  ['users', 'Users'],
  ['audit', 'Audit Log'],
  ['announcements', 'Announcements'],
] as const;

export function AdminLayout() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <div className="card h-64 animate-pulse" />;
  if (me?.role !== 'admin') {
    return (
      <div className="card p-8 text-center">
        <h1 className="display text-3xl">Admins only</h1>
        <p className="mt-2 text-slate-500">You need an admin account to open this page.</p>
        <Link to="/" className="btn-secondary mt-4">
          Back home
        </Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      <header>
        <p className="display text-pitch-500">Admin</p>
        <nav className="mt-2 flex gap-1 overflow-x-auto pb-1" aria-label="Admin sections">
          {TABS.map(([path, label]) => (
            <NavLink
              key={path}
              to={`/admin${path ? `/${path}` : ''}`}
              end={path === ''}
              className={({ isActive }) =>
                `shrink-0 rounded-xl px-3 py-2 text-sm font-semibold ${isActive ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 hover:bg-slate-300 dark:bg-night-700 dark:hover:bg-night-900'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export function useAdminQuery<T>(key: unknown[], path: string, enabled = true) {
  return useQuery({ queryKey: ['admin', ...key], enabled, queryFn: () => api<T>(path) });
}

/** A mutation that toasts errors (and an optional success message) and refreshes admin queries. */
export function useAdminMutation<I, O = unknown>(fn: (input: I) => Promise<O>, success?: string | ((o: O) => string)) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      if (success) push(typeof success === 'string' ? success : success(out));
    },
    onError: (err) => push(errorMessage(err)),
  });
}

export const send = <T,>(path: string, method: string, body?: unknown) => api<T>(path, { method, body: body ?? {} });

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="display flex-1 text-xl">{title}</h2>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Loading() {
  return <div className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-night-700" aria-label="Loading" />;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
