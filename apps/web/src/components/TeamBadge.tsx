/** Dark text on light colours, white on dark, so the monogram is always readable. */
export function textOn(hex: string | null): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m?.[1]) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0B1220' : '#FFFFFF';
}

export function TeamBadge({ color, monogram, size = 'md' }: { color: string | null; monogram: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'size-14 text-xl' : size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm';
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full display ring-2 ring-white/20 ${dims}`}
      style={{ backgroundColor: color ?? '#475569', color: textOn(color) }}
      aria-hidden
    >
      {monogram ?? '?'}
    </span>
  );
}
