/**
 * Club Spin: before each pick a reel of club badges spins and lands on the club the team on the
 * clock must draft from. The server decides the club; this only animates towards it. A rare
 * golden spin lands on a gold star (any club), and each team may re-spin once per draft.
 */
import type { SpinView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PoolData } from '../lib/pool';
import { play } from '../lib/sound';
import { ClubShield } from './Kickoff';

const ITEM = 76; // px per reel cell
const LAPS = 5;

/** `respinsLeft` of the team on the clock is in the key, so a re-spin fetches the new club. */
export function useSpin(code: string, pickNumber: number, enabled: boolean, respinsLeft = 0) {
  return useQuery({
    queryKey: ['spin', code, pickNumber, respinsLeft],
    queryFn: () => api<{ spin: SpinView | null }>(`/api/games/${code}/spin`).then((r) => r.spin),
    enabled,
    staleTime: Infinity,
  });
}

/** Identifies one spin of one pick (a re-spin is a new one). */
export const spinKey = (spin: Pick<SpinView, 'pickNumber' | 'respun'>) => `${spin.pickNumber}:${spin.respun ? 'r' : 'f'}`;

const GOLD = -1;

export function ClubSpin({
  spin,
  pool,
  teamName,
  myTurn,
  respinsLeft,
  onRespin,
  respinBusy,
  onLanded,
}: {
  spin: SpinView;
  pool: PoolData;
  teamName: string;
  myTurn: boolean;
  respinsLeft: number;
  onRespin: () => void;
  respinBusy: boolean;
  onLanded: (key: string) => void;
}) {
  const [go, setGo] = useState(false);
  const [landed, setLanded] = useState(false);
  const target = spin.golden ? GOLD : spin.clubId;

  // Rotate the order per pick so the reel looks different each time; a gold star now and then.
  const ring = spin.candidates.length > 0 ? spin.candidates.map((_, i) => spin.candidates[(i + spin.pickNumber) % spin.candidates.length]!) : [];
  const laps = Array.from({ length: LAPS }, (_, lap) => (lap === 2 && ring.length > 3 ? [...ring.slice(0, 3), GOLD, ...ring.slice(3)] : ring)).flat();
  const strip = [...laps, ...(target === null ? [] : [target])];
  const stopAt = strip.length - 1;
  const key = spinKey(spin);

  useEffect(() => {
    const finish = () => {
      setLanded(true);
      onLanded(key);
    };
    if (target === null) {
      const id = setTimeout(finish, 0);
      return () => clearTimeout(id);
    }
    const start = requestAnimationFrame(() => setGo(true));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const done = setTimeout(
      () => {
        finish();
        play('chime');
      },
      reduced ? 50 : 2700,
    );
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(done);
    };
  }, [key, target, onLanded]);

  const golden = spin.golden;
  const club = target === null || golden ? undefined : pool.clubsById.get(target);
  const canRespin = myTurn && landed && respinsLeft > 0 && !golden && spin.clubId !== null && spin.candidates.length > 1;
  return (
    <section
      className={`card overflow-hidden p-4 ${golden && landed ? 'bg-gradient-to-br from-gold-400/30 to-transparent ring-2 ring-gold-400' : myTurn ? 'ring-2 ring-gold-400' : ''}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="display text-xl">{spin.respun ? 'Re-spin' : 'Club spin'}</h2>
        <p className="min-w-0 flex-1 text-sm text-slate-500">
          Pick {spin.pickNumber} · {golden && landed ? `${myTurn ? 'you' : teamName} may draft from any club` : `${myTurn ? 'you must' : `${teamName} must`} draft from this club`}
        </p>
        {canRespin ? (
          <button type="button" className="btn-secondary min-h-9 py-0 text-sm" disabled={respinBusy} onClick={onRespin} title="Spin again, once per draft">
            🎲 Re-spin (1 left)
          </button>
        ) : myTurn && respinsLeft === 0 && !spin.respun ? (
          <span className="text-xs text-slate-500">Re-spin used</span>
        ) : null}
      </div>
      {target === null ? (
        <p className="mt-3 text-sm text-slate-500">No club has a player who fits an open slot, so any player may be picked.</p>
      ) : (
        <>
          <div className="relative mt-3 h-20 overflow-hidden rounded-xl bg-slate-100 dark:bg-night-900" aria-hidden>
            <div
              className="absolute top-0 left-1/2 flex h-full items-center"
              style={{
                transform: `translateX(${-((go ? stopAt : 0) * ITEM + ITEM / 2)}px)`,
                transition: go ? 'transform 2.6s cubic-bezier(0.12, 0.75, 0.12, 1)' : 'none',
              }}
            >
              {strip.map((id, i) => {
                const c = pool.clubsById.get(id);
                return (
                  <span key={i} className="grid place-items-center" style={{ width: ITEM }}>
                    <span className={i === stopAt && landed ? 'scale-150 transition-transform duration-300' : ''}>
                      {id === GOLD ? (
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-gold-400 to-gold-500 text-2xl shadow-lg" aria-hidden>
                          ★
                        </span>
                      ) : (
                        <ClubShield primary={c?.primaryColor ?? '#334155'} secondary={c?.secondaryColor ?? '#fff'} text={c?.shortName ?? '?'} />
                      )}
                    </span>
                  </span>
                );
              })}
            </div>
            <span className="pointer-events-none absolute inset-y-1 left-1/2 w-[72px] -translate-x-1/2 rounded-xl ring-2 ring-gold-400" />
          </div>
          <p className="mt-3 text-center display text-2xl" role="status">
            {!landed ? 'Spinning…' : golden ? '✨ Golden spin! Any club' : (club?.name ?? 'Unknown club')}
          </p>
        </>
      )}
    </section>
  );
}
