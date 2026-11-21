/** Team Reveal (spec section 8): each drafted XI one at a time, then the ranked 20-team league. */
import { draftGrade } from '@draft-xi/engine';
import type { GameSnapshot, LeagueTeamView } from '@draft-xi/server/contracts';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ClubShield } from '../components/Kickoff';
import { Pitch } from '../components/Pitch';
import { SeriesLeaderboard, SquadManager } from '../components/Round';
import { TeamBadge } from '../components/TeamBadge';
import { useAction } from '../lib/actions';
import { lineupSlots, useLeague } from '../lib/league';
import { usePool } from '../lib/pool';
import { useGame } from '../lib/socket';
import { PageSkeleton } from '../components/Skeleton';
import { ErrorCard } from '../components/ErrorBoundary';

const REVEAL_MS = 2500;

export function RevealPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot, error } = useGame(code);
  if (error) return <ErrorCard title="Could not load this page" message={error} />;
  if (!snapshot) return <PageSkeleton />;
  const { status } = snapshot.game;
  if (status === 'lobby') return <Navigate to={`/lobby/${code}`} replace />;
  if (status === 'drafting' || status === 'paused') return <Navigate to={`/draft/${code}`} replace />;
  if (status === 'simulating' || status === 'completed') return <Navigate to={`/season/${code}`} replace />;
  return <Reveal snapshot={snapshot} />;
}

function Reveal({ snapshot }: { snapshot: GameSnapshot }) {
  const code = snapshot.game.code;
  const league = useLeague(code, `${snapshot.draft?.picks.length}:${snapshot.round?.moves.length ?? 0}:${JSON.stringify(snapshot.round?.captains ?? {})}`);
  const pool = usePool();
  const { run, busy } = useAction();
  const humans = (league.data?.teams ?? []).filter((t) => t.kind === 'human');
  // Reveal in pick order.
  const order = snapshot.participants.flatMap((p) => humans.find((h) => h.participantId === p.id) ?? []);
  const [shown, setShown] = useState(1);
  /** Start the season; with `skip`, open it on the final table instead of matchday 1. */
  const startSeason = async (skip: boolean) => {
    if (skip) {
      try {
        sessionStorage.setItem(`skip:${code}`, '1');
      } catch {
        /* storage unavailable */
      }
    }
    if (!(await run(`/api/games/${code}/season`))) return;
    if (skip && snapshot.game.settings.playbackMode === 'synchronized') await run(`/api/games/${code}/playback`, 'POST', { action: 'end' });
  };
  const all = shown >= order.length;
  useEffect(() => {
    if (all || order.length === 0) return;
    const id = setTimeout(() => setShown((n) => n + 1), REVEAL_MS);
    return () => clearTimeout(id);
  }, [shown, all, order.length]);

  if (league.isLoading || !league.data) return <PageSkeleton label="Loading teams" />;

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="display text-pitch-500">Round {snapshot.round?.roundNumber ?? 1} · draft complete</p>
          <h1 className="display text-4xl">Team Reveal</h1>
        </div>
        {!all ? (
          <button type="button" className="btn-secondary" onClick={() => setShown(order.length)}>
            Reveal all
          </button>
        ) : null}
        {snapshot.me.isHost || snapshot.me.isAdmin ? (
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void startSeason(true)}>
              ⏭ Simulate to the end
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void startSeason(false)}>
              {busy ? 'Simulating…' : 'Start Season'}
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-500">Waiting for the host to start the season.</p>
        )}
      </header>

      {snapshot.round && pool.data && snapshot.me.participantId !== null ? (
        <section aria-labelledby="preseason-title">
          <h2 id="preseason-title" className="display text-2xl">
            Before kickoff: captain and trades
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Pick a captain (or the best player is picked for you) and swap players with other teams. Transfers open after matchday 19.
          </p>
          <SquadManager snapshot={snapshot} pool={pool.data} round={snapshot.round} />
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {order.slice(0, shown).map((team) => (
          <RevealCard key={team.id} team={team} pitch={lineupSlots(team.lineup, pool.data)} />
        ))}
      </div>

      {all ? (
        <section className="card animate-reveal p-5">
          <h2 className="display text-2xl">League preview</h2>
          <p className="text-sm text-slate-500">All 20 teams ranked by strength (average of attack and defense).</p>
          <ol className="mt-3 grid gap-1">
            {league.data.teams.map((t) => (
              <li key={t.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${t.kind === 'human' ? 'bg-pitch-500/15 ring-1 ring-pitch-500' : 'bg-slate-100 dark:bg-night-900'}`}>
                <span className="w-6 text-right text-sm tabular-nums text-slate-500">{t.rank}</span>
                {t.kind === 'human' ? <TeamBadge color={t.primaryColor} monogram={t.monogram} size="sm" /> : <ClubShield primary={t.primaryColor} secondary={t.secondaryColor} text={t.monogram} />}
                <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                <span className="hidden text-xs text-slate-500 sm:inline">
                  ATT {t.attack.toFixed(1)} · DEF {t.defense.toFixed(1)} · CHEM +{t.chemistry.toFixed(2)}
                </span>
                <span className="w-12 text-right tabular-nums font-bold">{t.strength.toFixed(1)}</span>
              </li>
            ))}
          </ol>
          <Link to={`/league/${code}`} className="btn-ghost mt-3">
            Open the League Teams page
          </Link>
        </section>
      ) : null}
      {(snapshot.round?.roundNumber ?? 1) > 1 ? <SeriesLeaderboard code={code} refreshKey="reveal" /> : null}
    </div>
  );
}

function RevealCard({ team, pitch }: { team: LeagueTeamView; pitch: ReturnType<typeof lineupSlots> }) {
  const grade = draftGrade(team.rank);
  return (
    <section className="card animate-reveal p-4">
      <div className="flex items-center gap-2">
        <TeamBadge color={team.primaryColor} monogram={team.monogram} />
        <div className="min-w-0 flex-1">
          <h2 className="display truncate text-2xl">{team.name}</h2>
          <p className="text-xs text-slate-500">
            {team.formation} · strength rank {team.rank} of 20
          </p>
        </div>
        <div className="text-center" title="Draft grade preview, from pre-season strength rank">
          <p className="display text-4xl text-gold-500">{grade.grade}</p>
          <p className="text-[10px] uppercase text-slate-500">Grade preview</p>
        </div>
      </div>
      <div className="mt-3">
        <Pitch slots={pitch} compact label={`${team.name} XI`} />
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-1 text-center text-sm">
        {[
          ['Rating', team.overall.toFixed(1)],
          ['Attack', team.attack.toFixed(1)],
          ['Defense', team.defense.toFixed(1)],
          ['Chem', `+${team.chemistry.toFixed(2)}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-100 p-1 dark:bg-night-900">
            <dt className="text-[10px] uppercase text-slate-500">{k}</dt>
            <dd className="font-bold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
