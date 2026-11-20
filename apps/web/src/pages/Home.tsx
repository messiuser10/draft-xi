import type { PublicLobbyView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useSite } from '../lib/session';
import { useHallOfFame } from './HallOfFame';

export function HomePage() {
  const navigate = useNavigate();
  const { data: site } = useSite();
  const [code, setCode] = useState('');
  const lobbies = useQuery({
    queryKey: ['public-lobbies'],
    queryFn: () => api<{ lobbies: PublicLobbyView[] }>('/api/games/public').then((r) => r.lobbies),
    refetchInterval: 10_000,
  });

  const fame = useHallOfFame();
  const join = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(clean)) void navigate(`/lobby/${clean}`);
  };

  return (
    <div className="grid grid-cols-1 gap-8">
      <section className="relative overflow-hidden rounded-3xl bg-night-950 px-6 py-12 text-white shadow-2xl sm:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, #16a34a 0 60px, #15803d 60px 120px)' }}
          aria-hidden
        />
        <div className="relative max-w-xl">
          <p className="display text-pitch-400">Draft. Simulate. Lift the trophy.</p>
          <h1 className="display mt-2 text-5xl leading-none sm:text-7xl">{site?.leagueName ?? 'Draft XI League'}</h1>
          <p className="mt-4 text-slate-300">
            Draft a starting XI from 20 of the world&apos;s biggest clubs, then watch a full 38-matchday season against the
            strongest AI clubs.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/create" className="btn-primary">
              Create game
            </Link>
            <Link to="/solo" className="btn-secondary">
              Play solo vs AI
            </Link>
          </div>
          <form onSubmit={join} className="mt-6 flex max-w-sm gap-2">
            <label htmlFor="join-code" className="sr-only">
              Game code
            </label>
            <input
              id="join-code"
              className="input font-mono tracking-[0.3em] uppercase"
              placeholder="CODE"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className="btn-secondary" disabled={!/^[A-Za-z0-9]{6}$/.test(code.trim())}>
              Join
            </button>
          </form>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['1. Draft', 'Take turns picking real players into the slots of your formation. Each player can only be drafted once.'],
          ['2. Simulate', 'Your XI joins the strongest real clubs in a 20-team league: 38 matchdays, 380 matches.'],
          ['3. Celebrate', 'Follow the table matchday by matchday, then see awards, grades and who lifts the trophy.'],
        ].map(([title, text]) => (
          <div key={title} className="card p-5">
            <h2 className="display text-xl text-pitch-500">{title}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{text}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="display text-2xl">Open lobbies</h2>
        {lobbies.isLoading ? (
          <div className="mt-3 h-12 animate-pulse rounded-xl bg-slate-200 dark:bg-night-700" />
        ) : !lobbies.data?.length ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            No public lobbies right now. Create one and invite your friends.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 dark:divide-white/5">
            {lobbies.data.map((l) => (
              <li key={l.code}>
                <Link to={`/lobby/${l.code}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                  <span className="font-semibold">{l.name}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">hosted by {l.hostName}</span>
                  <span className="ml-auto text-sm tabular-nums">
                    {l.teams}/{l.maxHumans}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-3">
          <h2 className="display flex-1 text-2xl text-gold-500">Hall of Fame</h2>
          <Link to="/leaderboard" className="btn-ghost text-sm">
            Leaderboard
          </Link>
          <Link to="/hall-of-fame" className="btn-ghost text-sm">
            See all
          </Link>
        </div>
        {!fame.data?.length ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Champions appear here once the first season is played.</p>
        ) : (
          <ul className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
            {fame.data.slice(0, 8).map((e) => (
              <li key={e.gameCode} className="w-48 shrink-0 snap-start">
                <Link to={`/results/${e.gameCode}?season=1`} className="block rounded-xl bg-gold-500/10 p-3 hover:bg-gold-500/20">
                  <span className="block truncate font-semibold">🏆 {e.championName}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {e.managerName ?? 'AI club'} · {e.points} pts
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
