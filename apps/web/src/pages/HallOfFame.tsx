/** Hall of Fame, leaderboard and record book (spec section 10). */
import type { HallOfFameEntry, LeaderboardRow, RecordBookView, RecordEntry } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api';

export function useHallOfFame() {
  return useQuery({ queryKey: ['hall-of-fame'], queryFn: () => api<{ entries: HallOfFameEntry[] }>('/api/hall-of-fame').then((r) => r.entries) });
}

export function HallOfFamePage() {
  const fame = useHallOfFame();
  const records = useQuery({ queryKey: ['records'], queryFn: () => api<RecordBookView>('/api/records') });
  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <h1 className="display flex-1 text-4xl text-gold-500">Hall of Fame</h1>
        <Link to="/leaderboard" className="btn-ghost">
          Leaderboard
        </Link>
      </header>
      <section className="card p-4">
        <h2 className="display text-xl">Record book</h2>
        {records.data ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <Record title="Most points in a season" r={records.data.mostPoints} />
            <Record title="Most goals by a drafted player" r={records.data.mostGoalsByDrafted} />
            <Record title="Best goal difference" r={records.data.bestGoalDifference} />
          </div>
        ) : (
          <div className="mt-3 h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-night-700" />
        )}
      </section>
      <section className="card p-4">
        <h2 className="display text-xl">Champions</h2>
        {fame.isLoading ? (
          <div className="mt-3 h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-night-700" />
        ) : !fame.data?.length ? (
          <p className="mt-2 text-sm text-slate-500">No finished games yet. Play one and be the first name here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-200 dark:divide-white/5">
            {fame.data.map((e) => (
              <li key={e.gameCode}>
                <Link to={`/results/${e.gameCode}?season=1`} className="flex flex-wrap items-center gap-x-3 py-2 hover:opacity-80">
                  <span aria-hidden>🏆</span>
                  <span className={`font-semibold ${e.championIsHuman ? 'text-pitch-600 dark:text-pitch-400' : ''}`}>{e.championName}</span>
                  <span className="text-sm text-slate-500">
                    {e.managerName ? `managed by ${e.managerName}` : 'AI club'} · {e.gameName}
                  </span>
                  <span className="ml-auto text-sm tabular-nums">{e.points} pts</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Record({ title, r }: { title: string; r: RecordEntry | null }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
      <p className="text-xs font-bold uppercase text-slate-500">{title}</p>
      {r ? (
        <Link to={`/results/${r.gameCode}?season=${r.seasonNumber}`} className="hover:underline">
          <p className="display text-2xl">{r.label}</p>
          <p className="truncate text-xs text-slate-500">
            {r.teamName} · {r.gameName}, season {r.seasonNumber}
          </p>
        </Link>
      ) : (
        <p className="mt-1 text-sm text-slate-500">No record yet</p>
      )}
    </div>
  );
}

export function LeaderboardPage() {
  const q = useQuery({ queryKey: ['leaderboard'], queryFn: () => api<{ rows: LeaderboardRow[] }>('/api/leaderboard').then((r) => r.rows) });
  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <h1 className="display flex-1 text-4xl">Leaderboard</h1>
        <Link to="/hall-of-fame" className="btn-ghost">
          Hall of Fame
        </Link>
      </header>
      <section className="card overflow-x-auto p-4">
        <p className="text-sm text-slate-500">Ranked by titles, then average finish, over every season played.</p>
        {q.isLoading ? (
          <div className="mt-3 h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-night-700" />
        ) : !q.data?.length ? (
          <p className="mt-2 text-sm text-slate-500">Nobody has finished a season yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="w-8 text-left">#</th>
                <th className="text-left">Manager</th>
                <th>Titles</th>
                <th>Seasons</th>
                <th>Avg finish</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r, i) => (
                <tr key={r.userId} className="border-t border-slate-200 dark:border-white/5">
                  <td className="py-1 tabular-nums">{i + 1}</td>
                  <td className="max-w-0 truncate">
                    <Link to={`/profile/${r.userId}`} className="hover:underline">
                      {r.displayName}
                    </Link>
                  </td>
                  <td className="text-center tabular-nums">{r.titles}</td>
                  <td className="text-center tabular-nums">{r.seasons}</td>
                  <td className="text-center tabular-nums">{r.avgFinish.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
