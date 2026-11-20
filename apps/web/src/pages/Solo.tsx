import type { GameView, TeamDetails } from '@draft-xi/server/contracts';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { ErrorText } from '../components/ErrorText';
import { emptyTeam, TeamFields } from '../components/TeamForm';
import { api } from '../lib/api';
import { RequireSession } from '../lib/require-session';
import { useSite } from '../lib/session';

export function SoloPage() {
  return <RequireSession>{() => <SoloForm />}</RequireSession>;
}

function SoloForm() {
  const navigate = useNavigate();
  const { data: site } = useSite();
  const [team, setTeam] = useState<TeamDetails>(emptyTeam());
  const solo = useMutation({
    mutationFn: () => api<{ game: GameView }>('/api/games/solo', { body: { team } }),
    onSuccess: ({ game }) => void navigate(`/draft/${game.code}`),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    solo.mutate();
  };
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-xl gap-6">
      <div>
        <h1 className="display text-4xl">Play solo vs AI</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">You against the 19 strongest clubs. Name your team and kick off.</p>
      </div>
      <section className="card p-5">
        <TeamFields value={team} onChange={setTeam} {...(site ? { formations: site.formations } : {})} />
      </section>
      <ErrorText error={solo.error} />
      <button type="submit" className="btn-primary" disabled={solo.isPending}>
        Start solo league
      </button>
    </form>
  );
}
