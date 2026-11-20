/**
 * M2: the kickoff screen shown when the draft starts (spec section 7, step 4). The draft room
 * itself arrives in M3 on this same route.
 */
import type { ClubStrengthView, GameSnapshot } from '@draft-xi/server/contracts';
import { Link, Navigate, useParams } from 'react-router';
import { TeamBadge, textOn } from '../components/TeamBadge';
import { useGame } from '../lib/socket';

export function DraftPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot, error } = useGame(code);
  if (error) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="display text-3xl">Game not found</p>
        <p className="mt-2 text-slate-500">{error}</p>
        <Link to="/" className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    );
  }
  if (!snapshot) return <div className="card h-96 animate-pulse" />;
  if (snapshot.game.status === 'lobby') return <Navigate to={`/lobby/${code}`} replace />;
  return <Kickoff snapshot={snapshot} />;
}

/** Short names such as "REAL MADRID" do not fit a small badge: use initials instead. */
function badgeText(short: string): string {
  if (short.length <= 4) return short;
  const words = short.split(/[\s-]+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 3) : short.slice(0, 3);
}

function ClubRow({ club, inLeague }: { club: ClubStrengthView; inLeague: boolean }) {
  return (
    <li className={`flex items-center gap-3 rounded-xl px-3 py-2 ${inLeague ? 'bg-slate-100 dark:bg-night-900' : 'opacity-60'}`}>
      <span className="w-6 text-right text-sm tabular-nums text-slate-500">{club.rank}</span>
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full display text-[10px]"
        style={{ backgroundColor: club.primaryColor, color: textOn(club.primaryColor), boxShadow: `inset 0 0 0 3px ${club.secondaryColor}` }}
        aria-hidden
      >
        {badgeText(club.shortName)}
      </span>
      <span className="flex-1 truncate">{club.clubName}</span>
      <span className="tabular-nums text-sm font-semibold">{club.rating.toFixed(1)}</span>
    </li>
  );
}

function Kickoff({ snapshot }: { snapshot: GameSnapshot }) {
  const { kickoff, participants, game } = snapshot;
  const ai = new Set(kickoff?.aiClubIds ?? []);
  const strengths = kickoff?.strengths ?? [];
  const inLeague = strengths.filter((c) => ai.has(c.clubId));
  const missed = strengths.filter((c) => !ai.has(c.clubId));
  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <p className="display text-pitch-500">Kickoff · {game.status === 'cancelled' ? 'cancelled' : 'draft open'}</p>
        <h1 className="display text-4xl">{game.name}</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {participants.length} drafted {participants.length === 1 ? 'team' : 'teams'} and {inLeague.length} AI clubs make a
          20-team league. Players from every club stay draftable.
        </p>
      </header>

      <section className="card p-5">
        <h2 className="display text-xl">Drafting teams · pick order</h2>
        <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-100 px-3 py-2 dark:bg-night-900">
              <span className="w-5 text-sm tabular-nums text-slate-500">{p.pickOrder}</span>
              <TeamBadge color={p.color} monogram={p.monogram} size="sm" />
              <span className="flex-1 truncate font-semibold">{p.teamName}</span>
              <span className="text-xs text-slate-500">{p.formation}</span>
              {game.currentParticipantId === p.id ? <span className="rounded-full bg-pitch-500 px-2 text-xs font-bold text-night-950">On the clock</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="display text-xl">AI clubs in the league</h2>
          <ul className="mt-3 grid gap-1">
            {inLeague.map((c) => (
              <ClubRow key={c.clubId} club={c} inLeague />
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="display text-xl">Missed the cut</h2>
          {missed.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Every club made it.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Their players can still be drafted.</p>
              <ul className="mt-3 grid gap-1">
                {missed.map((c) => (
                  <ClubRow key={c.clubId} club={c} inLeague={false} />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <p className="card p-5 text-center text-slate-500 dark:text-slate-400">The draft room opens here in the next update (M3).</p>
    </div>
  );
}
