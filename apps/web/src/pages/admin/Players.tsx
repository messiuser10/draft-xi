/** Admin Players tab: search, filters, inline edit, add, bulk edit, import and export with diff preview, duplicates. */
import { POSITIONS } from '@draft-xi/engine';
import type { AdminClubView, AdminPlayerView, ImportPreview } from '@draft-xi/server/contracts';
import { type FormEvent, useState } from 'react';
import { Loading, Section, send, useAdminMutation, useAdminQuery } from './shared';

type Status = 'all' | 'active' | 'inactive' | 'injured' | 'flagged';

export function AdminPlayersPage() {
  const [search, setSearch] = useState('');
  const [clubId, setClubId] = useState('');
  const [position, setPosition] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: '50', status });
  if (search.trim()) params.set('search', search.trim());
  if (clubId) params.set('clubId', clubId);
  if (position) params.set('position', position);
  const players = useAdminQuery<{ players: AdminPlayerView[]; total: number }>(['players', params.toString()], `/api/admin/players?${params.toString()}`);
  const clubs = useAdminQuery<{ clubs: AdminClubView[] }>(['clubs'], '/api/admin/clubs');
  const pages = Math.max(1, Math.ceil((players.data?.total ?? 0) / 50));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const reset = () => setPage(1);

  return (
    <>
      <Section
        title={`Players${players.data ? ` (${players.data.total})` : ''}`}
        actions={
          <>
            <a className="btn-ghost text-sm" href="/api/admin/players/export?format=json" download>
              Export JSON
            </a>
            <a className="btn-ghost text-sm" href="/api/admin/players/export?format=csv" download>
              Export CSV
            </a>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input className="input col-span-2 md:col-span-1" placeholder="Search name or nationality" aria-label="Search players" value={search} onChange={(e) => (setSearch(e.target.value), reset())} />
          <select className="input" aria-label="Club" value={clubId} onChange={(e) => (setClubId(e.target.value), reset())}>
            <option value="">All clubs</option>
            {clubs.data?.clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Position" value={position} onChange={(e) => (setPosition(e.target.value), reset())}>
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className="input" aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value as Status), reset())}>
            {(['all', 'active', 'inactive', 'injured', 'flagged'] as const).map((s) => (
              <option key={s} value={s}>
                {s === 'flagged' ? 'With source note' : s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        {selected.size > 0 ? <BulkBar ids={[...selected]} clubs={clubs.data?.clubs ?? []} onDone={() => setSelected(new Set())} /> : null}
        {!players.data ? (
          <div className="mt-3">
            <Loading />
          </div>
        ) : players.data.players.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No players match.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={players.data.players.every((p) => selected.has(p.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(players.data.players.map((p) => p.id)) : new Set())}
                    />
                  </th>
                  <th className="text-left">Name</th>
                  <th className="text-left">Club</th>
                  <th>Pos</th>
                  <th>Alt</th>
                  <th>OVR</th>
                  <th className="text-left">Nation</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {players.data.players.map((p) =>
                  editing === p.id ? (
                    <EditRow key={p.id} player={p} clubs={clubs.data?.clubs ?? []} onClose={() => setEditing(null)} />
                  ) : (
                    <tr key={p.id} className={`border-t border-slate-200 dark:border-white/5 ${p.isActive ? '' : 'opacity-50'}`}>
                      <td className="text-center">
                        <input type="checkbox" aria-label={`Select ${p.fullName}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                      </td>
                      <td className="py-1">
                        <span className="font-semibold">{p.fullName}</span>
                        {p.sourceNote ? (
                          <span className="ml-1 cursor-help text-gold-500" title={p.sourceNote}>
                            ⚑
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-40 truncate">{p.clubName}</td>
                      <td className="text-center">{p.primaryPosition}</td>
                      <td className="text-center text-xs text-slate-500">{p.altPositions.join(' ')}</td>
                      <td className="text-center font-bold tabular-nums">{p.overall}</td>
                      <td className="max-w-28 truncate">{p.nationality}</td>
                      <td className="text-center text-xs">{!p.isActive ? 'Inactive' : p.isInjured ? 'Injured' : 'Active'}</td>
                      <td className="text-right">
                        <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setEditing(p.id)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 text-sm">
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AddPlayer clubs={clubs.data?.clubs ?? []} />
        <Duplicates />
      </div>
      <Import />
    </>
  );
}

function EditRow({ player, clubs, onClose }: { player: AdminPlayerView; clubs: AdminClubView[]; onClose: () => void }) {
  const [f, setF] = useState({ ...player, alt: player.altPositions.join(' '), note: player.sourceNote ?? '' });
  const save = useAdminMutation(
    () =>
      send(`/api/admin/players/${player.id}`, 'PATCH', {
        fullName: f.fullName,
        displayName: f.displayName,
        clubId: f.clubId,
        primaryPosition: f.primaryPosition,
        altPositions: f.alt.split(/[\s,|]+/).filter(Boolean),
        overall: Number(f.overall),
        nationality: f.nationality,
        isActive: f.isActive,
        isInjured: f.isInjured,
        sourceNote: f.note.trim() || null,
      }),
    'Player saved',
  );
  const del = useAdminMutation(() => send(`/api/admin/players/${player.id}`, 'DELETE'), 'Player deleted');
  return (
    <tr className="border-t border-slate-200 bg-slate-100 dark:border-white/5 dark:bg-night-900">
      <td colSpan={9} className="p-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <label className="text-xs">
            Full name
            <input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          </label>
          <label className="text-xs">
            Display name
            <input className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
          </label>
          <label className="text-xs">
            Club
            <select className="input" value={f.clubId} onChange={(e) => setF({ ...f, clubId: Number(e.target.value) })}>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Nationality
            <input className="input" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} />
          </label>
          <label className="text-xs">
            Position
            <select className="input" value={f.primaryPosition} onChange={(e) => setF({ ...f, primaryPosition: e.target.value })}>
              {POSITIONS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Alt positions (space separated)
            <input className="input" value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value.toUpperCase() })} />
          </label>
          <label className="text-xs">
            Overall (40 to 99)
            <input className="input" type="number" min={40} max={99} value={f.overall} onChange={(e) => setF({ ...f, overall: Number(e.target.value) })} />
          </label>
          <label className="text-xs">
            Source note
            <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={f.isInjured} onChange={(e) => setF({ ...f, isInjured: e.target.checked })} /> Injured
          </label>
          <span className="flex-1" />
          <button
            type="button"
            className="btn-danger min-h-9"
            disabled={del.isPending}
            onClick={() => {
              if (window.confirm(`Delete ${player.fullName} permanently? Drafted players can only be deactivated.`)) del.mutate(undefined, { onSuccess: onClose });
            }}
          >
            Delete
          </button>
          <button type="button" className="btn-ghost min-h-9" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary min-h-9" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}

function BulkBar({ ids, clubs, onDone }: { ids: number[]; clubs: AdminClubView[]; onDone: () => void }) {
  const [delta, setDelta] = useState(1);
  const [club, setClub] = useState('');
  const bulk = useAdminMutation((patch: Record<string, unknown>) => send<{ updated: number }>('/api/admin/players/bulk', 'POST', { ids, patch }), (o) => `${o.updated} players updated`);
  const run = (patch: Record<string, unknown>) => bulk.mutate(patch, { onSuccess: onDone });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-pitch-500/10 p-2 text-sm">
      <b>{ids.length} selected</b>
      <button type="button" className="btn-ghost min-h-9" onClick={() => run({ isActive: true })}>
        Activate
      </button>
      <button type="button" className="btn-ghost min-h-9" onClick={() => run({ isActive: false })}>
        Deactivate
      </button>
      <button type="button" className="btn-ghost min-h-9" onClick={() => run({ isInjured: true })}>
        Mark injured
      </button>
      <button type="button" className="btn-ghost min-h-9" onClick={() => run({ isInjured: false })}>
        Mark fit
      </button>
      <span className="flex items-center gap-1">
        <input className="input min-h-9 w-16" type="number" min={-30} max={30} value={delta} aria-label="Overall change" onChange={(e) => setDelta(Number(e.target.value))} />
        <button type="button" className="btn-ghost min-h-9" disabled={!delta} onClick={() => run({ overallDelta: delta })}>
          Adjust overall
        </button>
      </span>
      <span className="flex items-center gap-1">
        <select className="input min-h-9" value={club} aria-label="Move to club" onChange={(e) => setClub(e.target.value)}>
          <option value="">Move to club…</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost min-h-9" disabled={!club} onClick={() => run({ clubId: Number(club) })}>
          Move
        </button>
      </span>
    </div>
  );
}

function AddPlayer({ clubs }: { clubs: AdminClubView[] }) {
  const empty = { clubId: '', fullName: '', primaryPosition: 'CM', alt: '', overall: 70, nationality: '' };
  const [f, setF] = useState(empty);
  const add = useAdminMutation(
    () =>
      send('/api/admin/players', 'POST', {
        clubId: Number(f.clubId),
        fullName: f.fullName,
        primaryPosition: f.primaryPosition,
        altPositions: f.alt.split(/[\s,|]+/).filter(Boolean),
        overall: Number(f.overall),
        nationality: f.nationality,
      }),
    'Player added',
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(undefined, { onSuccess: () => setF(empty) });
  };
  return (
    <Section title="Add player">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2">
        <select className="input col-span-2" required value={f.clubId} aria-label="Club" onChange={(e) => setF({ ...f, clubId: e.target.value })}>
          <option value="">Club…</option>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="input col-span-2" required placeholder="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <select className="input" value={f.primaryPosition} aria-label="Position" onChange={(e) => setF({ ...f, primaryPosition: e.target.value })}>
          {POSITIONS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input className="input" placeholder="Alt positions" value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value.toUpperCase() })} />
        <input className="input" type="number" min={40} max={99} aria-label="Overall" value={f.overall} onChange={(e) => setF({ ...f, overall: Number(e.target.value) })} />
        <input className="input" required placeholder="Nationality" value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} />
        <button type="submit" className="btn-primary col-span-2" disabled={add.isPending}>
          Add player
        </button>
      </form>
    </Section>
  );
}

function Duplicates() {
  const [open, setOpen] = useState(false);
  const q = useAdminQuery<{ groups: AdminPlayerView[][] }>(['duplicates'], '/api/admin/players/duplicates', open);
  return (
    <Section title="Duplicate detection">
      {!open ? (
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          Find duplicates
        </button>
      ) : !q.data ? (
        <Loading />
      ) : q.data.groups.length === 0 ? (
        <p className="text-sm text-pitch-500">No duplicate names.</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {q.data.groups.map((g) => (
            <li key={g[0]!.id} className="rounded-xl bg-slate-100 p-2 dark:bg-night-900">
              {g.map((p) => (
                <div key={p.id}>
                  #{p.id} {p.fullName} · {p.clubName} · {p.primaryPosition} {p.overall}
                  {p.isActive ? '' : ' (inactive)'}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Import() {
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const check = useAdminMutation(() => send<ImportPreview>('/api/admin/players/import/preview', 'POST', { format, content }));
  const apply = useAdminMutation(
    () => send<ImportPreview>('/api/admin/players/import/apply', 'POST', { format, content }),
    (o) => `Imported: ${o.added.length} added, ${o.updated.length} updated`,
  );
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
    setContent(await file.text());
    setPreview(null);
  };
  return (
    <Section title="Import players">
      <p className="text-sm text-slate-500">
        CSV columns: club, name, position, overall, nationality, and optionally id, alt_positions (separated by |), display_name, active, injured,
        source_note. JSON: the export format. Rows match by id, else by club and name.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,.json,text/csv,application/json" aria-label="Choose a file" onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm" />
        <select className="input min-h-9 w-24" value={format} aria-label="Format" onChange={(e) => setFormat(e.target.value as 'json' | 'csv')}>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
      </div>
      <textarea
        className="input mt-2 h-32 font-mono text-xs"
        placeholder="…or paste the file here"
        aria-label="Import content"
        value={content}
        onChange={(e) => (setContent(e.target.value), setPreview(null))}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-secondary" disabled={!content || check.isPending} onClick={() => check.mutate(undefined, { onSuccess: setPreview })}>
          Preview changes
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!preview || preview.errors.length > 0 || preview.added.length + preview.updated.length === 0 || apply.isPending}
          onClick={() => apply.mutate(undefined, { onSuccess: () => (setPreview(null), setContent('')) })}
        >
          Apply import
        </button>
      </div>
      {preview ? (
        <div className="mt-3 grid gap-2 text-sm">
          <p>
            <b className="text-pitch-500">{preview.added.length} new</b> · <b className="text-sky-500">{preview.updated.length} changed</b> · {preview.unchanged} unchanged ·{' '}
            <b className={preview.errors.length ? 'text-red-500' : ''}>{preview.errors.length} errors</b>
          </p>
          {preview.errors.length > 0 ? (
            <ul className="max-h-40 overflow-y-auto text-red-500">
              {preview.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="max-h-64 overflow-y-auto">
            {preview.added.map((a) => (
              <li key={`a-${a.club}-${a.name}`} className="text-pitch-600 dark:text-pitch-400">
                + {a.name} ({a.club})
              </li>
            ))}
            {preview.updated.map((u) => (
              <li key={`u-${u.id}`}>
                ~ {u.name} ({u.club}):{' '}
                {Object.entries(u.changes)
                  .map(([k, [a, b]]) => `${k} ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
