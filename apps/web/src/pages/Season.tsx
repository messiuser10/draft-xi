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
} from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ClubShield } from '../components/Kickoff';
import { RoundOver, SeasonLeaders, SeriesLeaderboard, TransferWindow } from '../components/Round';
import { TeamBadge } from '../components/TeamBadge';
import { api } from '../lib/api';
import { useSeason } from '../lib/league';
import { usePool } from '../lib/pool';
import { BAND_BORDER, bandFor, useSite } from '../lib/session';
import { useGame } from '../lib/socket';
import { PageSkeleton } from '../components/Skeleton';
import { ErrorCard } from '../components/ErrorBoundary';

export function SeasonPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot, error } = useGame(code);
  if (error) return <ErrorCard title="Could not load this page" message={error} />;
  if (!snapshot) return <PageSkeleton />;
  const { status } = snapshot.game;
  if (status === 'lobby') return <Navigate to={`/lobby/${code}`} replace />;
  if (status === 'drafting' || status === 'paused') return <Navigate to={`/draft/${code}`} replace />;
  if (status === 'draft_complete') return <Navigate to={`/reveal/${code}`} replace />;
  if (status === 'simulating' && snapshot.seasons.length === 0) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center" role="status">
        <p className="display text-3xl">Simulating the season…</p>
        <p className="mt-2 text-slate-500">190 matches, one moment.</p>
      </div>
    );
  }
  return <Season snapshot={snapshot} />;
}

/** Matchdays played so far in a season: 19 while its mid-season window is open, else 38. */
export function capOf(snapshot: GameSnapshot, seasonNumber: number): number {
  return snapshot.seasons.find((s) => s.number === seasonNumber)?.matchdays ?? SEASON_MATCHDAYS;
}

/** Playback on this screen only: every player watches at their own speed and can skip ahead. */
function usePlayback(snapshot: GameSnapshot) {
  const shared = snapshot.playback;
  const latest = snapshot.seasons.at(-1);
  const [local, setLocal] = useState<PlaybackState>(() => {
    // "Simulate to the end" on the reveal page opens the season on the final table.
    let skip = false;
    try {
      skip = sessionStorage.getItem(`skip:${snapshot.game.code}`) === '1';
      sessionStorage.removeItem(`skip:${snapshot.game.code}`);
    } catch {
      /* storage unavailable */
    }
    const seasonNumber = shared?.seasonNumber ?? snapshot.seasons.at(-1)?.number ?? 1;
    const cap = capOf(snapshot, seasonNumber);
    // Already watched this half (a reload): open at the break. Otherwise start where this half starts.
    const me = snapshot.me.participantId;
    const seen = skip || (me !== null && (snapshot.round?.watched ?? []).includes(me));
    const from = shared?.seasonNumber === seasonNumber ? Math.min(shared.matchday, cap) : 0;
    return { seasonNumber, matchday: seen ? cap : from, playing: !seen, speed: 1, anchorAt: new Date().toISOString(), cap };
  });
  const [now, setNow] = useState(() => Date.now());
  // Own pace: when the next half or the next season arrives, carry on from where this screen is.
  const progress = `${latest?.number ?? 0}:${latest?.matchdays ?? 0}`;
  const [seen, setSeen] = useState(progress);
  if (seen !== progress) {
    setSeen(progress);
    const t = now;
    const at = playbackMatchday(local, t);
    if (latest && latest.number !== local.seasonNumber) {
      setLocal({ ...local, seasonNumber: latest.number, matchday: 0, playing: true, anchorAt: new Date(t).toISOString(), cap: latest.matchdays });
    } else {
      setLocal({ ...local, matchday: at, playing: true, anchorAt: new Date(t).toISOString(), cap: capOf(snapshot, local.seasonNumber) });
    }
  }
  const cap = capOf(snapshot, local.seasonNumber);
  const state: PlaybackState = { ...local, cap: Math.min(local.cap ?? SEASON_MATCHDAYS, cap) };
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.playing]);
  const matchday = playbackMatchday(state, now);

  const control = (action: 'play' | 'pause' | 'speed' | 'jump' | 'end', extra: { speed?: PlaybackSpeed; matchday?: number; seasonNumber?: number } = {}) => {
    const t = Date.now();
    const cur = playbackMatchday(local, t);
    let next: PlaybackState = { ...local, matchday: cur, anchorAt: new Date(t).toISOString() };
    if (extra.seasonNumber !== undefined && extra.seasonNumber !== local.seasonNumber) next = { ...next, seasonNumber: extra.seasonNumber, matchday: 0 };
    const c = capOf(snapshot, next.seasonNumber);
    next = { ...next, cap: c };
    if (action === 'play') next = { ...next, playing: true, matchday: next.matchday >= c ? 0 : next.matchday };
    if (action === 'pause') next = { ...next, playing: false };
    if (action === 'speed' && extra.speed) next = { ...next, speed: extra.speed };
    if (action === 'jump' && extra.matchday !== undefined) next = { ...next, matchday: Math.min(c, extra.matchday) };
    if (action === 'end') next = { ...next, matchday: c, playing: false };
    setLocal(next);
    setNow(t);
  };
  const skipToEnd = () => control('end');
  return { state, matchday, cap, control, skipToEnd };
}

function Season({ snapshot }: { snapshot: GameSnapshot }) {
  const code = snapshot.game.code;
  const playback = usePlayback(snapshot);
  // Keyed by what the list says was played, so a season stored again after its second half is refetched.
  const season = useSeason(code, playback.state.seasonNumber, snapshot.seasons.find((s) => s.number === playback.state.seasonNumber)?.matchdays ?? 0);
  const pool = usePool();
  const [ticker, setTicker] = useState<FixtureView | null>(null);
  const [mobileTab, setMobileTab] = useState<'results' | 'table'>('results');
  const [viewDay, setViewDay] = useState<number | null>(null);
  const [touchX, setTouchX] = useState<number | null>(null);

  if (!season.data) return <PageSkeleton label="Loading the season" />;
  const data = season.data;
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  // Never past what the loaded season holds (it may be a moment behind the playback state).
  const md = Math.min(playback.matchday, data.standings.length);
  // While playing, follow the live matchday; a user can browse back to an earlier one.
  const shownDay = viewDay !== null && viewDay <= md ? viewDay : md;
  const table = md > 0 ? data.standings[md - 1]! : initialTable(data);
  const prevTable = md > 1 ? data.standings[md - 2] : undefined;
  const fixtures = data.fixtures.filter((f) => f.matchday === Math.max(1, shownDay));
  const done = md >= SEASON_MATCHDAYS && data.standings.length >= SEASON_MATCHDAYS;
  const cap = playback.cap;
  // The mid-season break: the first half is over and the window is open.
  const atBreak = cap < SEASON_MATCHDAYS && md >= cap;
  const round = snapshot.round;
  const latest = snapshot.seasons.at(-1)?.number ?? 1;
  const isLatest = data.number === latest;
  // This screen has reached the break (or the end of the round) for the latest season.
  const reached =
    round !== null && isLatest && ((round.phase === 'mini' && atBreak) || ((round.phase === 'big' || round.phase === 'over') && done && round.seasonNumber === data.number));
  const everyone = round?.allWatched ?? true;
  const showWindow = reached && everyone && (round.phase === 'mini' || round.phase === 'big');
  const showRoundOver = reached && everyone && round.phase === 'over';
  const showWaiting = reached && !everyone;
  const busy = snapshot.game.status === 'simulating';
  const skipToEnd = () => {
    playback.skipToEnd();
    setViewDay(null);
    setMobileTab('table');
    // Bring the champion (or the transfer window) into view once the table is shown.
    setTimeout(() => (document.getElementById('window') ?? document.getElementById('champion'))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="display text-pitch-500">
            {snapshot.game.name} · Round {round?.roundNumber ?? 1} · Season {data.number} of 2
          </p>
          <h1 className="display text-4xl">{md === 0 ? 'Kickoff' : done ? 'Full time' : atBreak ? 'Half-way: transfer window' : `Matchday ${md} of ${SEASON_MATCHDAYS}`}</h1>
        </div>
        <Link to={`/league/${code}`} className="btn-ghost">
          League Teams
        </Link>
        {done ? (
          <Link to={`/results/${code}?season=${data.number}`} className="btn-primary">
            Season results →
          </Link>
        ) : atBreak ? null : (
          <button type="button" className="btn-primary" onClick={skipToEnd}>
            {cap < SEASON_MATCHDAYS ? '⏭ Skip to mid-season' : '⏭ Skip to the end'}
          </button>
        )}
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-night-700" role="progressbar" aria-label="Season progress" aria-valuemin={0} aria-valuemax={SEASON_MATCHDAYS} aria-valuenow={md}>
          <div className="h-full rounded-full bg-gradient-to-r from-pitch-600 to-pitch-400 transition-[width] duration-500" style={{ width: `${(md / SEASON_MATCHDAYS) * 100}%` }} />
        </div>
      </header>

      <Controls snapshot={snapshot} playback={playback} onSkip={skipToEnd} />

      {busy && isLatest ? (
        <section className="card p-4 text-center" role="status">
          <p className="display text-2xl">Simulating the next half…</p>
        </section>
      ) : null}
      {done ? <ChampionBanner season={data} teams={teams} /> : null}
      <WatchedReporter snapshot={snapshot} reached={reached} />
      {showWaiting ? <WaitingForOthers snapshot={snapshot} /> : null}
      {showWindow && pool.data ? <TransferWindow snapshot={snapshot} pool={pool.data} /> : null}
      {showRoundOver ? <RoundOver snapshot={snapshot} /> : null}
      {done ? <SeasonLeaders season={data} title={`Season ${data.number} stats`} /> : atBreak ? <SeasonLeaders season={data} title="Half-season stats" /> : null}

      <div className="flex gap-1 lg:hidden" role="tablist">
        {(['results', 'table'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={mobileTab === k} onClick={() => setMobileTab(k)} className={`min-h-10 flex-1 rounded-xl text-sm font-semibold capitalize ${mobileTab === k ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 dark:bg-night-700'}`}>
            {k}
          </button>
        ))}
      </div>

      {/* On phones the results and the table are tabs; a horizontal swipe switches between them. */}
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]"
        onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const end = e.changedTouches[0]?.clientX;
          if (touchX !== null && end !== undefined && Math.abs(end - touchX) > 60) setMobileTab(end < touchX ? 'table' : 'results');
          setTouchX(null);
        }}
      >
        <section className={`card animate-reveal p-4 ${mobileTab === 'results' ? '' : 'hidden lg:block'}`}>
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
        <section className={`card animate-reveal p-4 ${mobileTab === 'table' ? '' : 'hidden lg:block'}`}>
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

/** Tells the server once this player has watched up to the break, so the window can open for all. */
function WatchedReporter({ snapshot, reached }: { snapshot: GameSnapshot; reached: boolean }) {
  const me = snapshot.me.participantId;
  const round = snapshot.round;
  const already = me === null || !round || round.watched.includes(me);
  const key = round ? `${round.phase}:${round.seasonNumber}` : '';
  const code = snapshot.game.code;
  useEffect(() => {
    if (!reached || already) return;
    void api(`/api/games/${code}/window/watched`, { method: 'POST' }).catch(() => undefined);
  }, [reached, already, key, code]);
  return null;
}

function WaitingForOthers({ snapshot }: { snapshot: GameSnapshot }) {
  const round = snapshot.round!;
  const waiting = snapshot.participants.filter((p) => p.teamName !== null && !p.isBot && p.isConnected && !round.watched.includes(p.id));
  const next = round.phase === 'over' ? 'the final results' : 'the transfer window';
  return (
    <section className="card p-4 text-center ring-2 ring-pitch-500" role="status" aria-live="polite">
      <p className="display text-2xl">⏳ Waiting for everyone to finish watching</p>
      <p className="mt-1 text-slate-500">
        {waiting.length > 0 ? `Still watching: ${waiting.map((p) => p.teamName).join(', ')}.` : 'Almost there…'} Then {next} opens for everyone.
      </p>
    </section>
  );
}

function Controls({ snapshot, playback, onSkip }: { snapshot: GameSnapshot; playback: ReturnType<typeof usePlayback>; onSkip: () => void }) {
  const { state, matchday, control, cap } = playback;
  const seasons = snapshot.seasons;
  return (
    <section className="card flex flex-wrap items-center gap-2 p-3" aria-label="Playback controls">
      <>
          <button type="button" className="btn-primary min-w-24" onClick={() => control(state.playing ? 'pause' : 'play')}>
            {state.playing ? 'Pause' : matchday >= cap ? 'Replay' : 'Play'}
          </button>
          <div className="flex gap-1" role="group" aria-label="Speed">
            {([1, 2, 5] as const).map((s) => (
              <button key={s} type="button" aria-pressed={state.speed === s} className={`min-h-11 rounded-xl px-3 font-semibold ${state.speed === s ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 dark:bg-night-700'}`} onClick={() => control('speed', { speed: s })}>
                {s}x
              </button>
            ))}
            <button type="button" className="btn-secondary" onClick={onSkip} disabled={matchday >= cap}>
              ⏭ {cap < SEASON_MATCHDAYS ? 'Skip to MD 19' : 'Skip to end'}
            </button>
          </div>
          <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
            <span className="text-slate-500">MD</span>
            <input type="range" min={0} max={cap} value={matchday} onChange={(e) => control('jump', { matchday: Number(e.target.value) })} className="flex-1 accent-pitch-500" aria-label="Jump to matchday" />
            <span className="w-6 tabular-nums">{matchday}</span>
          </label>
      </>
      {seasons.length > 1 ? (
        <label className="text-sm">
          <span className="sr-only">Season</span>
          <select className="input min-h-11" value={state.seasonNumber} onChange={(e) => control('jump', { matchday: 0, seasonNumber: Number(e.target.value) })}>
            {seasons.map((s) => (
              <option key={s.number} value={s.number}>
                Season {s.number}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="text-xs text-slate-500">Your own pace · {MATCHDAY_MS / 1000}s per matchday at 1x</span>
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

/** Colour bands from the admin settings (spec section 10). */
function useBand(): (position: number) => string {
  const { data: site } = useSite();
  return (position) => {
    const b = bandFor(site?.tableBands, position);
    return `border-l-4 ${b ? BAND_BORDER[b.color] : 'border-l-transparent'}`;
  };
}

function LeagueTable({ rows, prev, teams, final }: { rows: StandingView[]; prev: StandingView[] | undefined; teams: Map<string, LeagueTeamView>; final: boolean }) {
  const prevPos = new Map(prev?.map((r) => [r.teamId, r.position]));
  const band = useBand();
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
    <section id="champion" className="card relative animate-reveal overflow-hidden p-6 text-center ring-2 ring-gold-500" role="status">
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
        <ol className="mt-3 grid max-h-80 grid-cols-1 gap-1 overflow-y-auto text-sm" aria-live="polite">
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
  const [showMc, setShowMc] = useState(false);
  const mc = useQuery({
    queryKey: ['montecarlo', code, snapshot.round?.moves.length ?? 0],
    enabled: showMc,
    staleTime: Infinity,
    queryFn: () => api<MonteCarloView>(`/api/games/${code}/montecarlo?runs=1000`),
  });
  const showBoard = snapshot.round !== null && snapshot.round.phase !== 'over';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {showBoard ? <SeriesLeaderboard code={code} refreshKey={`${snapshot.round?.phase}:${snapshot.seasons.map((s) => s.matchdays).join(',')}`} /> : null}
      <section className="card p-4">
        <h2 className="display text-xl">Expected Strength</h2>
        <p className="text-sm text-slate-500">1,000 simulated seasons of these 20 teams as they stand now.</p>
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
