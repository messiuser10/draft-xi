import { FORMATION_IDS } from '@draft-xi/engine';
import { type TeamDetails, TEAM_COLORS } from '@draft-xi/server/contracts';
import { useState } from 'react';
import { TeamBadge } from './TeamBadge';

export const emptyTeam = (name = ''): TeamDetails => ({
  teamName: name,
  color: TEAM_COLORS[0],
  monogram: monogramOf(name),
  formation: '4-3-3',
});

export function monogramOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3) || 'FC'
  );
}

interface Props {
  value: TeamDetails;
  onChange: (next: TeamDetails) => void;
  formations?: readonly string[];
  /** Set when the host forces one formation. */
  forcedFormation?: string | null;
}

export function TeamFields({ value, onChange, formations = FORMATION_IDS, forcedFormation }: Props) {
  const [monogramTouched, setMonogramTouched] = useState(false);
  const set = (patch: Partial<TeamDetails>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-4">
        <TeamBadge color={value.color} monogram={value.monogram || '?'} size="lg" />
        <div className="flex-1">
          <label className="label" htmlFor="teamName">
            Team name
          </label>
          <input
            id="teamName"
            className="input"
            value={value.teamName}
            maxLength={24}
            placeholder="3 to 24 characters"
            onChange={(e) =>
              set({ teamName: e.target.value, ...(monogramTouched ? {} : { monogram: monogramOf(e.target.value) }) })
            }
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="monogram">
            Monogram
          </label>
          <input
            id="monogram"
            className="input uppercase"
            value={value.monogram}
            maxLength={3}
            onChange={(e) => {
              setMonogramTouched(true);
              set({ monogram: e.target.value.toUpperCase() });
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="formation">
            Formation
          </label>
          <select
            id="formation"
            className="input"
            value={forcedFormation ?? value.formation ?? ''}
            disabled={Boolean(forcedFormation)}
            onChange={(e) => set({ formation: (e.target.value || null) as TeamDetails['formation'] })}
          >
            {formations.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="label">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={value.color.toUpperCase() === c}
              onClick={() => set({ color: c })}
              className={`size-9 rounded-full ring-offset-2 ring-offset-white transition dark:ring-offset-night-800 ${
                value.color.toUpperCase() === c ? 'ring-2 ring-white scale-110' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
