import type { AdminOverview } from '@draft-xi/server/contracts';
import { fmtDate, Loading, Section, useAdminQuery } from './shared';

export function AdminOverviewPage() {
  const q = useAdminQuery<AdminOverview>(['overview'], '/api/admin/overview');
  if (!q.data) return <Loading />;
  const c = q.data.counts;
  const tiles: [string, number][] = [
    ['Users', c.users],
    ['Guests', c.guests],
    ['Active lobbies', c.activeLobbies],
    ['Drafts in progress', c.draftsInProgress],
    ['Seasons simulated', c.seasonsSimulated],
    ['Players (active)', c.activePlayers],
    ['Players (all)', c.players],
    ['Clubs', c.clubs],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map(([label, n]) => (
          <div key={label} className="card p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
            <p className="display text-3xl tabular-nums">{n.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Data health">
          {q.data.health.length === 0 ? (
            <p className="text-sm text-pitch-500">No problems found.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {q.data.health.map((h) => (
                <li key={h.message} className={h.level === 'warning' ? 'text-gold-500' : 'text-slate-500'}>
                  {h.level === 'warning' ? '⚠ ' : 'ℹ '}
                  {h.message}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recent activity">
          <ul className="grid gap-1 text-sm">
            {q.data.recent.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="w-32 shrink-0 text-xs text-slate-500">{fmtDate(a.createdAt)}</span>
                <span className="min-w-0 truncate">
                  <b>{a.actor}</b> {a.action} {a.target ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
