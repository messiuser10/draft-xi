import { useEffect, useState } from 'react';
import { serverNow } from '../lib/socket';

/** Whole seconds left until an ISO time on the server's clock. */
export function useSecondsLeft(iso: string | null): number | null {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(serverNow()), 200);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

export function StartCountdown({ startsAt }: { startsAt: string | null }) {
  const left = useSecondsLeft(startsAt);
  if (left === null) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-night-950/80 backdrop-blur-sm" role="status" aria-live="assertive">
      <div className="text-center text-white">
        <p className="display text-2xl text-pitch-400">The draft starts in</p>
        <p className={`display text-[10rem] leading-none ${left <= 3 ? 'text-gold-500' : ''}`}>{left}</p>
      </div>
    </div>
  );
}
