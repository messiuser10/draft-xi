import { useSecondsLeft } from './Countdown';

/** Circular pick clock. Turns red and pulses under 10 seconds. */
export function CountdownRing({ deadline, totalSeconds, pausedMs }: { deadline: string | null; totalSeconds: number | null; pausedMs?: number | null }) {
  const live = useSecondsLeft(deadline);
  const left = live ?? (pausedMs !== null && pausedMs !== undefined ? Math.ceil(pausedMs / 1000) : null);
  if (left === null || totalSeconds === null) {
    return <span className="text-xs text-slate-400">No timer</span>;
  }
  const r = 18;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / totalSeconds));
  const urgent = left <= 10;
  return (
    <span className={`relative grid size-12 place-items-center ${urgent && live !== null ? 'animate-pulse' : ''}`} role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-white/15" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className={urgent ? 'stroke-red-500' : 'stroke-pitch-400'}
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      <span className={`display text-lg tabular-nums ${urgent ? 'text-red-400' : ''}`}>{left}</span>
    </span>
  );
}
