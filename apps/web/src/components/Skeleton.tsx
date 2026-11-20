/** Skeleton loaders: grey shapes in the layout of the page that is loading. Motion stops under reduced motion. */
export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid gap-4" role="status" aria-label={label}>
      <div className="h-10 w-2/3 animate-pulse rounded-xl bg-slate-200 sm:w-1/3 dark:bg-night-700" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="card grid content-start gap-3 p-4">
          <div className="aspect-[3/4] animate-pulse rounded-xl bg-slate-200 dark:bg-night-700" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-night-700" />
        </div>
        <div className="card grid content-start gap-2 p-4">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="size-9 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-night-700" />
              <div className="h-4 flex-1 animate-pulse rounded bg-slate-200 dark:bg-night-700" style={{ maxWidth: `${90 - i * 7}%` }} />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
