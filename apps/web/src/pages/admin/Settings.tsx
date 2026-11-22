/** Admin Settings tab: one editor per app setting (spec section 11, item 5). The server validates every value. */
import { FORMATION_IDS, POSITIONS, SLOT_TYPES, TIEBREAK_KEYS } from '@draft-xi/engine';
import type { AdminClubView, AdminSettingView, GameSettings } from '@draft-xi/server/contracts';
import { type ReactNode, useState } from 'react';
import { SettingsFields } from '../../components/SettingsFields';
import type { BandColor, TableBands } from '../../lib/session';
import { useSite } from '../../lib/session';
import { Loading, Section, send, useAdminMutation, useAdminQuery } from './shared';

type Values = Record<string, unknown>;

const TIEBREAK_LABEL: Record<string, string> = { goalDifference: 'Goal difference', goalsFor: 'Goals scored', headToHead: 'Head to head', wins: 'Wins' };

export function AdminSettingsPage() {
  const q = useAdminQuery<{ settings: AdminSettingView[] }>(['settings'], '/api/admin/settings');
  if (!q.data) return <Loading />;
  const values: Values = Object.fromEntries(q.data.settings.map((s) => [s.key, s.value]));
  const defaults: Values = Object.fromEntries(q.data.settings.map((s) => [s.key, s.defaultValue]));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Editor k="league.name" title="League name" values={values} defaults={defaults}>
        {(v, set) => <input className="input" value={v as string} onChange={(e) => set(e.target.value)} aria-label="League name" />}
      </Editor>
      <Editor k="game.maxHumansLimit" title="Maximum humans per game (up to 20)" values={values} defaults={defaults}>
        {(v, set) => <input className="input" type="number" min={1} max={20} value={v as number} onChange={(e) => set(Number(e.target.value))} aria-label="Maximum humans" />}
      </Editor>
      <Editor k="draft.timerRange" title="Pick timer allowed range (seconds)" values={values} defaults={defaults}>
        {(v, set) => {
          const r = v as { min: number; max: number };
          return (
            <div className="flex gap-2">
              <input className="input" type="number" min={5} value={r.min} aria-label="Minimum" onChange={(e) => set({ ...r, min: Number(e.target.value) })} />
              <input className="input" type="number" max={600} value={r.max} aria-label="Maximum" onChange={(e) => set({ ...r, max: Number(e.target.value) })} />
            </div>
          );
        }}
      </Editor>
      <Editor k="season.autoStart" title="Auto-start the season after the draft" values={values} defaults={defaults}>
        {(v, set) => <Toggle checked={v as boolean} onChange={set} label="Start 10 seconds after the last pick" />}
      </Editor>
      <div className="lg:col-span-2">
        <Editor k="game.defaults" title="Game defaults (draft mode, timer, club cap, strict positions, remove drafted from AI, playback)" values={values} defaults={defaults}>
          {(v, set) => <GameDefaults value={v as GameSettings} onChange={set} />}
        </Editor>
      </div>
      <Editor k="formations.enabled" title="Enabled formations" values={values} defaults={defaults}>
        {(v, set) => {
          const on = new Set(v as string[]);
          return (
            <div className="grid grid-cols-3 gap-1 text-sm">
              {FORMATION_IDS.map((f) => (
                <label key={f} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={on.has(f)}
                    onChange={(e) => set(FORMATION_IDS.filter((x) => (x === f ? e.target.checked : on.has(x))))}
                  />
                  {f}
                </label>
              ))}
            </div>
          );
        }}
      </Editor>
      <Editor k="ai.selection" title="AI club selection" values={values} defaults={defaults}>
        {(v, set) => <AiSelection value={v as { method: string; manualClubIds: number[] }} onChange={set} />}
      </Editor>
      <div className="lg:col-span-2">
        <Editor k="simulation.parameters" title="Simulation parameters, points system and tiebreakers" values={values} defaults={defaults}>
          {(v, set) => <SimParams value={v as Values} onChange={set} />}
        </Editor>
      </div>
      <div className="lg:col-span-2">
        <Editor k="positions.compatibility" title="Position compatibility (which positions may fill each slot)" values={values} defaults={defaults}>
          {(v, set) => <Compatibility value={v as Record<string, string[]>} onChange={set} />}
        </Editor>
      </div>
      <Editor k="table.bands" title="Table colour bands" values={values} defaults={defaults}>
        {(v, set) => <Bands value={v as TableBands} onChange={set} />}
      </Editor>
      <Editor k="profanity.words" title="Profanity word list (one per line)" values={values} defaults={defaults}>
        {(v, set) => (
          <textarea
            className="input h-40 font-mono text-xs"
            aria-label="Profanity words"
            value={(v as string[]).join('\n')}
            onChange={(e) => set(e.target.value.split('\n').map((w) => w.trim()))}
          />
        )}
      </Editor>
      <Editor k="lobbies.publicEnabled" title="Public lobbies" values={values} defaults={defaults}>
        {(v, set) => <Toggle checked={v as boolean} onChange={set} label="Allow public lobbies" />}
      </Editor>
      <Editor k="registrations.open" title="Registrations" values={values} defaults={defaults}>
        {(v, set) => <Toggle checked={v as boolean} onChange={set} label="New accounts can register" />}
      </Editor>
      <Editor k="site.maintenance" title="Maintenance banner" values={values} defaults={defaults}>
        {(v, set) => {
          const m = v as { enabled: boolean; message: string };
          return (
            <div className="grid gap-2">
              <Toggle checked={m.enabled} onChange={(enabled) => set({ ...m, enabled })} label="Maintenance mode (only admins can create games)" />
              <input className="input" value={m.message} aria-label="Maintenance message" onChange={(e) => set({ ...m, message: e.target.value })} />
            </div>
          );
        }}
      </Editor>
    </div>
  );
}

/** Holds a draft value for one setting with Save and Reset to default. */
function Editor({ k, title, values, defaults, children }: { k: string; title: string; values: Values; defaults: Values; children: (v: unknown, set: (v: unknown) => void) => ReactNode }) {
  const [draft, setDraft] = useState<unknown>(values[k]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(values[k]);
  const save = useAdminMutation((value: unknown) => send(`/api/admin/settings/${k}`, 'PUT', { value }), `${title.split(' (')[0]} saved`);
  return (
    <Section
      title={title}
      actions={
        <>
          <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => setDraft(defaults[k])}>
            Default
          </button>
          <button type="button" className="btn-primary min-h-8 px-3 text-xs" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
            Save
          </button>
        </>
      }
    >
      {children(draft, setDraft)}
    </Section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-slate-100 px-3 dark:bg-night-900">
      <span className="text-sm">{label}</span>
      <input type="checkbox" className="size-5 accent-pitch-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function GameDefaults({ value, onChange }: { value: GameSettings; onChange: (v: GameSettings) => void }) {
  const { data: site } = useSite();
  if (!site) return <Loading />;
  // The admin form shows every option, whatever the current site limits are.
  return <SettingsFields value={value} onChange={onChange} site={{ ...site, publicLobbiesEnabled: true, timerRange: { min: 5, max: 600 } }} />;
}

function SimParams({ value, onChange }: { value: Values; onChange: (v: Values) => void }) {
  const num = (key: string, label: string, step = 0.01, fallback?: number) => (
    <label className="text-xs">
      {label}
      <input className="input" type="number" step={step} value={(value[key] as number | undefined) ?? fallback ?? ''} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} />
    </label>
  );
  const points = value.points as { win: number; draw: number; loss: number };
  const order = (value.tiebreakers as string[] | undefined) ?? ['goalDifference', 'goalsFor', 'headToHead'];
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange({ ...value, tiebreakers: next });
  };
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {num('baseGoals', 'Base goals per team')}
        {num('homeAdvantage', 'Home advantage')}
        {num('sensitivity', 'Rating sensitivity')}
        {num('chaos', 'Chaos (0 to 1)')}
        {num('outOfPositionPenalty', 'Out of position penalty', 1)}
        {num('reserveRating', 'Academy Reserve rating', 1)}
        {num('aiSpread', 'AI club spread (0 to 1, 1 = off)', 0.05, 1)}
        {num('aiCatchUp', 'AI catch-up to drafted teams (0 to 1, 0 = off)', 0.05, 0)}
        {num('form', 'Season form swing (rating points)', 0.25, 2)}
        {num('streaks', 'In-season streaks (rating points)', 0.25, 1.5)}
        {num('sharedGoals', 'Shared goals (more draws)', 0.05, 0.3)}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={value.chemistry as boolean} onChange={(e) => onChange({ ...value, chemistry: e.target.checked })} /> Chemistry
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={value.injuries as boolean} onChange={(e) => onChange({ ...value, injuries: e.target.checked })} /> Injuries
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['win', 'draw', 'loss'] as const).map((k) => (
          <label key={k} className="text-xs capitalize">
            Points for a {k}
            <input className="input" type="number" value={points[k]} onChange={(e) => onChange({ ...value, points: { ...points, [k]: Number(e.target.value) } })} />
          </label>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold">Tiebreakers after points, in order (a seeded draw settles the rest)</p>
        <ol className="mt-1 grid gap-1 text-sm">
          {order.map((k, i) => (
            <li key={k} className="flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 dark:bg-night-900">
              <span className="w-5 tabular-nums">{i + 1}.</span>
              <span className="flex-1">{TIEBREAK_LABEL[k]}</span>
              <button type="button" className="btn-ghost min-h-8 px-2 text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${TIEBREAK_LABEL[k]} up`}>
                ↑
              </button>
              <button type="button" className="btn-ghost min-h-8 px-2 text-xs" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${TIEBREAK_LABEL[k]} down`}>
                ↓
              </button>
              <button type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => onChange({ ...value, tiebreakers: order.filter((x) => x !== k) })}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-1 flex flex-wrap gap-1">
          {TIEBREAK_KEYS.filter((k) => !order.includes(k)).map((k) => (
            <button key={k} type="button" className="btn-ghost min-h-8 px-2 text-xs" onClick={() => onChange({ ...value, tiebreakers: [...order, k] })}>
              + {TIEBREAK_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Compatibility({ value, onChange }: { value: Record<string, string[]>; onChange: (v: Record<string, string[]>) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="text-left">Slot</th>
            {POSITIONS.map((p) => (
              <th key={p} className="px-1">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOT_TYPES.map((slot) => (
            <tr key={slot}>
              <td className="pr-2 font-bold">{slot}</td>
              {POSITIONS.map((p) => {
                const on = (value[slot] ?? []).includes(p);
                return (
                  <td key={p} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${p} can play ${slot}`}
                      checked={on}
                      onChange={(e) => onChange({ ...value, [slot]: e.target.checked ? [...(value[slot] ?? []), p] : (value[slot] ?? []).filter((x) => x !== p) })}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bands({ value, onChange }: { value: TableBands; onChange: (v: TableBands) => void }) {
  const setBand = (i: number, patch: Partial<TableBands['bands'][number]>) => onChange({ ...value, bands: value.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  return (
    <div className="grid gap-2">
      <Toggle checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} label="Show colour bands" />
      {value.bands.map((b, i) => (
        <div key={i} className="grid grid-cols-[1fr_4rem_4rem_6rem_auto] items-center gap-1">
          <input className="input min-h-9" value={b.label} aria-label="Band name" onChange={(e) => setBand(i, { label: e.target.value })} />
          <input className="input min-h-9" type="number" min={1} max={20} value={b.from} aria-label="From position" onChange={(e) => setBand(i, { from: Number(e.target.value) })} />
          <input className="input min-h-9" type="number" min={1} max={20} value={b.to} aria-label="To position" onChange={(e) => setBand(i, { to: Number(e.target.value) })} />
          <select className="input min-h-9" value={b.color} aria-label="Colour" onChange={(e) => setBand(i, { color: e.target.value as BandColor })}>
            {(['gold', 'green', 'blue', 'red', 'purple'] as const).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button type="button" className="btn-ghost min-h-9 px-2 text-xs" onClick={() => onChange({ ...value, bands: value.bands.filter((_, j) => j !== i) })} aria-label={`Remove ${b.label}`}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost justify-self-start text-sm" onClick={() => onChange({ ...value, bands: [...value.bands, { label: 'New band', from: 7, to: 7, color: 'purple' }] })}>
        + Add band
      </button>
    </div>
  );
}

function AiSelection({ value, onChange }: { value: { method: string; manualClubIds: number[] }; onChange: (v: unknown) => void }) {
  const clubs = useAdminQuery<{ clubs: AdminClubView[] }>(['clubs'], '/api/admin/clubs');
  return (
    <div className="grid gap-2 text-sm">
      <select className="input" value={value.method} aria-label="Selection method" onChange={(e) => onChange({ ...value, method: e.target.value })}>
        <option value="strength">Top by strength (default)</option>
        <option value="manual">Manual list (strongest fill any gap)</option>
        <option value="random">Random (from the game seed)</option>
      </select>
      {value.method === 'manual' ? (
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto">
          {clubs.data?.clubs
            .filter((c) => c.inPool)
            .map((c) => (
              <label key={c.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={value.manualClubIds.includes(c.id)}
                  onChange={(e) => onChange({ ...value, manualClubIds: e.target.checked ? [...value.manualClubIds, c.id] : value.manualClubIds.filter((x) => x !== c.id) })}
                />
                <span className="truncate">{c.name}</span>
              </label>
            ))}
        </div>
      ) : null}
    </div>
  );
}
