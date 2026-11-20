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
      <section className="relative overflow-hidden rounded-3xl bg-night-950 px-6 py-12 text-white shadow-2xl ring-1 ring-white/10 sm:px-10 lg:py-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, #16a34a 0 60px, #15803d 60px 120px)' }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-night-950 via-night-950/85 to-night-950/20" aria-hidden />
        <PitchArt />
        <div className="relative max-w-xl">
          <p className="display text-pitch-400">Draft. Spin. Simulate. Lift the trophy.</p>
          <h1 className="display mt-2 text-5xl leading-none sm:text-7xl">{site?.leagueName ?? 'Draft XI League'}</h1>
          <p className="mt-4 text-slate-300">
            Spin the wheel, draft a starting XI from 20 of the world&apos;s biggest clubs, then watch a full 38-matchday season
            against the strongest AI clubs.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-semibold" aria-label="At a glance">
            {['20 clubs', '600+ real players', '38 matchdays', 'Club spin every pick'].map((t) => (
              <li key={t} className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15 backdrop-blur">
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/create" className="btn-primary px-6">
              Create game
            </Link>
            <Link to="/solo" className="btn bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20">
              Play solo vs AI
            </Link>
          </div>
          <form onSubmit={join} className="mt-6 flex max-w-sm gap-2">
            <label htmlFor="join-code" className="sr-only">
              Game code
            </label>
            <input
              id="join-code"
              className="input font-mono tracking-[0.3em] uppercase dark:bg-night-900/80"
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
          ['🎡', 'Spin and draft', 'A wheel picks a club before every pick. Take one of its players for an open slot in your formation.'],
          ['⚽', 'Simulate', 'Your XI joins the strongest real clubs in a 20-team league: 38 matchdays, 380 matches.'],
          ['🏆', 'Celebrate', 'Follow the table matchday by matchday, or skip to the end, then see awards, grades and the champion.'],
        ].map(([icon, title, text], i) => (
          <div key={title} className="card card-hover animate-reveal p-5" style={{ animationDelay: `${i * 80}ms` }}>
            <span className="grid size-11 place-items-center rounded-xl bg-pitch-500/15 text-2xl" aria-hidden>
              {icon}
            </span>
            <h2 className="display mt-3 text-xl">
              <span className="text-pitch-500">{i + 1}.</span> {title}
            </h2>
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
                <Link to={`/lobby/${l.code}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-slate-100 dark:hover:bg-night-700/60">
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
                <Link to={`/results/${e.gameCode}?season=1`} className="block rounded-xl bg-gold-500/10 p-3 ring-1 ring-gold-500/20 transition hover:-translate-y-0.5 hover:bg-gold-500/20">
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

/** Decorative pitch markings with a 4-3-3 of dots, shown beside the hero text on wide screens. */
function PitchArt() {
  const dots: [number, number][] = [
    [50, 88], [18, 70], [38, 74], [62, 74], [82, 70], [30, 50], [50, 54], [70, 50], [22, 26], [50, 20], [78, 26],
  ];
  return (
    <svg className="pointer-events-none absolute top-1/2 right-6 hidden h-[115%] -translate-y-1/2 opacity-60 lg:block" viewBox="0 0 100 130" aria-hidden>
      <g fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="0.6">
        <rect x="4" y="4" width="92" height="122" rx="1" />
        <line x1="4" y1="65" x2="96" y2="65" />
        <circle cx="50" cy="65" r="11" />
        <rect x="26" y="4" width="48" height="18" />
        <rect x="38" y="4" width="24" height="7" />
        <rect x="26" y="108" width="48" height="18" />
        <rect x="38" y="119" width="24" height="7" />
      </g>
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y + 8} r="3.4" fill="#22c55e" stroke="#070c16" strokeWidth="1" className="animate-reveal" style={{ animationDelay: `${300 + i * 60}ms` }} />
      ))}
    </svg>
  );
}
