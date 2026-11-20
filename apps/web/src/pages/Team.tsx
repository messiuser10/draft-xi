/** Team page (spec section 10): XI with stats, form timeline, splits and season highlights. */
import type { SplitView, TeamPageView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { Pitch } from '../components/Pitch';
import { api } from '../lib/api';
import { lineupSlots } from '../lib/league';
import { usePool } from '../lib/pool';
import { TeamMark } from './Results';

const RESULT_STYLE = { W: 'bg-pitch-500 text-night-950', D: 'bg-slate-400 text-night-950', L: 'bg-red-500 text-white' } as const;

function Split({ title, s }: { title: string; s: SplitView }) {
  return (
    <div className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
      <p className="text-xs font-bold uppercase text-slate-500">{title}</p>
      <p className="display text-2xl tabular-nums">{s.points} pts</p>
      <p className="text-xs text-slate-500 tabular-nums">
        {s.won}W {s.drawn}D {s.lost}L · {s.goalsFor}-{s.goalsAgainst}
      </p>
    </div>
  );
}

export function TeamPage() {
  const params = useParams();
  const code = (params.code ?? '').toUpperCase();
  const teamId = params.teamId ?? '';
  const [search] = useSearchParams();
  const season = Number(search.get('season')) || null;
  const pool = usePool();
  const q = useQuery({
    queryKey: ['team', code, teamId, season],
    staleTime: Infinity,
    queryFn: () => api<TeamPageView>(`/api/games/${code}/teams/${teamId}${season ? `?season=${season}` : ''}`),
  });
  if (q.error) return <p className="card p-8 text-center">{q.error.message}</p>;
  if (!q.data) return <div className="card h-96 animate-pulse" aria-label="Loading team" />;
  const d = q.data;
  const byPlayer = new Map(d.players.map((p) => [p.slotKey, p]));
  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <TeamMark team={d.team} size="md" />
        <div className="min-w-0 flex-1">
          <p className="display text-pitch-500">
            Season {d.season} · {d.team.kind === 'human' ? 'Drafted team' : 'AI club'} · {d.team.formation}
          </p>
          <h1 className="display truncate text-4xl">{d.team.name}</h1>
          {d.finalRow ? (
            <p className="text-sm text-slate-500">
              Finished {d.finalRow.position} with {d.finalRow.points} points ({d.finalRow.won}W {d.finalRow.drawn}D {d.finalRow.lost}L, GD{' '}
              {d.finalRow.goalDifference > 0 ? '+' : ''}
              {d.finalRow.goalDifference})
            </p>
          ) : null}
        </div>
        <Link to={`/results/${code}?season=${d.season}`} className="btn-ghost">
          Results
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="card p-3">
          <Pitch
            label={`${d.team.name} XI`}
            slots={lineupSlots(d.team.lineup, pool.data, (s) => {
              const p = byPlayer.get(s.slotKey);
              if (!p) return undefined;
              return s.slotType === 'GK' ? `${p.cleanSheets} CS · ${p.avgRating.toFixed(1)}` : `${p.goals}G ${p.assists}A · ${p.avgRating.toFixed(1)}`;
            })}
          />
        </section>
        <section className="card overflow-x-auto p-4">
          <h2 className="display text-xl">Squad stats</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left">Pos</th>
                <th className="text-left">Player</th>
                <th>Apps</th>
                <th>G</th>
                <th>A</th>
                <th>CS</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {d.players.map((p) => (
                <tr key={p.slotKey} className="border-t border-slate-200 dark:border-white/5">
                  <td className="py-1 text-xs font-bold text-slate-500">{p.slotType}</td>
                  <td className="max-w-0 truncate">{p.reserve ? 'Academy Reserve' : p.name}</td>
                  <td className="text-center tabular-nums">{p.appearances}</td>
                  <td className="text-center tabular-nums">{p.goals}</td>
                  <td className="text-center tabular-nums">{p.assists}</td>
                  <td className="text-center tabular-nums">{p.cleanSheets}</td>
                  <td className="text-center tabular-nums">{p.avgRating ? p.avgRating.toFixed(2) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Split title="Home" s={d.home} />
        <Split title="Away" s={d.away} />
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
          <p className="text-xs font-bold uppercase text-slate-500">Biggest win</p>
          {d.biggestWin ? (
            <>
              <p className="display text-2xl tabular-nums">
                {d.biggestWin.goalsFor}-{d.biggestWin.goalsAgainst}
              </p>
              <p className="truncate text-xs text-slate-500">
                {d.biggestWin.home ? 'vs' : 'at'} {d.biggestWin.opponentName}, MD {d.biggestWin.matchday}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No wins</p>
          )}
        </div>
        <div className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
          <p className="text-xs font-bold uppercase text-slate-500">Unbeaten run · top scorer</p>
          <p className="display text-2xl tabular-nums">{d.longestUnbeaten} games</p>
          <p className="truncate text-xs text-slate-500">{d.topScorer ? `${d.topScorer.name}, ${d.topScorer.goals} goals` : 'No goals'}</p>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="display text-xl">Form timeline</h2>
        <ol className="mt-3 flex flex-wrap gap-1" aria-label="Results by matchday">
          {d.timeline.map((m) => (
            <li
              key={m.matchday}
              className={`grid size-9 place-items-center rounded-md text-xs font-bold ${RESULT_STYLE[m.result]}`}
              title={`MD ${m.matchday}: ${m.home ? 'vs' : 'at'} ${m.opponentName} ${m.goalsFor}-${m.goalsAgainst}, ${m.position} in the table`}
            >
              <span aria-label={`Matchday ${m.matchday}: ${m.result === 'W' ? 'win' : m.result === 'D' ? 'draw' : 'loss'} ${m.goalsFor}-${m.goalsAgainst} ${m.home ? 'vs' : 'at'} ${m.opponentName}`}>{m.result}</span>
            </li>
          ))}
        </ol>
        <PositionChart timeline={d.timeline} />
      </section>
    </div>
  );
}

/** League position after each matchday, 1 at the top. */
function PositionChart({ timeline }: { timeline: TeamPageView['timeline'] }) {
  if (timeline.length < 2) return null;
  const w = 760;
  const h = 160;
  const x = (i: number) => 20 + (i / (timeline.length - 1)) * (w - 40);
  const y = (pos: number) => 10 + ((pos - 1) / 19) * (h - 20);
  const d = timeline.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.position).toFixed(1)}`).join(' ');
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="League position by matchday">
        {[1, 5, 10, 15, 20].map((p) => (
          <g key={p}>
            <line x1={20} x2={w - 20} y1={y(p)} y2={y(p)} className="stroke-slate-300 dark:stroke-white/10" strokeDasharray="3 4" />
            <text x={0} y={y(p) + 4} className="fill-slate-500 text-[10px]">
              {p}
            </text>
          </g>
        ))}
        <path d={d} fill="none" className="stroke-pitch-500" strokeWidth={3} strokeLinejoin="round" />
      </svg>
      <figcaption className="text-xs text-slate-500">League position after each matchday</figcaption>
    </figure>
  );
}
