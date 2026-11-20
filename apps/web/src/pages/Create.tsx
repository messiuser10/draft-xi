import { DEFAULT_GAME_SETTINGS, type GameSettings, type GameView, type TeamDetails } from '@draft-xi/server/contracts';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { ErrorText } from '../components/ErrorText';
import { SettingsFields } from '../components/SettingsFields';
import { emptyTeam, TeamFields } from '../components/TeamForm';
import { api } from '../lib/api';
import { RequireSession } from '../lib/require-session';
import { type SiteInfo, useSite } from '../lib/session';

export function CreatePage() {
  const { data: site } = useSite();
  return (
    <RequireSession>
      {(me) => (site ? <CreateForm site={site} defaultName={`${me.displayName}'s league`} /> : <div className="card h-40 animate-pulse" />)}
    </RequireSession>
  );
}

function CreateForm({ site, defaultName }: { site: SiteInfo; defaultName: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName.slice(0, 40));
  const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_GAME_SETTINGS, ...site.gameDefaults });
  const [team, setTeam] = useState<TeamDetails>(emptyTeam());
  const create = useMutation({
    mutationFn: () => api<{ game: GameView }>('/api/games', { body: { name, settings, team } }),
    onSuccess: ({ game }) => void navigate(`/lobby/${game.code}`),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-2xl gap-6">
      <h1 className="display text-4xl">Create game</h1>
      <section className="card grid gap-4 p-5">
        <div>
          <label className="label" htmlFor="gameName">
            Game name
          </label>
          <input id="gameName" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
        </div>
        <SettingsFields value={settings} onChange={setSettings} site={site} />
      </section>
      <section className="card p-5">
        <h2 className="display mb-4 text-2xl">Your team</h2>
        <TeamFields value={team} onChange={setTeam} formations={site.formations} forcedFormation={settings.forcedFormation} />
      </section>
      <ErrorText error={create.error} />
      <button type="submit" className="btn-primary" disabled={create.isPending}>
        Create lobby
      </button>
    </form>
  );
}
