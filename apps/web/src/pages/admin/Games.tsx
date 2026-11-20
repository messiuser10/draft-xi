/** Admin Games tab: every game with its status and the admin actions from spec section 11. */
import type { AdminGameView, GameStatus } from '@draft-xi/server/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { fmtDate, Loading, Section, send, useAdminMutation, useAdminQuery } from './shared';

const STATUSES = ['all', 'lobby', 'drafting', 'paused', 'draft_complete', 'simulating', 'completed', 'cancelled'] as const;

export function watchPath(g: { code: string; status: GameStatus }): string {
  if (g.status === 'lobby' || g.status === 'cancelled') return `/lobby/${g.code}`;
  if (g.status === 'completed' || g.status === 'simulating') return `/season/${g.code}`;
  return `/draft/${g.code}`;
}

export function AdminGamesPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const q = useAdminQuery<{ games: AdminGameView[] }>(['games', status], `/api/admin/games?status=${status}`);
  return (
    <Section
      title="Games"
      actions={
        <select className="input min-h-9 w-44" value={status} aria-label="Filter by status" onChange={(e) => setStatus(e.target.value as typeof status)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
            </option>
          ))}
        </select>
      }
    >
      <p className="mb-2 text-xs text-slate-500">
        Kick, replace with a bot, reassign pick order and the other host controls are in each game&apos;s own page; admins see them in every game.
      </p>
      {!q.data ? (
        <Loading />
      ) : q.data.games.length === 0 ? (
        <p className="text-sm text-slate-500">No games.</p>
      ) : (
        <ul className="grid gap-2">
          {q.data.games.map((g) => (
            <GameRow key={g.id} game={g} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function GameRow({ game: g }: { game: AdminGameView }) {
  const [open, setOpen] = useState(false);
  const act = useAdminMutation((a: { path: string; method?: string; body?: unknown; label: string }) => send(a.path, a.method ?? 'POST', a.body).then(() => a.label), (label) => label);
  const run = (path: string, label: string, confirm?: string, body?: unknown, method?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    act.mutate({ path, label, body, method });
  };
  const drafting = g.status === 'drafting' || g.status === 'paused';
  const [now] = useState(() => Date.now());
  const ageHours = Math.round((now - new Date(g.createdAt).getTime()) / 36e5);
  return (
    <li className="rounded-xl bg-slate-100 dark:bg-night-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
        <span className="font-mono font-bold">{g.code}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{g.name}</span>
        <span className="rounded bg-slate-200 px-1.5 text-xs dark:bg-night-700">{g.status.replace('_', ' ')}</span>
        <span className="text-xs text-slate-500">
          host {g.hostName ?? '–'} · {g.humans} humans, {g.bots} bots · {g.seasons} seasons · {ageHours < 48 ? `${ageHours}h old` : fmtDate(g.createdAt)}
        </span>
        <Link to={watchPath(g)} className="btn-ghost min-h-8 px-2 text-xs">
          Open
        </Link>
        <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Actions
        </button>
      </div>
      {open ? (
        <div className="flex flex-wrap gap-1 border-t border-slate-200 p-2 dark:border-white/5">
          {g.status === 'lobby' ? (
            <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/start`, 'Force start requested', 'Start this game now, even if not everyone is ready?', { force: true })}>
              Force start
            </button>
          ) : null}
          {g.status === 'drafting' ? (
            <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/draft/pause`, 'Draft paused')}>
              Pause
            </button>
          ) : null}
          {g.status === 'paused' ? (
            <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/draft/resume`, 'Draft resumed')}>
              Resume
            </button>
          ) : null}
          {drafting ? (
            <>
              <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/draft/skip`, 'Turn skipped (auto-picked)')}>
                Skip turn
              </button>
              <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/draft/extend`, 'Timer extended', undefined, { seconds: 30 })}>
                +30 seconds
              </button>
            </>
          ) : null}
          {drafting || g.status === 'draft_complete' ? (
            <>
              <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/draft/undo`, 'Last pick undone')}>
                Undo last pick
              </button>
              <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/admin/games/${g.code}/reset-draft`, 'Draft reset', 'Delete every pick and restart the draft from pick 1?')}>
                Reset draft
              </button>
            </>
          ) : null}
          {drafting ? (
            <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/draft/end`, 'Draft completed', 'Auto-pick every remaining pick now?')}>
              Force complete draft
            </button>
          ) : null}
          {g.status === 'draft_complete' ? (
            <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/season`, 'Season simulated')}>
              Start season
            </button>
          ) : null}
          {g.status === 'completed' ? (
            <>
              <button type="button" className="btn-secondary min-h-9 text-sm" onClick={() => run(`/api/admin/games/${g.code}/rerun`, 'Season re-simulated', 'Delete every season of this game and simulate season 1 again?')}>
                Re-run simulation
              </button>
              <a className="btn-ghost min-h-9 text-sm" href={`/api/games/${g.code}/export?format=json`} download>
                Export JSON
              </a>
              <a className="btn-ghost min-h-9 text-sm" href={`/api/games/${g.code}/export?format=csv`} download>
                Export CSV
              </a>
            </>
          ) : null}
          <button
            type="button"
            className="btn-ghost min-h-9 text-sm"
            onClick={() => {
              const value = window.prompt(`New seed for ${g.code} (current ${g.seed ?? 'none'}). Used for season 1 and Expected Strength.`, String(g.seed ?? ''));
              const seed = Number(value);
              if (value && Number.isInteger(seed) && seed > 0) act.mutate({ path: `/api/admin/games/${g.code}/seed`, body: { seed }, label: `Seed set to ${seed}` });
            }}
          >
            Change seed
          </button>
          {g.status !== 'completed' && g.status !== 'cancelled' ? (
            <button type="button" className="btn-ghost min-h-9 text-sm" onClick={() => run(`/api/games/${g.code}/cancel`, 'Game cancelled', 'Cancel this game for everyone?')}>
              Cancel game
            </button>
          ) : null}
          <button type="button" className="btn-danger min-h-9 text-sm" onClick={() => run(`/api/admin/games/${g.code}`, 'Game deleted', `Delete ${g.code} and all its seasons permanently? This cannot be undone.`, undefined, 'DELETE')}>
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}
