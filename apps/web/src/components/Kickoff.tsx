/** Kickoff screen (spec section 7, step 4): AI clubs that made it, those that missed, the drafters. */
import type { ClubStrengthView, GameSnapshot } from '@draft-xi/server/contracts';
import { TeamBadge, textOn } from './TeamBadge';

/** Short names such as "REAL MADRID" do not fit a small badge: use initials instead. */
export function badgeText(short: string): string {
  if (short.length <= 4) return short;
  const words = short.split(/[\s-]+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 3) : short.slice(0, 3);
}

const SHIELD_SIZE = { sm: 'size-7 text-[9px]', md: 'size-8 text-[10px]', lg: 'size-14 text-sm', xl: 'size-24 text-xl sm:size-32 sm:text-2xl' } as const;

export function ClubShield({ primary, secondary, text, size = 'md' }: { primary: string; secondary: string; text: string; size?: keyof typeof SHIELD_SIZE }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full display ${SHIELD_SIZE[size]}`}
      style={{ backgroundColor: primary, color: textOn(primary), boxShadow: `inset 0 0 0 ${size === 'xl' ? 6 : size === 'lg' ? 4 : 3}px ${secondary}` }}
      aria-hidden
    >
      {badgeText(text)}
    </span>
  );
}

function ClubRow({ club, inLeague }: { club: ClubStrengthView; inLeague: boolean }) {
  return (
    <li className={`flex items-center gap-3 rounded-xl px-3 py-2 ${inLeague ? 'bg-slate-100 dark:bg-night-900' : 'opacity-60'}`}>
      <span className="w-6 text-right text-sm tabular-nums text-slate-500">{club.rank}</span>
      <ClubShield primary={club.primaryColor} secondary={club.secondaryColor} text={club.shortName} />
      <span className="flex-1 truncate">{club.clubName}</span>
      <span className="tabular-nums text-sm font-semibold">{club.rating.toFixed(1)}</span>
    </li>
  );
}

export function Kickoff({ snapshot }: { snapshot: GameSnapshot }) {
  const { kickoff, participants, game } = snapshot;
  const ai = new Set(kickoff?.aiClubIds ?? []);
  const strengths = kickoff?.strengths ?? [];
  const inLeague = strengths.filter((c) => ai.has(c.clubId));
  const missed = strengths.filter((c) => !ai.has(c.clubId));
  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <p className="display text-pitch-500">Kickoff · draft open</p>
        <h1 className="display text-4xl">{game.name}</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {participants.length} drafted {participants.length === 1 ? 'team' : 'teams'} and {inLeague.length} AI clubs make a
          20-team league. Players from every club stay draftable.
        </p>
      </header>

      <section>
        <h2 className="display text-xl">Drafting teams · pick order</h2>
        <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {participants.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-100 px-3 py-2 dark:bg-night-900">
              <span className="w-5 text-sm tabular-nums text-slate-500">{p.pickOrder}</span>
              <TeamBadge color={p.color} monogram={p.monogram} size="sm" />
              <span className="flex-1 truncate font-semibold">{p.teamName}</span>
              <span className="text-xs text-slate-500">{p.formation}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section>
          <h2 className="display text-xl">AI clubs in the league</h2>
          <ul className="mt-3 grid gap-1">
            {inLeague.map((c) => (
              <ClubRow key={c.clubId} club={c} inLeague />
            ))}
          </ul>
        </section>
        <section>
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
    </div>
  );
}
