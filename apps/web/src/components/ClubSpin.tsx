/**
 * Club Spin: before each pick a reel of club badges spins and lands on the club the team on the
 * clock must draft from. The server decides the club; this only animates towards it.
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

export function useSpin(code: string, pickNumber: number, enabled: boolean) {
  return useQuery({
    queryKey: ['spin', code, pickNumber],
    queryFn: () => api<{ spin: SpinView | null }>(`/api/games/${code}/spin`).then((r) => r.spin),
    enabled,
    staleTime: Infinity,
  });
}

export function ClubSpin({
  spin,
  pool,
  teamName,
  myTurn,
  onLanded,
}: {
  spin: SpinView;
  pool: PoolData;
  teamName: string;
  myTurn: boolean;
  onLanded: (pickNumber: number) => void;
}) {
  const [go, setGo] = useState(false);
  const [landed, setLanded] = useState(false);
  const target = spin.clubId;

  // Rotate the order per pick so the reel looks different each time.
  const ring = spin.candidates.length > 0 ? spin.candidates.map((_, i) => spin.candidates[(i + spin.pickNumber) % spin.candidates.length]!) : [];
  const strip = [...Array.from({ length: LAPS }, () => ring).flat(), ...(target === null ? [] : [target])];
  const stopAt = strip.length - 1;

  useEffect(() => {
    const finish = () => {
      setLanded(true);
      onLanded(spin.pickNumber);
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
  }, [spin.pickNumber, target, onLanded]);

  const club = target === null ? undefined : pool.clubsById.get(target);
  return (
    <section className={`card overflow-hidden p-4 ${myTurn ? 'ring-2 ring-gold-400' : ''}`} aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="display text-xl">Club spin</h2>
        <p className="text-sm text-slate-500">
          Pick {spin.pickNumber} · {myTurn ? 'you must' : `${teamName} must`} draft from this club
        </p>
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
                      <ClubShield primary={c?.primaryColor ?? '#334155'} secondary={c?.secondaryColor ?? '#fff'} text={c?.shortName ?? '?'} />
                    </span>
                  </span>
                );
              })}
            </div>
            <span className="pointer-events-none absolute inset-y-1 left-1/2 w-[72px] -translate-x-1/2 rounded-xl ring-2 ring-gold-400" />
          </div>
          <p className="mt-3 text-center display text-2xl" role="status">
            {landed ? club?.name ?? 'Unknown club' : 'Spinning…'}
          </p>
        </>
      )}
    </section>
  );
}
