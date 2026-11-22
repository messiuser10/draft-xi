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

const LAPS = 5;
const SPIN_MS = 2700;
/** How long the result stays on the full-screen overlay before it gets out of the way. */
const REVEAL_MS = 1600;

/** Reel cell width: big on a laptop, still five-ish cells across a phone. */
const cellWidth = () => (typeof window === 'undefined' ? 120 : Math.round(Math.min(140, Math.max(72, window.innerWidth / 5))));

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
  const [overlay, setOverlay] = useState(true);
  const [item] = useState(cellWidth);
  const target = spin.golden ? GOLD : spin.clubId;

  // Rotate the order per pick so the reel looks different each time; a gold star now and then.
  const ring = spin.candidates.length > 0 ? spin.candidates.map((_, i) => spin.candidates[(i + spin.pickNumber) % spin.candidates.length]!) : [];
  const laps = Array.from({ length: LAPS }, (_, lap) => (lap === 2 && ring.length > 3 ? [...ring.slice(0, 3), GOLD, ...ring.slice(3)] : ring)).flat();
  // A few badges after the target, so the reel is full on both sides when it stops.
  const strip = [...laps, ...(target === null ? [] : [target]), ...ring.slice(0, 6)];
  const stopAt = laps.length;
  const key = spinKey(spin);

  useEffect(() => {
    const finish = () => {
      setLanded(true);
      onLanded(key);
    };
    if (target === null) {
      const id = setTimeout(() => {
        finish();
        setOverlay(false);
      }, 0);
      return () => clearTimeout(id);
    }
    // A timer, not requestAnimationFrame: that one pauses while the tab is in the background.
    const start = setTimeout(() => setGo(true), 30);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const done = setTimeout(
      () => {
        finish();
        play('chime');
      },
      reduced ? 50 : SPIN_MS,
    );
    const hide = setTimeout(() => setOverlay(false), (reduced ? 50 : SPIN_MS) + REVEAL_MS);
    return () => {
      clearTimeout(start);
      clearTimeout(done);
      clearTimeout(hide);
    };
  }, [key, target, onLanded]);

  // Escape skips the overlay (the result still shows in the card).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  const golden = spin.golden;
  const club = target === null || golden ? undefined : pool.clubsById.get(target);
  const canRespin = myTurn && landed && respinsLeft > 0 && !golden && spin.clubId !== null && spin.candidates.length > 1;
  const who = myTurn ? 'You' : teamName;
  const verdict = golden ? `${who} may draft from any club` : `${who} must draft from this club`;
  const resultName = golden ? 'Golden spin! Any club' : (club?.name ?? 'Unknown club');

  return (
    <>
      {overlay && target !== null ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-night-950/90 px-4 text-white backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label={`Club spin for pick ${spin.pickNumber}`}
          onClick={() => landed && setOverlay(false)}
        >
          <p className="display text-center text-lg text-pitch-400 sm:text-2xl">
            Pick {spin.pickNumber} · {myTurn ? 'Your spin' : `${teamName} is spinning`}
            {spin.respun ? ' (re-spin)' : ''}
          </p>
          <div className="relative mt-6 w-full max-w-5xl overflow-hidden rounded-3xl bg-white/5 ring-1 ring-white/10" style={{ height: item * 1.25 }} aria-hidden>
            <div
              className="absolute top-0 left-1/2 flex h-full items-center"
              style={{
                transform: `translateX(${-((go ? stopAt : Math.min(3, stopAt)) * item + item / 2)}px)`,
                transition: go ? `transform ${SPIN_MS - 100}ms cubic-bezier(0.12, 0.75, 0.12, 1)` : 'none',
              }}
            >
              {strip.map((id, i) => {
                const c = pool.clubsById.get(id);
                const hit = i === stopAt && landed;
                return (
                  <span key={i} className="grid place-items-center" style={{ width: item }}>
                    <span className={`transition-transform duration-300 ${hit ? 'scale-125' : landed ? 'opacity-30' : ''}`}>
                      {id === GOLD ? (
                        <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-gold-400 to-gold-500 text-3xl shadow-lg sm:size-20 sm:text-5xl">★</span>
                      ) : (
                        <span className="grid place-items-center sm:scale-125">
                          <ClubShield primary={c?.primaryColor ?? '#334155'} secondary={c?.secondaryColor ?? '#fff'} text={c?.shortName ?? '?'} size="lg" />
                        </span>
                      )}
                    </span>
                  </span>
                );
              })}
            </div>
            {/* Fade the edges so the eye goes to the middle. */}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-night-950 to-transparent" />
            <span className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-night-950 to-transparent" />
            <span className="pointer-events-none absolute inset-y-2 left-1/2 -translate-x-1/2 rounded-2xl ring-4 ring-gold-400" style={{ width: item - 8 }} />
          </div>
          <div className="mt-8 min-h-28 text-center" role="status" aria-live="assertive">
            {landed ? (
              <div className="animate-reveal">
                <p className={`display text-4xl sm:text-6xl ${golden ? 'text-gold-400' : ''}`}>{golden ? '✨ ' : ''}{resultName}</p>
                <p className="mt-2 text-lg text-slate-300 sm:text-xl">{verdict}</p>
              </div>
            ) : (
              <p className="display animate-pulse text-3xl text-slate-300 sm:text-5xl">Spinning…</p>
            )}
          </div>
          {landed ? (
            <button type="button" className="btn-secondary mt-4" onClick={() => setOverlay(false)}>
              Continue
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        className={`card overflow-hidden p-4 ${golden && landed ? 'bg-gradient-to-br from-gold-400/30 to-transparent ring-2 ring-gold-400' : myTurn ? 'ring-2 ring-gold-400' : ''}`}
        aria-live="polite"
      >
        {target === null ? (
          <p className="text-sm text-slate-500">Pick {spin.pickNumber}: no club has a player who fits an open slot, so any player may be picked.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {golden ? (
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold-400 to-gold-500 text-3xl shadow-lg" aria-hidden>
                ★
              </span>
            ) : club ? (
              <ClubShield primary={club.primaryColor} secondary={club.secondaryColor} text={club.shortName} size="lg" />
            ) : null}
            <div className="min-w-[10rem] flex-1">
              <p className="text-xs font-bold tracking-wide text-slate-500 uppercase">
                {spin.respun ? 'Re-spin' : 'Club spin'} · Pick {spin.pickNumber}
              </p>
              <p className="display truncate text-2xl">{landed ? resultName : 'Spinning…'}</p>
              {landed ? <p className="text-sm text-slate-500">{verdict}</p> : null}
            </div>
            {canRespin ? (
              <button type="button" className="btn-secondary min-h-11 w-full text-sm sm:w-auto" disabled={respinBusy} onClick={onRespin} title="Spin again, once per draft">
                🎲 Re-spin (1 left)
              </button>
            ) : myTurn && respinsLeft === 0 && !spin.respun ? (
              <span className="text-xs text-slate-500">Re-spin used</span>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}
