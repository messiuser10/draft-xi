/**
 * Season playback (spec section 10). The server simulated the whole season once; this page plays
 * it back. Synchronized mode follows the host's `playback` state; own-pace mode keeps it local.
 */
import {
  MATCHDAY_MS,
  type FixtureView,
  type GameSnapshot,
  type LeagueTeamView,
  type MonteCarloView,
  type PlaybackSpeed,
  type PlaybackState,
  playbackMatchday,
  SEASON_MATCHDAYS,
  type SeasonView,
  type StandingView,
  type TitlesRow,
} from '@draft-xi/server/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ClubShield } from '../components/Kickoff';
import { TeamBadge } from '../components/TeamBadge';
import { useAction } from '../lib/actions';
import { api } from '../lib/api';
import { useSeason } from '../lib/league';
import { serverNow, useGame } from '../lib/socket';

export function SeasonPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot, error } = useGame(code);
  if (error) return <p className="card p-8 text-center">{error}</p>;
  if (!snapshot) return <div className="card h-96 animate-pulse" />;
  const { status } = snapshot.game;
  if (status === 'lobby') return <Navigate to={`/lobby/${code}`} replace />;
  if (status === 'drafting' || status === 'paused') return <Navigate to={`/draft/${code}`} replace />;
  if (status === 'draft_complete') return <Navigate to={`/reveal/${code}`} replace />;
  if (status === 'simulating' && snapshot.seasons.length === 0) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center" role="status">
        <p className="display text-3xl">Simulating the season…</p>
        <p className="mt-2 text-slate-500">380 matches, one moment.</p>
      </div>
    );
  }
  return <Season snapshot={snapshot} />;
}

/** Playback that ticks: the shared state in synchronized mode, a local copy in own-pace mode. */
function usePlayback(snapshot: GameSnapshot) {
  const synced = snapshot.game.settings.playbackMode === 'synchronized';
  const shared = snapshot.playback;
  const [local, setLocal] = useState<PlaybackState>(() => ({
    seasonNumber: shared?.seasonNumber ?? snapshot.seasons.at(-1)?.number ?? 1,
    matchday: 0,
    playing: true,
    speed: 1,
    anchorAt: new Date().toISOString(),
  }));
  const state = synced && shared ? shared : local;
  const clock = synced ? serverNow : Date.now;
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => setNow(clock()), 250);
    return () => clearInterval(id);
  }, [state.playing, clock]);
  const matchday = playbackMatchday(state, now);

  const { run } = useAction();
  const canControl = !synced || snapshot.me.isHost || snapshot.me.isAdmin;
  const control = (action: 'play' | 'pause' | 'speed' | 'jump' | 'end', extra: { speed?: PlaybackSpeed; matchday?: number; seasonNumber?: number } = {}) => {
    if (synced) {
      void run(`/api/games/${snapshot.game.code}/playback`, 'POST', { action, ...extra });
      return;
    }
    const t = Date.now();
    const cur = playbackMatchday(local, t);
    let next: PlaybackState = { ...local, matchday: cur, anchorAt: new Date(t).toISOString() };
    if (extra.seasonNumber !== undefined && extra.seasonNumber !== local.seasonNumber) next = { ...next, seasonNumber: extra.seasonNumber, matchday: 0 };
    if (action === 'play') next = { ...next, playing: true, matchday: next.matchday >= SEASON_MATCHDAYS ? 0 : next.matchday };
    if (action === 'pause') next = { ...next, playing: false };
    if (action === 'speed' && extra.speed) next = { ...next, speed: extra.speed };
    if (action === 'jump' && extra.matchday !== undefined) next = { ...next, matchday: extra.matchday };
    if (action === 'end') next = { ...next, matchday: SEASON_MATCHDAYS, playing: false };
    setLocal(next);
    setNow(t);
  };
  return { state, matchday, control, canControl, synced };
}

function Season({ snapshot }: { snapshot: GameSnapshot }) {
  const code = snapshot.game.code;
  const playback = usePlayback(snapshot);
  const season = useSeason(code, playback.state.seasonNumber);
  const [ticker, setTicker] = useState<FixtureView | null>(null);
  const [mobileTab, setMobileTab] = useState<'results' | 'table'>('results');
  const [viewDay, setViewDay] = useState<number | null>(null);

  if (!season.data) return <div className="card h-96 animate-pulse" aria-label="Loading the season" />;
  const data = season.data;
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  const md = playback.matchday;
  // While playing, follow the live matchday; a user can browse back to an earlier one.
  const shownDay = viewDay !== null && viewDay <= md ? viewDay : md;
  const table = md > 0 ? data.standings[md - 1]! : initialTable(data);
  const prevTable = md > 1 ? data.standings[md - 2] : undefined;
  const fixtures = data.fixtures.filter((f) => f.matchday === Math.max(1, shownDay));
  const done = md >= SEASON_MATCHDAYS;

  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="display text-pitch-500">
            {snapshot.game.name} · Season {data.number}
          </p>
          <h1 className="display text-4xl">{md === 0 ? 'Kickoff' : done ? 'Full time' : `Matchday ${md} of ${SEASON_MATCHDAYS}`}</h1>
        </div>
        <Link to={`/league/${code}`} className="btn-ghost">
          League Teams
        </Link>
        <Link to={`/results/${code}?season=${data.number}`} className={done ? 'btn-primary' : 'btn-ghost'}>
          {done ? 'Season results' : 'Results'}
        </Link>
      </header>

      <Controls snapshot={snapshot} playback={playback} />

      {done ? <ChampionBanner season={data} teams={teams} /> : null}

      <div className="flex gap-1 lg:hidden" role="tablist">
        {(['results', 'table'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={mobileTab === k} onClick={() => setMobileTab(k)} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold capitalize ${mobileTab === k ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 dark:bg-night-700'}`}>
            {k}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <section className={`card p-4 ${mobileTab === 'results' ? '' : 'hidden lg:block'}`}>
          <div className="flex items-center gap-2">
            <h2 className="display min-w-0 flex-1 text-xl">{md === 0 ? 'Matchday 1 fixtures' : `Matchday ${shownDay} results`}</h2>
            {md > 0 ? (
              <label className="text-sm">
                <span className="sr-only">Show matchday</span>
                <select className="input min-h-9 py-1" value={shownDay} onChange={(e) => setViewDay(Number(e.target.value) === md ? null : Number(e.target.value))}>
                  {Array.from({ length: md }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      MD {d}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fixtures.map((f) => (
              <FixtureCard key={f.id} fixture={f} teams={teams} played={md > 0} onOpen={() => setTicker(f)} />
            ))}
          </ul>
          <KeyMoments season={data} upTo={md} />
        </section>
        <section className={`card p-4 ${mobileTab === 'table' ? '' : 'hidden lg:block'}`}>
          <h2 className="display text-xl">Table</h2>
          <LeagueTable rows={table} prev={prevTable} teams={teams} final={done} />
        </section>
      </div>

      <Extras snapshot={snapshot} />
      {ticker ? <Ticker fixture={ticker} teams={teams} onClose={() => setTicker(null)} /> : null}
    </div>
  );
}

function initialTable(season: SeasonView): StandingView[] {
  return [...season.teams]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t, i) => ({ teamId: t.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, position: i + 1, form: '' }));
}

// ---------- Controls ----------

function Controls({ snapshot, playback }: { snapshot: GameSnapshot; playback: ReturnType<typeof usePlayback> }) {
  const { state, matchday, control, canControl, synced } = playback;
  const seasons = snapshot.seasons;
  return (
    <section className="card flex flex-wrap items-center gap-2 p-3" aria-label="Playback controls">
      {canControl ? (
        <>
          <button type="button" className="btn-primary min-w-24" onClick={() => control(state.playing ? 'pause' : 'play')}>
            {state.playing ? 'Pause' : matchday >= SEASON_MATCHDAYS ? 'Replay' : 'Play'}
          </button>
          <div className="flex gap-1" role="group" aria-label="Speed">
            {([1, 2, 5] as const).map((s) => (
              <button key={s} type="button" aria-pressed={state.speed === s} className={`min-h-11 rounded-xl px-3 font-semibold ${state.speed === s ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 dark:bg-night-700'}`} onClick={() => control('speed', { speed: s })}>
                {s}x
              </button>
            ))}
            <button type="button" className="btn-secondary" onClick={() => control('end')}>
              Instant
            </button>
          </div>
          <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
            <span className="text-slate-500">MD</span>
            <input type="range" min={0} max={SEASON_MATCHDAYS} value={matchday} onChange={(e) => control('jump', { matchday: Number(e.target.value) })} className="flex-1 accent-pitch-500" aria-label="Jump to matchday" />
            <span className="w-6 tabular-nums">{matchday}</span>
          </label>
        </>
      ) : (
        <p className="flex-1 text-sm text-slate-500">
          The host controls playback · {state.playing ? `playing at ${state.speed}x` : 'paused'}
        </p>
      )}
      {seasons.length > 1 ? (
        <label className="text-sm">
          <span className="sr-only">Season</span>
          <select className="input min-h-11" value={state.seasonNumber} disabled={!canControl} onChange={(e) => control('jump', { matchday: 0, seasonNumber: Number(e.target.value) })}>
            {seasons.map((s) => (
              <option key={s.number} value={s.number}>
                Season {s.number}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="text-xs text-slate-500">{synced ? 'Synchronized' : 'Own pace'} · {MATCHDAY_MS / 1000}s per matchday at 1x</span>
    </section>
  );
}

// ---------- Results ----------

function TeamMark({ team, size = 'sm' }: { team: LeagueTeamView | undefined; size?: 'sm' | 'md' }) {
  if (!team) return null;
  return team.kind === 'human' ? (
    <TeamBadge color={team.primaryColor} monogram={team.monogram} size="sm" />
  ) : (
    <ClubShield primary={team.primaryColor} secondary={team.secondaryColor} text={team.monogram} size={size === 'sm' ? 'sm' : 'md'} />
  );
}

function FixtureCard({ fixture, teams, played, onOpen }: { fixture: FixtureView; teams: Map<string, LeagueTeamView>; played: boolean; onOpen: () => void }) {
  const home = teams.get(fixture.homeTeamId);
  const away = teams.get(fixture.awayTeamId);
  const human = home?.kind === 'human' || away?.kind === 'human';
  const scorers = (teamId: string) =>
    fixture.events
      .filter((e) => e.type === 'goal' && e.teamId === teamId)
      .map((e) => `${e.playerName.split(' ').at(-1)} ${e.minute}'`)
      .join(', ');
  return (
    <li>
      <button type="button" disabled={!played} onClick={onOpen} className={`animate-reveal w-full rounded-xl p-3 text-left ${human ? 'bg-pitch-500/15 ring-1 ring-pitch-500' : 'bg-slate-100 dark:bg-night-900'} disabled:cursor-default`}>
        {[home, away].map((team, i) => {
          const goals = i === 0 ? fixture.homeGoals : fixture.awayGoals;
          return (
            <div key={i} className="flex items-center gap-2">
              <TeamMark team={team} />
              <span className="min-w-0 flex-1 truncate font-semibold">{team?.name}</span>
              <span className="display w-6 text-right text-xl tabular-nums">{played ? goals : '-'}</span>
            </div>
          );
        })}
        {played ? (
          <p className="mt-1 truncate text-[11px] text-slate-500">
            {[scorers(fixture.homeTeamId), scorers(fixture.awayTeamId)].filter(Boolean).join(' · ') || 'No goals'}
          </p>
        ) : null}
      </button>
    </li>
  );
}

function KeyMoments({ season, upTo }: { season: SeasonView; upTo: number }) {
  const moments = season.keyMoments.filter((m) => m.matchday <= upTo).reverse().slice(0, 12);
  if (upTo === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="display text-lg">Key moments</h3>
      {moments.length === 0 ? <p className="text-sm text-slate-500">Nothing dramatic yet.</p> : null}
      <ul className="mt-1 grid gap-1 text-sm" aria-live="polite">
        {moments.map((m, i) => (
          <li key={`${m.matchday}-${i}-${m.kind}`} className="flex gap-2">
            <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500">MD{m.matchday}</span>
            <span className="min-w-0 flex-1">{m.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Table ----------

/** Colour bands: champion, top four, next two, bottom three (spec section 10). */
function band(position: number): string {
  if (position === 1) return 'border-l-4 border-gold-500';
  if (position <= 4) return 'border-l-4 border-pitch-500';
  if (position <= 6) return 'border-l-4 border-sky-500';
  if (position >= 18) return 'border-l-4 border-red-500';
  return 'border-l-4 border-transparent';
}

function LeagueTable({ rows, prev, teams, final }: { rows: StandingView[]; prev: StandingView[] | undefined; teams: Map<string, LeagueTeamView>; final: boolean }) {
  const prevPos = new Map(prev?.map((r) => [r.teamId, r.position]));
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="w-8 text-left">#</th>
            <th className="text-left">Team</th>
            <th className="w-7">P</th>
            <th className="hidden w-7 sm:table-cell">W</th>
            <th className="hidden w-7 sm:table-cell">D</th>
            <th className="hidden w-7 sm:table-cell">L</th>
            <th className="w-9">GD</th>
            <th className="w-9">Pts</th>
            <th className="hidden w-20 md:table-cell">Form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const team = teams.get(r.teamId);
            const before = prevPos.get(r.teamId);
            const move = before === undefined ? 0 : before - r.position;
            return (
              <tr key={r.teamId} className={`${band(r.position)} ${team?.kind === 'human' ? 'bg-pitch-500/10 font-semibold' : ''}`}>
                <td className="py-1 pl-1 tabular-nums">
                  {r.position}
                  {move !== 0 ? (
                    <span className={`ml-0.5 text-[10px] ${move > 0 ? 'text-pitch-500' : 'text-red-400'}`} aria-label={move > 0 ? `up ${move}` : `down ${-move}`}>
                      {move > 0 ? '▲' : '▼'}
                    </span>
                  ) : null}
                </td>
                <td className="max-w-0 py-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TeamMark team={team} />
                    <span className="truncate">{team?.name}</span>
                    {team?.kind === 'human' ? <span className="rounded bg-pitch-500 px-1 text-[9px] font-bold text-night-950">YOU</span> : null}
                    {final && r.position === 1 ? <span aria-label="Champion">🏆</span> : null}
                  </span>
                </td>
                <td className="text-center tabular-nums">{r.played}</td>
                <td className="hidden text-center tabular-nums sm:table-cell">{r.won}</td>
                <td className="hidden text-center tabular-nums sm:table-cell">{r.drawn}</td>
                <td className="hidden text-center tabular-nums sm:table-cell">{r.lost}</td>
                <td className="text-center tabular-nums">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                <td className="text-center font-bold tabular-nums">{r.points}</td>
                <td className="hidden md:table-cell">
                  <span className="flex gap-0.5">
                    {r.form.split('').map((c, i) => (
                      <span key={i} className={`grid size-4 place-items-center rounded text-[9px] font-bold text-white ${c === 'W' ? 'bg-pitch-600' : c === 'D' ? 'bg-slate-500' : 'bg-red-600'}`}>
                        {c}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span>
          <span className="mr-1 inline-block size-2 bg-gold-500" />
          Champion
        </span>
        <span>
          <span className="mr-1 inline-block size-2 bg-pitch-500" />
          Top four
        </span>
        <span>
          <span className="mr-1 inline-block size-2 bg-sky-500" />
          5th to 6th
        </span>
        <span>
          <span className="mr-1 inline-block size-2 bg-red-500" />
          Bottom three
        </span>
      </p>
    </div>
  );
}

function ChampionBanner({ season, teams }: { season: SeasonView; teams: Map<string, LeagueTeamView> }) {
  const champ = season.championTeamId ? teams.get(season.championTeamId) : undefined;
  const row = season.standings.at(-1)?.[0];
  if (!champ || !row) return null;
  return (
    <section className="card relative overflow-hidden p-6 text-center ring-2 ring-gold-500" role="status">
      <Confetti />
      <p className="text-5xl" aria-hidden>
        🏆
      </p>
      <p className="display mt-2 text-gold-500">Champions</p>
      <h2 className="display text-4xl">{champ.name}</h2>
      <p className="mt-1 text-slate-500">
        {row.points} points · {row.won}W {row.drawn}D {row.lost}L · GD {row.goalDifference > 0 ? '+' : ''}
        {row.goalDifference}
        {champ.kind === 'human' ? ' · a drafted team!' : ''}
      </p>
    </section>
  );
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 9) * 0.15, color: ['#f5b700', '#22c55e', '#3b82f6', '#ec4899'][i % 4]! })), []);
  return (
    <div className="pointer-events-none absolute inset-0 motion-reduce:hidden" aria-hidden>
      <style>{'@keyframes fall{0%{transform:translateY(-20px) rotate(0)}100%{transform:translateY(260px) rotate(540deg);opacity:0}}'}</style>
      {pieces.map((p, i) => (
        <span key={i} className="absolute top-0 h-3 w-1.5 rounded-sm" style={{ left: `${p.left}%`, background: p.color, animation: `fall 2.4s ${p.delay}s ease-in both` }} />
      ))}
    </div>
  );
}

// ---------- Ticker ----------

function Ticker({ fixture, teams, onClose }: { fixture: FixtureView; teams: Map<string, LeagueTeamView>; onClose: () => void }) {
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    if (minute >= 94) return;
    const id = setTimeout(() => setMinute((m) => Math.min(94, m + 2)), 60);
    return () => clearTimeout(id);
  }, [minute]);
  const home = teams.get(fixture.homeTeamId);
  const away = teams.get(fixture.awayTeamId);
  const events = fixture.events.filter((e) => e.minute <= minute);
  const goals = (id: string) => events.filter((e) => e.type === 'goal' && e.teamId === id).length;
  const icon = { goal: '⚽', assist: '🅰️', yellow: '🟨', red: '🟥' } as const;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-night-950/70 p-3" role="dialog" aria-label="Match ticker" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TeamMark team={home} />
            <span className="truncate font-semibold">{home?.name}</span>
          </div>
          <span className="display text-3xl tabular-nums">
            {goals(fixture.homeTeamId)} - {goals(fixture.awayTeamId)}
          </span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <span className="truncate text-right font-semibold">{away?.name}</span>
            <TeamMark team={away} />
          </div>
        </div>
        <p className="mt-1 text-center text-xs text-slate-500">{minute >= 94 ? 'Full time' : `${minute}'`}</p>
        <ol className="mt-3 grid max-h-80 gap-1 overflow-y-auto text-sm" aria-live="polite">
          {events.map((e, i) => (
            <li key={i} className={`flex gap-2 ${e.teamId === fixture.awayTeamId ? 'flex-row-reverse text-right' : ''}`}>
              <span className="w-8 shrink-0 text-xs tabular-nums text-slate-500">{e.minute}'</span>
              <span aria-hidden>{icon[e.type]}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.playerName}
                <span className="sr-only"> {e.type}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => setMinute(94)}>
            Skip to full time
          </button>
          <button type="button" className="btn-primary flex-1" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Run It Back, multi-season, Expected Strength ----------

function Extras({ snapshot }: { snapshot: GameSnapshot }) {
  const code = snapshot.game.code;
  const isHost = snapshot.me.isHost || snapshot.me.isAdmin;
  const { run, busy } = useAction();
  const qc = useQueryClient();
  const [count, setCount] = useState(5);
  const [showMc, setShowMc] = useState(false);
  const history = useQuery({
    queryKey: ['seasons', code, snapshot.seasons.length],
    queryFn: () => api<{ titles: TitlesRow[] }>(`/api/games/${code}/seasons`),
  });
  const mc = useQuery({
    queryKey: ['montecarlo', code],
    enabled: showMc,
    staleTime: Infinity,
    queryFn: () => api<MonteCarloView>(`/api/games/${code}/montecarlo?runs=1000`),
  });
  const runMore = async (n: number) => {
    await run(`/api/games/${code}/seasons`, 'POST', { count: n });
    void qc.invalidateQueries({ queryKey: ['seasons', code] });
  };
  const busySim = snapshot.game.status === 'simulating';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="card p-4">
        <h2 className="display text-xl">More seasons</h2>
        {isHost ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" disabled={busy || busySim} onClick={() => void runMore(1)}>
              Run It Back
            </button>
            <label className="flex items-center gap-2 text-sm">
              <span>Multi-season</span>
              <select className="input min-h-11 w-20" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-secondary" disabled={busy || busySim} onClick={() => void runMore(count)}>
              Simulate {count} seasons
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">The host can replay the season with a new seed or run several at once.</p>
        )}
        {snapshot.seasons.length > 1 && history.data ? (
          <>
            <h3 className="display mt-4 text-lg">Titles across {snapshot.seasons.length} seasons</h3>
            <table className="mt-1 w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="text-left">Team</th>
                  <th>Titles</th>
                  <th>Avg pos</th>
                  <th>Avg pts</th>
                </tr>
              </thead>
              <tbody>
                {history.data.titles.slice(0, 10).map((r) => (
                  <tr key={r.name} className={r.kind === 'human' ? 'font-semibold text-pitch-600 dark:text-pitch-400' : ''}>
                    <td className="truncate py-0.5">{r.name}</td>
                    <td className="text-center tabular-nums">{r.titles}</td>
                    <td className="text-center tabular-nums">{r.avgPosition.toFixed(1)}</td>
                    <td className="text-center tabular-nums">{r.avgPoints.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>
      <section className="card p-4">
        <h2 className="display text-xl">Expected Strength</h2>
        <p className="text-sm text-slate-500">1,000 simulated seasons of these 20 teams.</p>
        {!showMc ? (
          <button type="button" className="btn-secondary mt-3" onClick={() => setShowMc(true)}>
            Run 1,000 seasons
          </button>
        ) : mc.isLoading ? (
          <p className="mt-3 text-sm" role="status">
            Simulating 380,000 matches…
          </p>
        ) : mc.data ? (
          <MonteCarloTable data={mc.data} />
        ) : (
          <p className="mt-3 text-sm text-red-400">{mc.error?.message}</p>
        )}
      </section>
    </div>
  );
}

function MonteCarloTable({ data }: { data: MonteCarloView }) {
  const max = Math.max(...data.rows.map((r) => r.titleChance), 0.01);
  const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="text-left">Team</th>
            <th>Pts</th>
            <th className="hidden sm:table-cell">Pos</th>
            <th className="text-left">Title</th>
            <th>Top 4</th>
            <th>Bottom 3</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.teamId} className={r.kind === 'human' ? 'font-semibold text-pitch-600 dark:text-pitch-400' : ''}>
              <td className="max-w-32 truncate py-0.5">{r.name}</td>
              <td className="text-center tabular-nums">{r.avgPoints.toFixed(1)}</td>
              <td className="hidden text-center tabular-nums sm:table-cell">{r.avgPosition.toFixed(1)}</td>
              <td className="w-32">
                <span className="flex items-center gap-1">
                  <span className="h-2 rounded bg-gold-500" style={{ width: `${(r.titleChance / max) * 70}%` }} aria-hidden />
                  <span className="text-xs tabular-nums">{pct(r.titleChance)}</span>
                </span>
              </td>
              <td className="text-center text-xs tabular-nums">{pct(r.top4Chance)}</td>
              <td className="text-center text-xs tabular-nums">{pct(r.bottom3Chance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        {data.goalsPerMatch.toFixed(2)} goals per match · home wins {(data.homeWinRate * 100).toFixed(0)}%
      </p>
    </div>
  );
}
