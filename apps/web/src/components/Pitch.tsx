import { ratingTier } from '@draft-xi/engine';
import { surnameOf, TIER_STYLE } from '../lib/pool';

export interface PitchSlot {
  key: string;
  type: string;
  x: number;
  y: number;
  player?: {
    name: string;
    overall: number;
    /** Ring colour: the player's real club. */
    ringColor: string;
    note?: string;
    /** Extra line under the name, e.g. goals and assists. */
    stat?: string;
  } | null;
}

interface PitchProps {
  slots: readonly PitchSlot[];
  selectedKey?: string | null;
  /** Slots that fit the selected player. */
  highlight?: ReadonlySet<string>;
  onSlot?: (key: string) => void;
  /** Animate the slot that was just filled. */
  flashKey?: string | null;
  compact?: boolean;
  label?: string;
}

/** A pitch with mowing stripes, own goal at the bottom. Slot x/y are 0 to 100. */
export function Pitch({ slots, selectedKey, highlight, onSlot, flashKey, compact = false, label = 'Formation' }: PitchProps) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl ring-1 ring-white/10 ${compact ? 'aspect-[4/5]' : 'aspect-[3/4] sm:aspect-[4/5]'}`}
      style={{
        background:
          'repeating-linear-gradient(180deg, #15803d 0 10%, #166534 10% 20%)',
      }}
      role="group"
      aria-label={label}
    >
      {/* Markings */}
      <div className="pointer-events-none absolute inset-[4%] rounded-sm border-2 border-white/40" />
      <div className="pointer-events-none absolute inset-x-[4%] top-1/2 border-t-2 border-white/40" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />
      <div className="pointer-events-none absolute bottom-[4%] left-1/2 h-[14%] w-[44%] -translate-x-1/2 border-2 border-b-0 border-white/40" />
      <div className="pointer-events-none absolute left-1/2 top-[4%] h-[14%] w-[44%] -translate-x-1/2 border-2 border-t-0 border-white/40" />

      {slots.map((s) => {
        const filled = Boolean(s.player);
        const selected = selectedKey === s.key;
        const fits = highlight?.has(s.key) ?? false;
        const clickable = Boolean(onSlot) && (!filled || fits);
        const tier = s.player ? ratingTier(s.player.overall) : null;
        return (
          <button
            key={s.key}
            type="button"
            disabled={!clickable}
            onClick={() => onSlot?.(s.key)}
            className={`absolute flex w-[22%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-xl p-0.5 text-center focus-visible:outline-2 focus-visible:outline-gold-400 disabled:cursor-default ${
              flashKey === s.key ? 'animate-[flip_0.6s_ease-out]' : ''
            }`}
            style={{ left: `${s.x}%`, top: `${100 - s.y}%` }}
            aria-label={s.player ? `${s.type}: ${s.player.name}, ${s.player.overall}` : `${s.type}: empty${fits ? ', fits selected player' : ''}`}
            aria-pressed={selected}
          >
            <span
              className={`grid ${compact ? 'size-8 text-xs' : 'size-11 text-sm sm:size-12'} place-items-center rounded-full font-bold tabular-nums shadow-lg transition ${
                filled ? (tier ? TIER_STYLE[tier] : '') : 'bg-night-950/50 text-white/80'
              } ${selected ? 'ring-4 ring-gold-400' : fits ? 'ring-4 ring-pitch-400 animate-pulse' : ''}`}
              style={filled && !selected && !fits ? { boxShadow: `0 0 0 3px ${s.player!.ringColor}` } : undefined}
            >
              {s.player ? s.player.overall : '+'}
            </span>
            <span className={`max-w-full truncate rounded bg-night-950/70 px-1 font-semibold text-white ${compact ? 'text-[9px]' : 'text-[10px] sm:text-xs'}`}>
              {s.player ? surnameOf(s.player.name) : s.type}
            </span>
            {s.player ? (
              <span className={`${compact ? 'text-[8px]' : 'text-[9px]'} font-bold uppercase text-white/80`}>
                {s.type}
                {s.player.note ? ` · ${s.player.note}` : ''}
              </span>
            ) : null}
            {s.player?.stat ? <span className="text-[9px] font-semibold text-gold-400">{s.player.stat}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
