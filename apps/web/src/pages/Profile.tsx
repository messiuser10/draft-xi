/** Profile (spec section 10): games played, titles, average finish, best grade, trophy cabinet. */
import type { ProfileView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../lib/api';
import { useMe } from '../lib/session';
import { PageSkeleton } from '../components/Skeleton';
import { ErrorCard } from '../components/ErrorBoundary';

export function ProfilePage() {
  const userId = useParams().userId;
  const { data: me, isLoading } = useMe();
  const path = userId ? `/api/users/${userId}/profile` : '/api/profile';
  const q = useQuery({ queryKey: ['profile', userId ?? 'me'], enabled: Boolean(userId) || Boolean(me), queryFn: () => api<ProfileView>(path) });
  if (!userId && !isLoading && !me) {
    return (
      <div className="card p-8 text-center">
        <p>Sign in to see your profile.</p>
        <Link to="/login" className="btn-primary mt-4">
          Sign in
        </Link>
      </div>
    );
  }
  if (q.error) return <ErrorCard title="Could not load this page" message={q.error.message} />;
  if (!q.data) return <PageSkeleton label="Loading profile" />;
  const p = q.data;
  const stats: [string, string][] = [
    ['Games played', String(p.gamesPlayed)],
    ['Titles', String(p.titles)],
    ['Average finish', p.avgFinish === null ? '–' : p.avgFinish.toFixed(1)],
    ['Best draft grade', p.bestGrade ?? '–'],
  ];
  return (
    <div className="grid grid-cols-1 gap-4">
      <header>
        <p className="display text-pitch-500">{p.user.isGuest ? 'Guest manager' : 'Manager'}</p>
        <h1 className="display text-4xl">{p.user.displayName}</h1>
        {p.user.username ? <p className="text-sm text-slate-500">@{p.user.username}</p> : null}
      </header>
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
            <p className="display text-3xl tabular-nums">{value}</p>
          </div>
        ))}
      </section>
      <section className="card p-4">
        <h2 className="display text-xl text-gold-500">Trophy cabinet</h2>
        {p.trophies.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No titles yet. Every champion started somewhere.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {p.trophies.map((t) => (
              <li key={`${t.gameCode}-${t.seasonNumber}`}>
                <Link to={`/results/${t.gameCode}?season=${t.seasonNumber}`} className="flex items-center gap-3 rounded-xl bg-gold-500/10 p-3 hover:bg-gold-500/20">
                  <span className="text-3xl" aria-hidden>
                    🏆
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{t.teamName}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.gameName}, season {t.seasonNumber} · {t.points} pts
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-4">
        <h2 className="display text-xl">Games</h2>
        {p.games.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No games yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200 dark:divide-white/5">
            {p.games.map((g) => (
              <li key={g.gameCode}>
                <Link
                  to={g.status === 'completed' ? `/results/${g.gameCode}` : g.status === 'lobby' ? `/lobby/${g.gameCode}` : `/draft/${g.gameCode}`}
                  className="flex flex-wrap items-center gap-x-3 py-2 hover:opacity-80"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{g.gameName}</span>
                  <span className="text-sm text-slate-500">{g.teamName}</span>
                  <span className="text-sm tabular-nums">{g.finish ? `${g.finish}${g.grade ? ` · ${g.grade}` : ''}` : g.status.replace('_', ' ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
