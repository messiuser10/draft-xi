/** Admin Clubs tab: edit colours and monograms, pool toggle, strength override, custom clubs, rebalance, AI preview. */
import type { AdminClubView, ClubRankingView } from '@draft-xi/server/contracts';
import { type FormEvent, useState } from 'react';
import { ClubShield } from '../../components/Kickoff';
import { Loading, Section, send, useAdminMutation, useAdminQuery } from './shared';

export function AdminClubsPage() {
  const clubs = useAdminQuery<{ clubs: AdminClubView[] }>(['clubs'], '/api/admin/clubs');
  const [humans, setHumans] = useState(3);
  const ranking = useAdminQuery<ClubRankingView>(['ranking', humans], `/api/admin/clubs/ranking?humans=${humans}`);
  return (
    <>
      <Section title="Clubs">
        {!clubs.data ? (
          <Loading />
        ) : (
          <ul className="grid gap-2">
            {clubs.data.clubs.map((c) => (
              <ClubRow key={c.id} club={c} />
            ))}
          </ul>
        )}
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Which clubs become AI teams">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28">Humans: {humans}</span>
            <input type="range" min={1} max={20} value={humans} onChange={(e) => setHumans(Number(e.target.value))} className="flex-1 accent-pitch-500" aria-label="Number of humans" />
          </label>
          {ranking.data ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Method: {ranking.data.method === 'strength' ? 'top by strength' : ranking.data.method}. {20 - humans} AI clubs.
              </p>
              <ol className="mt-2 grid gap-1 text-sm">
                {ranking.data.rows.map((r) => (
                  <li key={r.clubId} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${r.isAi ? 'bg-pitch-500/10' : 'opacity-60'}`}>
                    <span className="w-6 text-right tabular-nums">{r.rank}</span>
                    <span className="min-w-0 flex-1 truncate">{r.clubName}</span>
                    {r.overridden ? <span className="text-xs text-gold-500" title={`Computed ${r.computed}`}>override</span> : null}
                    <span className="w-12 text-right tabular-nums">{r.rating.toFixed(1)}</span>
                    <span className="w-16 text-right text-xs font-bold">{r.isAi ? 'AI team' : 'Out'}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <Loading />
          )}
        </Section>
        <AddClub />
      </div>
    </>
  );
}

function ClubRow({ club }: { club: AdminClubView }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...club, override: club.strengthOverride === null ? '' : String(club.strengthOverride), notes: club.notes ?? '' });
  const [delta, setDelta] = useState(-2);
  const save = useAdminMutation(
    () =>
      send(`/api/admin/clubs/${club.id}`, 'PATCH', {
        name: f.name,
        shortName: f.shortName,
        country: f.country,
        leagueName: f.leagueName,
        primaryColor: f.primaryColor.toUpperCase(),
        secondaryColor: f.secondaryColor.toUpperCase(),
        inPool: f.inPool,
        strengthOverride: f.override === '' ? null : Number(f.override),
        notes: f.notes.trim() || null,
      }),
    'Club saved',
  );
  const togglePool = useAdminMutation(() => send(`/api/admin/clubs/${club.id}`, 'PATCH', { inPool: !club.inPool }), club.inPool ? `${club.name} removed from the pool` : `${club.name} added to the pool`);
  const rebalance = useAdminMutation(() => send<{ updated: number }>(`/api/admin/clubs/${club.id}/rebalance`, 'POST', { delta }), (o) => `${o.updated} players adjusted by ${delta > 0 ? '+' : ''}${delta}`);
  const warn = club.inPool && (club.activePlayers < 22 || club.goalkeepers < 2);
  return (
    <li className="rounded-xl bg-slate-100 dark:bg-night-900">
      <div className="flex flex-wrap items-center gap-3 p-2">
        <ClubShield primary={club.primaryColor} secondary={club.secondaryColor} text={club.shortName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{club.name}</span>
          <span className={`block text-xs ${warn ? 'text-gold-500' : 'text-slate-500'}`}>
            {club.activePlayers} players · {club.goalkeepers} GK · strength {club.strengthRating?.toFixed(1) ?? '–'}
            {club.strengthOverride !== null ? ` (override ${club.strengthOverride})` : ''}
          </span>
        </span>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={club.inPool} onChange={() => togglePool.mutate(undefined)} /> In pool
        </label>
        <button type="button" className="btn-ghost min-h-9 text-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open ? (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-2 md:grid-cols-4 dark:border-white/5">
          <label className="text-xs">
            Name
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="text-xs">
            Monogram (short name)
            <input className="input" value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} />
          </label>
          <label className="text-xs">
            Country
            <input className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />
          </label>
          <label className="text-xs">
            League
            <input className="input" value={f.leagueName} onChange={(e) => setF({ ...f, leagueName: e.target.value })} />
          </label>
          <label className="text-xs">
            Primary colour
            <input className="input h-11 p-1" type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} />
          </label>
          <label className="text-xs">
            Secondary colour
            <input className="input h-11 p-1" type="color" value={f.secondaryColor} onChange={(e) => setF({ ...f, secondaryColor: e.target.value })} />
          </label>
          <label className="text-xs">
            Strength override (blank = computed)
            <input className="input" type="number" min={40} max={99} step={0.1} value={f.override} onChange={(e) => setF({ ...f, override: e.target.value })} />
          </label>
          <label className="text-xs">
            Notes
            <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
          <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-4">
            <button type="button" className="btn-primary min-h-9" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
              Save club
            </button>
            <span className="flex-1" />
            <span className="text-sm">Rebalance club:</span>
            <input className="input min-h-9 w-20" type="number" min={-20} max={20} value={delta} aria-label="Overall change for every player" onChange={(e) => setDelta(Number(e.target.value))} />
            <button
              type="button"
              className="btn-secondary min-h-9"
              disabled={!delta || rebalance.isPending}
              onClick={() => {
                if (window.confirm(`Change every ${club.name} player's overall by ${delta > 0 ? '+' : ''}${delta}?`)) rebalance.mutate(undefined);
              }}
            >
              Apply to all players
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function AddClub() {
  const empty = { name: '', shortName: '', country: '', leagueName: '', primaryColor: '#22C55E', secondaryColor: '#FFFFFF', inPool: false };
  const [f, setF] = useState(empty);
  const add = useAdminMutation(() => send('/api/admin/clubs', 'POST', { ...f, primaryColor: f.primaryColor.toUpperCase(), secondaryColor: f.secondaryColor.toUpperCase() }), 'Club added');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(undefined, { onSuccess: () => setF(empty) });
  };
  return (
    <Section title="Add a custom club">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2">
        <input className="input" required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" required placeholder="Monogram" value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} />
        <input className="input" required placeholder="Country" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />
        <input className="input" required placeholder="League" value={f.leagueName} onChange={(e) => setF({ ...f, leagueName: e.target.value })} />
        <label className="text-xs">
          Primary colour
          <input className="input h-11 p-1" type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} />
        </label>
        <label className="text-xs">
          Secondary colour
          <input className="input h-11 p-1" type="color" value={f.secondaryColor} onChange={(e) => setF({ ...f, secondaryColor: e.target.value })} />
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.inPool} onChange={(e) => setF({ ...f, inPool: e.target.checked })} /> Add to the pool now (add at least 22 players first)
        </label>
        <button type="submit" className="btn-primary col-span-2" disabled={add.isPending}>
          Add club
        </button>
      </form>
    </Section>
  );
}
