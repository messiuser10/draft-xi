import type { GameSettings, GameSnapshot, ParticipantView, TeamDetails } from '@draft-xi/server/contracts';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { StartCountdown } from '../components/Countdown';
import { InvitePanel } from '../components/InvitePanel';
import { SettingsFields } from '../components/SettingsFields';
import { TeamBadge } from '../components/TeamBadge';
import { emptyTeam, TeamFields } from '../components/TeamForm';
import { useAction } from '../lib/actions';
import { useMe, useSite } from '../lib/session';
import { useGame } from '../lib/socket';

export function LobbyPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot, error } = useGame(code);

  if (error) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="display text-3xl">Game not found</p>
        <p className="mt-2 text-slate-500 dark:text-slate-400">{error}</p>
        <Link to="/" className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    );
  }
  if (!snapshot) return <LobbySkeleton />;
  if (snapshot.game.status === 'cancelled') {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="display text-3xl">Game cancelled</p>
        <p className="mt-2 text-slate-500 dark:text-slate-400">The host called this one off.</p>
        <Link to="/" className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    );
  }
  if (snapshot.game.status !== 'lobby') return <Navigate to={`/draft/${code}`} replace />;
  return <Lobby snapshot={snapshot} />;
}

function LobbySkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="card h-80 animate-pulse" />
      <div className="card h-80 animate-pulse" />
    </div>
  );
}

function Lobby({ snapshot }: { snapshot: GameSnapshot }) {
  const { game, participants, me } = snapshot;
  const mine = participants.find((p) => p.id === me.participantId);
  return (
    <div className="grid grid-cols-1 gap-6">
      <StartCountdown startsAt={snapshot.startsAt} />
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <p className="display text-pitch-500">Lobby · {game.settings.draftMode} draft</p>
          <h1 className="display text-4xl">{game.name}</h1>
        </div>
        <span className="ml-auto rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-night-700">
          {participants.length}/{game.settings.maxHumans} teams
        </span>
      </header>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Participants snapshot={snapshot} />
          {mine ? <MyTeam snapshot={snapshot} mine={mine} /> : <JoinPanel snapshot={snapshot} />}
          <Chat snapshot={snapshot} />
        </div>
        <aside className="grid min-w-0 grid-cols-1 content-start gap-6">
          <InvitePanel code={game.code} />
          {me.isHost ? <HostControls snapshot={snapshot} /> : null}
          <PoolHealth snapshot={snapshot} />
          <SettingsCard snapshot={snapshot} />
        </aside>
      </div>
    </div>
  );
}

function Participants({ snapshot }: { snapshot: GameSnapshot }) {
  const { participants, me, game } = snapshot;
  const { run, busy } = useAction();
  const move = (index: number, delta: number) => {
    const ids = participants.map((p) => p.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void run(`/api/games/${game.code}/order`, 'POST', { order: ids });
  };
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <h2 className="display text-xl">Teams · pick order</h2>
        {me.isHost ? (
          <button type="button" className="btn-ghost ml-auto text-sm" disabled={busy} onClick={() => void run(`/api/games/${game.code}/order`, 'POST', { randomize: true })}>
            Randomize
          </button>
        ) : null}
      </div>
      <ol className="mt-3 grid grid-cols-1 gap-2">
        {participants.map((p, i) => (
          <li key={p.id} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 sm:gap-3 dark:bg-night-900">
            <span className="w-5 text-center text-sm tabular-nums text-slate-500">{i + 1}</span>
            <TeamBadge color={p.color} monogram={p.monogram} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {p.teamName}
                {p.isHost ? <span title="Host" aria-label="Host" className="ml-1 text-gold-500">♛</span> : null}
                {p.id === me.participantId ? <span className="ml-2 text-xs text-pitch-500">you</span> : null}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {p.displayName} · {p.formation ?? 'no formation'}
              </p>
            </div>
            <ConnectionBadge p={p} />
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${p.isReady ? 'bg-pitch-500/20 text-pitch-600 dark:text-pitch-400' : 'bg-slate-200 text-slate-600 dark:bg-night-700 dark:text-slate-300'}`}>
              {p.isReady ? 'Ready' : 'Not ready'}
            </span>
            {me.isHost ? (
              <div className="flex gap-1">
                <button type="button" className="btn-ghost min-h-8 px-2 text-xs" aria-label={`Move ${p.teamName} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                  ▲
                </button>
                <button type="button" className="btn-ghost min-h-8 px-2 text-xs" aria-label={`Move ${p.teamName} down`} disabled={busy || i === participants.length - 1} onClick={() => move(i, 1)}>
                  ▼
                </button>
                {!p.isHost ? (
                  <details className="relative">
                    <summary className="btn-ghost min-h-8 cursor-pointer list-none px-2 text-xs" aria-label={`Actions for ${p.teamName}`}>
                      ⋯
                    </summary>
                    <div className="card absolute right-0 z-10 mt-1 grid w-40 p-1 text-sm">
                      {!p.isBot ? (
                        <button type="button" className="btn-ghost justify-start" onClick={() => void run(`/api/games/${game.code}/host`, 'POST', { participantId: p.id })}>
                          Make host
                        </button>
                      ) : null}
                      <button type="button" className="btn-ghost justify-start text-red-500" onClick={() => void run(`/api/games/${game.code}/participants/${p.id}`, 'DELETE', {})}>
                        {p.isBot ? 'Remove bot' : 'Kick'}
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        League preview: {participants.length} drafted {participants.length === 1 ? 'team' : 'teams'} + {snapshot.aiClubCount} AI{' '}
        {snapshot.aiClubCount === 1 ? 'club' : 'clubs'}, chosen by strength when the draft starts.
      </p>
    </section>
  );
}

function ConnectionBadge({ p }: { p: ParticipantView }) {
  if (p.isBot) return <span className="text-xs text-slate-500">bot</span>;
  return (
    <span className="flex items-center" title={p.isConnected ? 'Connected' : 'Offline'}>
      <span className={`size-2.5 rounded-full ${p.isConnected ? 'bg-pitch-500' : 'bg-slate-400'}`} />
      <span className="sr-only">{p.isConnected ? 'Connected' : 'Offline'}</span>
    </span>
  );
}

function MyTeam({ snapshot, mine }: { snapshot: GameSnapshot; mine: ParticipantView }) {
  const { game } = snapshot;
  const { data: site } = useSite();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeamDetails>({
    teamName: mine.teamName ?? '',
    color: mine.color ?? '#22C55E',
    monogram: mine.monogram ?? '',
    formation: mine.formation,
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(`/api/games/${game.code}/me`, 'PATCH', draft)) setEditing(false);
  };
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display text-xl">Your team</h2>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-ghost text-sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close' : 'Edit team'}
          </button>
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={busy}
            onClick={() => void run(`/api/games/${game.code}/leave`).then((r) => r && navigate('/'))}
          >
            Leave
          </button>
        </div>
      </div>
      {editing ? (
        <form onSubmit={(e) => void save(e)} className="mt-4 grid gap-4">
          <TeamFields value={draft} onChange={setDraft} {...(site ? { formations: site.formations } : {})} forcedFormation={game.settings.forcedFormation} />
          <button type="submit" className="btn-secondary" disabled={busy}>
            Save team
          </button>
        </form>
      ) : null}
      <button
        type="button"
        className={`mt-4 w-full ${mine.isReady ? 'btn-secondary' : 'btn-primary'}`}
        disabled={busy}
        aria-pressed={mine.isReady}
        onClick={() => void run(`/api/games/${game.code}/me`, 'PATCH', { isReady: !mine.isReady })}
      >
        {mine.isReady ? 'Ready ✓ (tap to undo)' : "I'm ready"}
      </button>
    </section>
  );
}

function JoinPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const { game, participants } = snapshot;
  const { data: me } = useMe();
  const { data: site } = useSite();
  const { run, busy } = useAction();
  const [team, setTeam] = useState<TeamDetails>(emptyTeam());
  const full = participants.length >= game.settings.maxHumans;
  if (!me) {
    return (
      <section className="card p-5">
        <h2 className="display text-xl">Want to play?</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">You are spectating. Sign in or join as a guest to enter a team.</p>
        <Link to={`/login?next=/lobby/${game.code}`} className="btn-primary mt-4">
          Join as guest or sign in
        </Link>
      </section>
    );
  }
  if (full) {
    return (
      <section className="card p-5">
        <p className="font-semibold">This game is full. You can watch as a spectator.</p>
      </section>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(`/api/games/${game.code}/join`, 'POST', team);
  };
  return (
    <form onSubmit={submit} className="card grid gap-4 p-5">
      <h2 className="display text-xl">Join this game</h2>
      <TeamFields value={team} onChange={setTeam} {...(site ? { formations: site.formations } : {})} forcedFormation={game.settings.forcedFormation} />
      <button type="submit" className="btn-primary" disabled={busy}>
        Join with this team
      </button>
    </form>
  );
}

function HostControls({ snapshot }: { snapshot: GameSnapshot }) {
  const { game } = snapshot;
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [level, setLevel] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [force, setForce] = useState(false);
  const humans = snapshot.participants.filter((p) => !p.isBot);
  const allReady = humans.every((p) => p.isReady);
  const allFormations = snapshot.participants.every((p) => p.formation);
  const canStart = humans.length > 0 && (allReady || force) && allFormations && snapshot.poolHealth.ok;
  return (
    <section className="card grid gap-3 p-5">
      <h2 className="display text-xl">Host controls</h2>
      {game.settings.botsAllowed ? (
        <div className="flex gap-2">
          <select className="input" aria-label="Bot level" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
            <option value="easy">Easy bot</option>
            <option value="medium">Medium bot</option>
            <option value="hard">Hard bot</option>
          </select>
          <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={() => void run(`/api/games/${game.code}/bots`, 'POST', { level })}>
            Add bot
          </button>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-pitch-500" checked={force} onChange={(e) => setForce(e.target.checked)} />
        Force start even if not everyone is ready
      </label>
      {snapshot.startsAt ? (
        <button type="button" className="btn-secondary" onClick={() => void run(`/api/games/${game.code}/start/cancel`)}>
          Stop countdown
        </button>
      ) : (
        <button type="button" className="btn-primary" disabled={busy || !canStart} onClick={() => void run(`/api/games/${game.code}/start`, 'POST', { force })}>
          Start game
        </button>
      )}
      {!canStart ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {!allFormations ? 'Every team needs a formation. ' : ''}
          {!allReady && !force ? 'Waiting for everyone to be ready. ' : ''}
          {!snapshot.poolHealth.ok ? 'The player pool is short for this many teams.' : ''}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-ghost text-sm text-red-500"
        disabled={busy}
        onClick={() => {
          if (window.confirm('Cancel this game for everyone?')) void run(`/api/games/${game.code}/cancel`).then((r) => r && navigate('/'));
        }}
      >
        Cancel game
      </button>
    </section>
  );
}

function PoolHealth({ snapshot }: { snapshot: GameSnapshot }) {
  const { poolHealth } = snapshot;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <h2 className="display text-xl">Pool health</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${poolHealth.ok ? 'bg-pitch-500/20 text-pitch-600 dark:text-pitch-400' : 'bg-red-500/20 text-red-500'}`}>
          {poolHealth.ok ? 'OK' : 'Short'}
        </span>
      </div>
      {poolHealth.warnings.map((w) => (
        <p key={w} className="mt-2 rounded-lg bg-gold-500/10 px-2 py-1 text-xs text-gold-600 dark:text-gold-400">
          ⚠ {w}
        </p>
      ))}
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="font-medium">Slot</th>
            <th className="text-right font-medium">Needed</th>
            <th className="text-right font-medium">In pool</th>
          </tr>
        </thead>
        <tbody>
          {poolHealth.byPosition.map((r) => (
            <tr key={r.slotType} className={r.available < r.needed ? 'text-red-500' : ''}>
              <td className="py-0.5 font-mono text-xs">{r.slotType}</td>
              <td className="text-right tabular-nums">{r.needed}</td>
              <td className="text-right tabular-nums">{r.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SettingsCard({ snapshot }: { snapshot: GameSnapshot }) {
  const { game, me } = snapshot;
  const { data: site } = useSite();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GameSettings>(game.settings);
  const s = game.settings;
  const rows: [string, string][] = [
    ['Visibility', s.visibility === 'public' ? 'Public' : 'Private'],
    ['Draft', s.draftMode],
    ['Pick timer', s.pickTimerSeconds === null ? 'Off' : `${s.pickTimerSeconds}s`],
    ['Formations', s.formationRule === 'forced' ? `Forced ${s.forcedFormation}` : 'Each chooses'],
    ['Club cap', s.clubCap === null ? 'None' : `${s.clubCap} per club`],
    ['Strict positions', s.strictPositions ? 'On' : 'Off'],
    ['Drafted leave AI squads', s.removeDraftedFromAi ? 'On' : 'Off'],
    ['Bots', s.botsAllowed ? 'Allowed' : 'Off'],
    ['Playback', s.playbackMode === 'synchronized' ? 'Synchronized' : 'Own pace'],
  ];
  return (
    <section className="card p-5">
      <div className="flex items-center">
        <h2 className="display text-xl">Settings</h2>
        {me.isHost ? (
          <button
            type="button"
            className="btn-ghost ml-auto text-sm"
            onClick={() => {
              setDraft(game.settings);
              setEditing((v) => !v);
            }}
          >
            {editing ? 'Close' : 'Edit'}
          </button>
        ) : null}
      </div>
      {editing && site ? (
        <form
          className="mt-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`/api/games/${game.code}/settings`, 'PATCH', { settings: draft }).then((r) => r && setEditing(false));
          }}
        >
          <SettingsFields value={draft} onChange={setDraft} site={site} />
          <button type="submit" className="btn-secondary" disabled={busy}>
            Save settings
          </button>
        </form>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
              <dd className="text-right capitalize">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Chat({ snapshot }: { snapshot: GameSnapshot }) {
  const { game, chat, me } = snapshot;
  const { run, busy } = useAction();
  const [body, setBody] = useState('');
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    if (await run(`/api/games/${game.code}/chat`, 'POST', { body })) setBody('');
  };
  return (
    <section className="card p-5">
      <h2 className="display text-xl">Chat</h2>
      <ul className="mt-3 grid max-h-60 gap-1 overflow-y-auto text-sm" aria-live="polite">
        {chat.length === 0 ? <li className="text-slate-500">No messages yet. Say hello.</li> : null}
        {chat.map((m) => (
          <li key={m.id}>
            <span className="font-semibold">{m.displayName}:</span> {m.body}
          </li>
        ))}
      </ul>
      {me.userId !== null ? (
        <form onSubmit={(e) => void send(e)} className="mt-3 flex gap-2">
          <label htmlFor="chat" className="sr-only">
            Message
          </label>
          <input id="chat" className="input" maxLength={300} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" />
          <button type="submit" className="btn-secondary" disabled={busy}>
            Send
          </button>
        </form>
      ) : null}
    </section>
  );
}
