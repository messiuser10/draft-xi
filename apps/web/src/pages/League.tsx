/** League Teams (spec section 10): all 20 teams by strength, each with its XI. */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ClubShield } from '../components/Kickoff';
import { Pitch } from '../components/Pitch';
import { TeamBadge } from '../components/TeamBadge';
import { lineupSlots, teamLabel, useLeague } from '../lib/league';
import { usePool } from '../lib/pool';
import { useGame } from '../lib/socket';

export function LeaguePage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot } = useGame(code);
  const league = useLeague(code, `${snapshot?.game.status}:${snapshot?.draft?.picks.length}:${snapshot?.seasons.length}`);
  const pool = usePool();
  const [open, setOpen] = useState<string | null>(null);
  if (league.error) return <p className="card p-8 text-center">{league.error.message}</p>;
  if (!league.data) return <div className="card h-96 animate-pulse" />;
  const back = snapshot?.game.status === 'completed' ? `/season/${code}` : `/draft/${code}`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="display text-pitch-500">{snapshot?.game.name}</p>
          <h1 className="display text-4xl">League Teams</h1>
          <p className="text-sm text-slate-500">
            {league.data.source === 'draft' ? 'Live from the draft: empty slots count as Academy Reserves.' : 'The teams as they play this season.'}
          </p>
        </div>
        <Link to={back} className="btn-secondary">
          Back
        </Link>
      </header>
      <ol className="grid gap-2">
        {league.data.teams.map((t) => (
          <li key={t.id} className="card overflow-hidden">
            <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen((o) => (o === t.id ? null : t.id))} aria-expanded={open === t.id}>
              <span className="w-6 text-right tabular-nums text-slate-500">{t.rank}</span>
              {t.kind === 'human' ? <TeamBadge color={t.primaryColor} monogram={t.monogram} size="sm" /> : <ClubShield primary={t.primaryColor} secondary={t.secondaryColor} text={t.monogram} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t.name}</span>
                <span className="block text-xs text-slate-500">
                  {t.formation} · ATT {t.attack.toFixed(1)} · DEF {t.defense.toFixed(1)} · CHEM +{t.chemistry.toFixed(2)}
                </span>
              </span>
              <span className={`rounded-full px-2 text-xs font-bold ${t.kind === 'human' ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 dark:bg-night-700'}`}>{teamLabel(t)}</span>
              <span className="w-12 text-right font-bold tabular-nums">{t.strength.toFixed(1)}</span>
            </button>
            {open === t.id ? (
              <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] dark:border-white/5">
                <Pitch slots={lineupSlots(t.lineup, pool.data)} compact label={`${t.name} XI`} />
                <ul className="grid content-start gap-1 text-sm">
                  {t.lineup.map((s) => (
                    <li key={s.slotKey} className="flex gap-2">
                      <span className="w-10 text-xs font-bold text-slate-500">{s.slotType}</span>
                      <span className="flex-1 truncate">{s.reserve ? 'Academy Reserve' : s.name}</span>
                      {s.outOfPosition ? <span className="text-xs text-gold-500">out of position</span> : null}
                      <span className="tabular-nums">{s.effectiveOverall}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
