import type { GameSettings } from '@draft-xi/server/contracts';
import type { SiteInfo } from '../lib/session';

interface Props {
  value: GameSettings;
  onChange: (next: GameSettings) => void;
  site: SiteInfo;
  disabled?: boolean;
}

const Toggle = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined }) => (
  <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-slate-100 px-3 dark:bg-night-900">
    <span className="text-sm">{label}</span>
    <input type="checkbox" className="size-5 accent-pitch-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

export function SettingsFields({ value, onChange, site, disabled }: Props) {
  const set = (patch: Partial<GameSettings>) => onChange({ ...value, ...patch });
  const timerOptions = [null, 15, 30, 45, 60, 90, 120, 180].filter(
    (t) => t === null || (t >= site.timerRange.min && t <= site.timerRange.max),
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="visibility">
          Visibility
        </label>
        <select
          id="visibility"
          className="input"
          disabled={disabled}
          value={value.visibility}
          onChange={(e) => set({ visibility: e.target.value as GameSettings['visibility'] })}
        >
          <option value="private">Private (by code)</option>
          {site.publicLobbiesEnabled ? <option value="public">Public lobby</option> : null}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="maxHumans">
          Maximum players
        </label>
        <select id="maxHumans" className="input" disabled={disabled} value={value.maxHumans} onChange={(e) => set({ maxHumans: Number(e.target.value) })}>
          {Array.from({ length: site.maxHumansLimit }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'team' : 'teams'} ({20 - n} AI clubs)
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="draftMode">
          Draft mode
        </label>
        <select id="draftMode" className="input" disabled={disabled} value={value.draftMode} onChange={(e) => set({ draftMode: e.target.value as GameSettings['draftMode'] })}>
          <option value="snake">Snake (order reverses each round)</option>
          <option value="linear">Linear (same order each round)</option>
          <option value="pack">Pack pick (choose from a pack)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="timer">
          Pick timer
        </label>
        <select
          id="timer"
          className="input"
          disabled={disabled}
          value={value.pickTimerSeconds ?? 'off'}
          onChange={(e) => set({ pickTimerSeconds: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          {timerOptions.map((t) => (
            <option key={t ?? 'off'} value={t ?? 'off'}>
              {t === null ? 'Off' : `${t} seconds`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="formationRule">
          Formations
        </label>
        <select
          id="formationRule"
          className="input"
          disabled={disabled}
          value={value.formationRule}
          onChange={(e) => {
            const rule = e.target.value as GameSettings['formationRule'];
            set({ formationRule: rule, forcedFormation: rule === 'forced' ? (value.forcedFormation ?? '4-3-3') : null });
          }}
        >
          <option value="choose">Each team chooses</option>
          <option value="forced">Host forces one</option>
        </select>
      </div>
      {value.formationRule === 'forced' ? (
        <div>
          <label className="label" htmlFor="forcedFormation">
            Forced formation
          </label>
          <select
            id="forcedFormation"
            className="input"
            disabled={disabled}
            value={value.forcedFormation ?? '4-3-3'}
            onChange={(e) => set({ forcedFormation: e.target.value as GameSettings['forcedFormation'] })}
          >
            {site.formations.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <label className="label" htmlFor="clubCap">
          Max players from one club
        </label>
        <select
          id="clubCap"
          className="input"
          disabled={disabled}
          value={value.clubCap ?? 'off'}
          onChange={(e) => set({ clubCap: e.target.value === 'off' ? null : Number(e.target.value) })}
        >
          <option value="off">No limit</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="playback">
          Season playback
        </label>
        <select id="playback" className="input" disabled={disabled} value={value.playbackMode} onChange={(e) => set({ playbackMode: e.target.value as GameSettings['playbackMode'] })}>
          <option value="synchronized">Synchronized (everyone together)</option>
          <option value="own_pace">Own pace</option>
        </select>
      </div>
      <Toggle
        label={value.draftMode === 'pack' ? 'Club spin (not used with Pack pick)' : 'Club spin: a wheel picks the club for every pick'}
        checked={value.clubSpin}
        disabled={disabled || value.draftMode === 'pack'}
        onChange={(v) => set({ clubSpin: v })}
      />
      <Toggle label="Strict position matching" checked={value.strictPositions} disabled={disabled} onChange={(v) => set({ strictPositions: v })} />
      <Toggle label="Remove drafted players from AI squads" checked={value.removeDraftedFromAi} disabled={disabled} onChange={(v) => set({ removeDraftedFromAi: v })} />
      <Toggle label="Bots allowed" checked={value.botsAllowed} disabled={disabled} onChange={(v) => set({ botsAllowed: v })} />
    </div>
  );
}
