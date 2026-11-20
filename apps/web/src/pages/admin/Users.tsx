/** Admin Users tab: search, promote or demote, ban or unban, see a user's games, delete a user's data. */
import type { AdminGameView, AdminUserView } from '@draft-xi/server/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { watchPath } from './Games';
import { fmtDate, Loading, Section, send, useAdminMutation, useAdminQuery } from './shared';

export function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState(false);
  const qs = new URLSearchParams({ includeGuests: guests ? 'true' : '' });
  if (search.trim()) qs.set('search', search.trim());
  const q = useAdminQuery<{ users: AdminUserView[] }>(['users', qs.toString()], `/api/admin/users?${qs.toString()}`);
  return (
    <Section title="Users">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name or username" aria-label="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} /> Include guests
        </label>
      </div>
      {!q.data ? (
        <div className="mt-3">
          <Loading />
        </div>
      ) : (
        <ul className="mt-3 grid gap-2">
          {q.data.users.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function UserRow({ user: u }: { user: AdminUserView }) {
  const [open, setOpen] = useState(false);
  const games = useAdminQuery<{ games: AdminGameView[] }>(['user-games', u.id], `/api/admin/users/${u.id}/games`, open);
  const role = useAdminMutation(() => send(`/api/admin/users/${u.id}/role`, 'PATCH', { role: u.role === 'admin' ? 'user' : 'admin' }), u.role === 'admin' ? `${u.displayName} is no longer an admin` : `${u.displayName} is now an admin`);
  const ban = useAdminMutation(() => send(`/api/admin/users/${u.id}/ban`, 'POST', { banned: !u.banned }), u.banned ? `${u.displayName} unbanned` : `${u.displayName} banned`);
  const del = useAdminMutation(() => send(`/api/admin/users/${u.id}`, 'DELETE'), `${u.displayName} deleted`);
  return (
    <li className="rounded-xl bg-slate-100 dark:bg-night-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{u.displayName}</span> {u.username ? <span className="text-slate-500">@{u.username}</span> : null}
          {u.role === 'admin' ? <span className="ml-1 rounded bg-gold-500 px-1 text-xs font-bold text-night-950">ADMIN</span> : null}
          {u.isGuest ? <span className="ml-1 rounded bg-slate-300 px-1 text-xs dark:bg-night-700">guest</span> : null}
          {u.banned ? <span className="ml-1 rounded bg-red-500 px-1 text-xs font-bold text-white">BANNED</span> : null}
          <span className="block text-xs text-slate-500">
            {u.games} games · joined {fmtDate(u.createdAt)}
          </span>
        </span>
        <Link to={`/profile/${u.id}`} className="btn-ghost min-h-8 px-2 text-xs">
          Profile
        </Link>
        <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Games
        </button>
        {!u.isGuest ? (
          <button type="button" className="btn-ghost min-h-8 px-2 text-xs" disabled={role.isPending} onClick={() => role.mutate(undefined)}>
            {u.role === 'admin' ? 'Demote' : 'Make admin'}
          </button>
        ) : null}
        <button type="button" className="btn-ghost min-h-8 px-2 text-xs" disabled={ban.isPending} onClick={() => ban.mutate(undefined)}>
          {u.banned ? 'Unban' : 'Ban'}
        </button>
        <button
          type="button"
          className="btn-danger min-h-8 px-2 text-xs"
          onClick={() => {
            if (window.confirm(`Delete ${u.displayName}'s account, sessions and chat messages? Their finished teams stay in old games. This cannot be undone.`)) del.mutate(undefined);
          }}
        >
          Delete
        </button>
      </div>
      {open ? (
        <div className="border-t border-slate-200 p-2 text-sm dark:border-white/5">
          {!games.data ? (
            <Loading />
          ) : games.data.games.length === 0 ? (
            <p className="text-slate-500">No games.</p>
          ) : (
            <ul>
              {games.data.games.map((g) => (
                <li key={g.id}>
                  <Link to={watchPath(g)} className="hover:underline">
                    {g.code} · {g.name} · {g.status.replace('_', ' ')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
