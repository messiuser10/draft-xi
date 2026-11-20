/**
 * The draft room (spec section 8). The server owns every rule; this page only previews fits and
 * ratings with the engine and sends picks. State arrives as a snapshot and then small events.
 */
import {
  type FormationId,
  fitsSlot,
  getFormation,
  lineupFromPicks,
  pickTurn,
  POSITIONS,
  rateTeam,
  ROUNDS,
} from '@draft-xi/engine';
import type { GameSnapshot, ParticipantView, PickView, PoolPlayerView } from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Chat } from '../components/Chat';
import { ClubSpin, useSpin } from '../components/ClubSpin';
import { ErrorCard } from '../components/ErrorBoundary';
import { CountdownRing } from '../components/CountdownRing';
import { Kickoff } from '../components/Kickoff';
import { Pitch, type PitchSlot } from '../components/Pitch';
import { TeamBadge, textOn } from '../components/TeamBadge';
import { useAction } from '../lib/actions';
import { api } from '../lib/api';
import { initialsOf, type PoolData, positionsOf, TierBadge, toEngine, usePool } from '../lib/pool';
import { patchDraft, useGame } from '../lib/socket';
import { PageSkeleton } from '../components/Skeleton';

export function DraftPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { snapshot, error } = useGame(code);
  const pool = usePool();
  if (error) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="display text-3xl">Game not found</p>
        <p className="mt-2 text-slate-500">{error}</p>
        <Link to="/" className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    );
  }
  if (pool.error) return <ErrorCard title="Could not load the player pool" message={pool.error.message} />;
  if (!snapshot || !pool.data) return <PageSkeleton label="Loading the draft" />;
  const { status } = snapshot.game;
  if (status === 'lobby') return <Navigate to={`/lobby/${code}`} replace />;
  if (status === 'draft_complete') return <Navigate to={`/reveal/${code}`} replace />;
  if (status === 'simulating' || status === 'completed') return <Navigate to={`/season/${code}`} replace />;
  if (status === 'cancelled') {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="display text-3xl">Game cancelled</p>
        <Link to="/" className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    );
  }
  return <DraftRoom snapshot={snapshot} pool={pool.data} />;
}

// ---------- Derived state ----------

interface TeamState {
  team: ParticipantView;
  picks: PickView[];
  formation: FormationId;
  openKeys: Set<string>;
}

function teamStates(snapshot: GameSnapshot): TeamState[] {
  const picks = snapshot.draft?.picks ?? [];
  return snapshot.participants.map((team) => {
    const formation = team.formation ?? '4-3-3';
    const mine = picks.filter((p) => p.participantId === team.id);
    const filled = new Set(mine.map((p) => p.slotKey));
    return {
      team,
      picks: mine,
      formation,
      openKeys: new Set(getFormation(formation).slots.filter((s) => !filled.has(s.key)).map((s) => s.key)),
    };
  });
}

function pitchSlots(state: TeamState, pool: PoolData): PitchSlot[] {
  return getFormation(state.formation).slots.map((s) => {
    const pick = state.picks.find((p) => p.slotKey === s.key);
    const player = pick ? pool.playersById.get(pick.playerId) : undefined;
    return {
      key: s.key,
      type: s.type,
      x: s.x,
      y: s.y,
      player: player
        ? { name: player.name, overall: player.overall, ringColor: pool.clubsById.get(player.clubId)?.primaryColor ?? '#fff', note: pick?.autoPicked ? 'auto' : undefined }
        : null,
    };
  });
}

function teamRating(state: TeamState, pool: PoolData) {
  const picks = state.picks.flatMap((p) => {
    const player = pool.playersById.get(p.playerId);
    return player ? [{ slotKey: p.slotKey, player: toEngine(player) }] : [];
  });
  const sheet = lineupFromPicks(state.formation, picks, { strict: false });
  // Only the drafted players count towards the preview.
  const real = sheet.lineup.filter((e) => !e.reserve);
  return real.length === 0 ? null : rateTeam(real);
}

function fittingKeys(player: PoolPlayerView, state: TeamState | undefined): string[] {
  if (!state) return [];
  const eng = toEngine(player);
  return getFormation(state.formation)
    .slots.filter((s) => state.openKeys.has(s.key) && fitsSlot(eng, s.type))
    .map((s) => s.key);
}

// ---------- Room ----------

function DraftRoom({ snapshot, pool }: { snapshot: GameSnapshot; pool: PoolData }) {
  const { game, participants, me, draft } = snapshot;
  const code = game.code;
  const settings = game.settings;
  const teams = useMemo(() => teamStates(snapshot), [snapshot]);
  const mine = teams.find((t) => t.team.id === me.participantId);
  const onClock = teams.find((t) => t.team.id === game.currentParticipantId);
  const myTurn = Boolean(mine && onClock && mine.team.id === onClock.team.id && game.status === 'drafting');
  const picks = useMemo(() => draft?.picks ?? [], [draft]);
  const takenBy = useMemo(() => new Map(picks.map((p) => [p.playerId, p.participantId])), [picks]);
  const round = Math.min(ROUNDS, Math.ceil(game.currentPickNumber / Math.max(1, participants.length)));

  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [showKickoff, setShowKickoff] = useState(() => picks.length === 0 && !sessionStorage.getItem(`kickoff:${code}`));
  const { run, busy } = useAction();

  // Club Spin: the pool narrows to the spun club once the reel has landed for this pick.
  const spinOn = settings.clubSpin && settings.draftMode !== 'pack' && game.status !== 'draft_complete';
  const spinQuery = useSpin(code, game.currentPickNumber, spinOn);
  const spin = spinQuery.data?.pickNumber === game.currentPickNumber ? spinQuery.data : null;
  const [landedPick, setLandedPick] = useState<number | null>(null);
  const onLanded = useCallback((n: number) => setLandedPick(n), []);
  const spinLanded = !spinOn || (spin !== null && landedPick === game.currentPickNumber);
  const spunClub = spinOn && spinLanded ? (spin?.clubId ?? null) : null;
  const canPick = myTurn && spinLanded;
  const fromSpunClub = (playerId: number) => spunClub === null || pool.playersById.get(playerId)?.clubId === spunClub;

  // A slot that got filled is no longer selectable.
  const activeSlot = selectedSlot && mine?.openKeys.has(selectedSlot) ? selectedSlot : null;

  const doPick = async (playerId: number, slotKey: string) => {
    const ok = await run(`/api/games/${code}/picks`, 'POST', { playerId, slotKey });
    if (ok) {
      setSelectedPlayer(null);
      setSelectedSlot(null);
    }
  };

  const viewed = mine ?? onClock ?? teams[0];
  const selected = selectedPlayer !== null ? pool.playersById.get(selectedPlayer) : undefined;
  const highlight = new Set(selected && mine && !takenBy.has(selected.id) && (!myTurn || fromSpunClub(selected.id)) ? fittingKeys(selected, mine) : []);
  const lastPick = picks.at(-1);

  return (
    <div className="grid grid-cols-1 gap-4 pb-24">
      {showKickoff ? (
        <div className="card p-5">
          <Kickoff snapshot={snapshot} />
          <button
            type="button"
            className="btn-primary mt-4 w-full"
            onClick={() => {
              sessionStorage.setItem(`kickoff:${code}`, '1');
              setShowKickoff(false);
            }}
          >
            Enter the draft room
          </button>
        </div>
      ) : null}

      <TopBar snapshot={snapshot} onClock={onClock} round={round} myTurn={myTurn} />
      <PickOrderStrip snapshot={snapshot} round={round} />
      {spinOn && spin && onClock && !showKickoff ? (
        <ClubSpin key={spin.pickNumber} spin={spin} pool={pool} teamName={onClock.team.teamName ?? 'This team'} myTurn={myTurn} onLanded={onLanded} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {viewed ? (
            <MyTeamCard
              state={viewed}
              pool={pool}
              isMine={Boolean(mine)}
              selectedSlot={activeSlot}
              highlight={highlight}
              flashKey={lastPick && lastPick.participantId === viewed.team.id ? lastPick.slotKey : null}
              onSlot={(key) => {
                // Drafted players are locked into their slot: filled slots do nothing.
                if (!mine?.openKeys.has(key)) return;
                if (selected && highlight.has(key) && canPick) void doPick(selected.id, key);
                else setSelectedSlot((s) => (s === key ? null : key));
              }}
            />
          ) : null}
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {settings.draftMode === 'pack' && myTurn && mine ? (
            <PackPanel snapshot={snapshot} pool={pool} mine={mine} busy={busy} onPick={doPick} />
          ) : null}
          <PoolPanel
            snapshot={snapshot}
            pool={pool}
            mine={mine}
            myTurn={canPick && settings.draftMode !== 'pack'}
            spinClubId={myTurn ? spunClub : null}
            takenBy={takenBy}
            activeSlot={activeSlot}
            onClearSlot={() => setSelectedSlot(null)}
            onSelect={(id) => setSelectedPlayer(id)}
            onPick={doPick}
            busy={busy}
          />
          <Tabs snapshot={snapshot} pool={pool} teams={teams} takenBy={takenBy} onSelect={setSelectedPlayer} />
          {me.isHost || me.isAdmin ? <HostControls snapshot={snapshot} /> : null}
        </div>
      </div>

      {selected ? (
        <PlayerPanel
          player={selected}
          compare={compareWith !== null ? pool.playersById.get(compareWith) : undefined}
          pool={pool}
          snapshot={snapshot}
          takenBy={takenBy}
          fitting={canPick && settings.draftMode !== 'pack' && !takenBy.has(selected.id) && fromSpunClub(selected.id) ? [...highlight] : []}
          onPick={(slot) => void doPick(selected.id, slot)}
          onCompare={(id) => setCompareWith(id)}
          onClose={() => {
            setSelectedPlayer(null);
            setCompareWith(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------- Top bar and pick order ----------

function TopBar({ snapshot, onClock, round, myTurn }: { snapshot: GameSnapshot; onClock: TeamState | undefined; round: number; myTurn: boolean }) {
  const { game, draft } = snapshot;
  const paused = game.status === 'paused';
  return (
    <div className="sticky top-0 z-20 -mx-4 bg-slate-100/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-0 dark:bg-night-900/95">
      <div className={`card flex flex-wrap items-center gap-3 p-3 ${myTurn ? 'ring-2 ring-pitch-500' : ''}`}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{game.name}</p>
          <p className="display text-base leading-tight sm:text-lg">
            Round {round}/{ROUNDS} · Pick {Math.min(game.currentPickNumber, draft?.totalPicks ?? 0)}/{draft?.totalPicks ?? 0}
          </p>
        </div>
        {onClock ? (
          <div className="flex items-center gap-2">
            <TeamBadge color={onClock.team.color} monogram={onClock.team.monogram} size="sm" />
            <div className="text-sm leading-tight">
              <p className="font-semibold">{myTurn ? "You're on the clock" : onClock.team.teamName}</p>
              <p className="text-xs text-slate-500">
                {onClock.team.isBot ? 'Bot is thinking' : onClock.team.autoDraft ? 'Auto-drafting' : 'On the clock'}
              </p>
            </div>
          </div>
        ) : null}
        <CountdownRing deadline={game.pickDeadline} totalSeconds={game.settings.pickTimerSeconds} pausedMs={game.pausedRemainingMs} />
      </div>
      {paused ? (
        <p className="mt-2 rounded-xl bg-gold-500 px-3 py-2 text-center display text-night-950" role="status">
          Paused by the host · the clock is frozen
        </p>
      ) : null}
    </div>
  );
}

function PickOrderStrip({ snapshot, round }: { snapshot: GameSnapshot; round: number }) {
  const { participants, game } = snapshot;
  const n = participants.length;
  const rounds = [round, round + 1].filter((r) => r <= ROUNDS);
  return (
    <div className="flex gap-3 overflow-x-auto pb-1" aria-label="Pick order">
      {rounds.map((r) => (
        <ol key={r} className={`flex shrink-0 items-center gap-1 ${r === round ? '' : 'opacity-40'}`}>
          <li className="display mr-1 text-xs text-slate-500">R{r}</li>
          {Array.from({ length: n }, (_, i) => {
            const pickNumber = (r - 1) * n + i + 1;
            const team = participants[pickTurn(pickNumber, n, game.settings.draftMode).participantIndex];
            const current = pickNumber === game.currentPickNumber;
            const done = pickNumber < game.currentPickNumber;
            return (
              <li key={pickNumber} title={`Pick ${pickNumber}: ${team?.teamName ?? ''}`} className={`rounded-full p-0.5 ${current ? 'ring-2 ring-gold-400' : ''} ${done ? 'opacity-40' : ''}`}>
                <TeamBadge color={team?.color ?? null} monogram={team?.monogram ?? null} size="sm" />
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

// ---------- My team ----------

function MyTeamCard({
  state,
  pool,
  isMine,
  selectedSlot,
  highlight,
  flashKey,
  onSlot,
}: {
  state: TeamState;
  pool: PoolData;
  isMine: boolean;
  selectedSlot: string | null;
  highlight: ReadonlySet<string>;
  flashKey: string | null;
  onSlot: (key: string) => void;
}) {
  const rating = teamRating(state, pool);
  const [open, setOpen] = useState(true);
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <TeamBadge color={state.team.color} monogram={state.team.monogram} size="sm" />
        <h2 className="display min-w-0 flex-1 truncate text-xl">{isMine ? 'Your XI' : state.team.teamName}</h2>
        <span className="text-xs text-slate-500">{state.formation}</span>
        <button type="button" className="btn-ghost min-h-9 px-2 text-xs lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide pitch' : 'Show pitch'}
        </button>
      </div>
      {open ? (
        <div className="mt-3">
          <Pitch slots={pitchSlots(state, pool)} selectedKey={selectedSlot} highlight={highlight} onSlot={isMine ? onSlot : undefined} flashKey={flashKey} label={`${state.team.teamName ?? 'Team'} formation`} />
          {isMine ? <p className="mt-2 text-xs text-slate-500">Tap an empty slot to filter the pool, or pick a player first to see where he fits. Drafted players are locked in their position.</p> : null}
        </div>
      ) : null}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Meter label="Attack" value={rating?.attack} />
        <Meter label="Defense" value={rating?.defense} />
        <div className="rounded-xl bg-slate-100 p-2 dark:bg-night-900">
          <dt className="text-xs text-slate-500">Chemistry</dt>
          <dd className="display text-xl text-pitch-500">+{(rating?.chemistry ?? 0).toFixed(2)}</dd>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-300 dark:bg-night-700" aria-hidden>
            <div className="h-full bg-pitch-500" style={{ width: `${Math.min(100, ((rating?.chemistry ?? 0) / 3) * 100)}%` }} />
          </div>
        </div>
      </dl>
      <p className="mt-2 text-center text-xs text-slate-500">
        {state.picks.length} of 11 drafted{rating ? ` · average ${rating.overall.toFixed(1)}` : ''}
      </p>
    </section>
  );
}

function Meter({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl bg-slate-100 p-2 dark:bg-night-900">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="display text-xl tabular-nums">{value === undefined ? '-' : value.toFixed(1)}</dd>
    </div>
  );
}

// ---------- Pool ----------

type SortKey = 'overall' | 'name' | 'club';

function PoolPanel({
  snapshot,
  pool,
  mine,
  myTurn,
  takenBy,
  activeSlot,
  onClearSlot,
  onSelect,
  onPick,
  busy,
  spinClubId,
}: {
  snapshot: GameSnapshot;
  pool: PoolData;
  mine: TeamState | undefined;
  myTurn: boolean;
  spinClubId: number | null;
  takenBy: Map<number, number>;
  activeSlot: string | null;
  onClearSlot: () => void;
  onSelect: (id: number) => void;
  onPick: (playerId: number, slotKey: string) => Promise<void>;
  busy: boolean;
}) {
  const [q, setQ] = useState('');
  const [club, setClub] = useState('');
  const [position, setPosition] = useState('');
  const [nationality, setNationality] = useState('');
  const [minOvr, setMinOvr] = useState(40);
  const [maxOvr, setMaxOvr] = useState(99);
  const [fitsOnly, setFitsOnly] = useState(false);
  const [hideTaken, setHideTaken] = useState(false);
  const [sort, setSort] = useState<SortKey>('overall');
  const [limit, setLimit] = useState(60);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  // Tapping an empty slot on the pitch opens the sheet on phones, already filtered to that slot.
  const [lastSlot, setLastSlot] = useState(activeSlot);
  if (lastSlot !== activeSlot) {
    setLastSlot(activeSlot);
    if (activeSlot) setSheetOpen(true);
  }
  const pickAndClose = (playerId: number, slotKey: string) => void onPick(playerId, slotKey).then(() => setSheetOpen(false));
  const queue = snapshot.draft?.myQueue ?? [];
  const teamById = new Map(snapshot.participants.map((p) => [p.id, p]));
  const nationalities = useMemo(() => [...new Set(pool.players.map((p) => p.nationality))].sort(), [pool]);
  const slotType = activeSlot && mine ? getFormation(mine.formation).slots.find((s) => s.key === activeSlot)?.type : undefined;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return pool.players
      .filter((p) => {
        if (needle && !p.name.toLowerCase().includes(needle)) return false;
        if (spinClubId !== null && p.clubId !== spinClubId) return false;
        if (spinClubId === null && club && String(p.clubId) !== club) return false;
        if (position && !positionsOf(p).includes(position as never)) return false;
        if (nationality && p.nationality !== nationality) return false;
        if (p.overall < minOvr || p.overall > maxOvr) return false;
        if (hideTaken && takenBy.has(p.id)) return false;
        if (slotType && !fitsSlot(toEngine(p), slotType)) return false;
        if (fitsOnly && mine && fittingKeys(p, mine).length === 0) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'club') return (pool.clubsById.get(a.clubId)?.name ?? '').localeCompare(pool.clubsById.get(b.clubId)?.name ?? '') || b.overall - a.overall;
        return b.overall - a.overall || a.name.localeCompare(b.name);
      });
  }, [pool, q, club, position, nationality, minOvr, maxOvr, hideTaken, slotType, fitsOnly, mine, sort, takenBy, spinClubId]);
  const spunName = spinClubId === null ? null : (pool.clubsById.get(spinClubId)?.name ?? 'the spun club');

  const toggleQueue = async (id: number) => {
    const next = queue.includes(id) ? queue.filter((x) => x !== id) : [...queue, id];
    patchDraft(snapshot.game.code, { myQueue: next });
    await api(`/api/games/${snapshot.game.code}/queue`, { method: 'PUT', body: { playerIds: next } }).catch(() => patchDraft(snapshot.game.code, { myQueue: queue }));
  };

  const onKeys = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-row]')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[e.key === 'ArrowDown' ? i + 1 : Math.max(0, i - 1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <>
    <button
      type="button"
      className={`btn-primary fixed inset-x-4 bottom-4 z-30 shadow-2xl lg:hidden ${sheetOpen ? 'hidden' : ''} ${myTurn ? 'ring-4 ring-gold-400' : ''}`}
      onClick={() => setSheetOpen(true)}
      aria-controls="player-pool"
      aria-expanded={sheetOpen}
    >
      {myTurn ? (spunName ? `Your pick: ${spunName} players` : 'Your pick: open the player pool') : `Player pool (${list.length})`}
    </button>
    {sheetOpen ? <div className="fixed inset-0 z-30 bg-night-950/60 lg:hidden" aria-hidden onClick={() => setSheetOpen(false)} /> : null}
    <section
      id="player-pool"
      className={`card min-w-0 p-4 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:flex max-lg:max-h-[88dvh] max-lg:flex-col max-lg:rounded-b-none max-lg:shadow-2xl max-lg:transition-transform max-lg:duration-300 ${sheetOpen ? 'max-lg:translate-y-0' : 'max-lg:pointer-events-none max-lg:invisible max-lg:translate-y-full'}`}
      aria-label="Player pool"
    >
      <div className="mx-auto mb-2 h-1.5 w-12 shrink-0 rounded-full bg-slate-300 lg:hidden dark:bg-night-600" aria-hidden />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="display text-xl">Player pool</h2>
        {slotType ? (
          <button type="button" className="rounded-full bg-pitch-500 px-3 py-1 text-xs font-bold text-night-950" onClick={onClearSlot}>
            Filling {activeSlot} ({slotType}) ✕
          </button>
        ) : null}
        {spunName ? (
          <span className="rounded-full bg-gold-400 px-3 py-1 text-xs font-bold text-night-950" title="The wheel decides the club for this pick">
            🔒 {spunName} only
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-500 max-sm:hidden">{list.length} players</span>
        <button type="button" className="btn-ghost ml-auto min-h-9 px-3 text-sm lg:hidden" onClick={() => setSheetOpen(false)}>
          Close
        </button>
      </div>
      <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1 lg:hidden" role="group" aria-label="Quick filters">
        <Chip on={moreFilters} onClick={() => setMoreFilters((v) => !v)}>
          Filters
        </Chip>
        {['', ...POSITIONS].map((pos) => (
          <Chip key={pos || 'all'} on={position === pos} onClick={() => setPosition(pos)}>
            {pos || 'All'}
          </Chip>
        ))}
      </div>
      <div className={`mt-3 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 ${moreFilters ? '' : 'max-lg:[&>*:not(:first-child)]:hidden'}`}>
        <label className="col-span-2">
          <span className="sr-only">Search players</span>
          <input className="input" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          <span className="sr-only">Club</span>
          <select className="input" value={spinClubId === null ? club : String(spinClubId)} disabled={spinClubId !== null} onChange={(e) => setClub(e.target.value)}>
            <option value="">All clubs</option>
            {[...pool.clubs].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Position</span>
          <select className="input" value={position} onChange={(e) => setPosition(e.target.value)}>
            <option value="">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Nationality</span>
          <select className="input" value={nationality} onChange={(e) => setNationality(e.target.value)}>
            <option value="">All nations</option>
            {nationalities.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <span className="text-slate-500">OVR</span>
          <input className="input px-2" type="number" min={40} max={99} value={minOvr} onChange={(e) => setMinOvr(Number(e.target.value) || 40)} aria-label="Minimum overall" />
          <input className="input px-2" type="number" min={40} max={99} value={maxOvr} onChange={(e) => setMaxOvr(Number(e.target.value) || 99)} aria-label="Maximum overall" />
        </label>
        <label>
          <span className="sr-only">Sort by</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="overall">Sort: overall</option>
            <option value="name">Sort: name</option>
            <option value="club">Sort: club</option>
          </select>
        </label>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">
          {mine ? (
            <Chip on={fitsOnly} onClick={() => setFitsOnly((v) => !v)}>
              Fits my open slots
            </Chip>
          ) : null}
          <Chip on={hideTaken} onClick={() => setHideTaken((v) => !v)}>
            Hide drafted
          </Chip>
        </div>
      </div>

      <ul className="mt-3 grid max-h-[32rem] min-h-0 grid-cols-1 content-start gap-1 overflow-y-auto pr-1 max-lg:max-h-none max-lg:flex-1" onKeyDown={onKeys} aria-label="Players">
        {list.length === 0 ? <li className="p-6 text-center text-sm text-slate-500">No players match these filters.</li> : null}
        {list.slice(0, limit).map((p) => {
          const taker = takenBy.get(p.id);
          const takerTeam = taker !== undefined ? teamById.get(taker) : undefined;
          const fits = mine && taker === undefined ? fittingKeys(p, mine) : [];
          const quickSlot = activeSlot && fits.includes(activeSlot) ? activeSlot : fits.length === 1 ? fits[0] : undefined;
          const clubRow = pool.clubsById.get(p.clubId);
          return (
            <li key={p.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${taker !== undefined ? 'opacity-45' : 'hover:bg-slate-100 dark:hover:bg-night-900'}`}>
              <button type="button" data-row className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-pitch-400 rounded-lg" onClick={() => onSelect(p.id)}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ backgroundColor: clubRow?.primaryColor ?? '#334155', color: textOn(clubRow?.primaryColor ?? '#334155'), boxShadow: `inset 0 0 0 2px ${clubRow?.secondaryColor ?? '#fff'}` }} aria-hidden>
                  {initialsOf(p.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold ${taker !== undefined ? 'line-through' : ''}`}>{p.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {positionsOf(p).join(', ')} · {clubRow?.shortName ?? ''} · {p.nationality}
                  </span>
                </span>
                <TierBadge overall={p.overall} />
              </button>
              {takerTeam ? (
                <span className="shrink-0 rounded bg-slate-200 px-1.5 text-[10px] font-bold dark:bg-night-700" title={`Drafted by ${takerTeam.teamName}`}>
                  {takerTeam.monogram}
                </span>
              ) : (
                <>
                  {mine ? (
                    <button type="button" className={`grid size-9 shrink-0 place-items-center rounded-lg text-lg ${queue.includes(p.id) ? 'text-gold-500' : 'text-slate-400'}`} onClick={() => void toggleQueue(p.id)} aria-label={queue.includes(p.id) ? `Remove ${p.name} from queue` : `Add ${p.name} to queue`} aria-pressed={queue.includes(p.id)}>
                      ★
                    </button>
                  ) : null}
                  {myTurn && quickSlot ? (
                    <button type="button" className="btn-primary min-h-9 shrink-0 px-3 text-sm" disabled={busy} onClick={() => pickAndClose(p.id, quickSlot)}>
                      Draft {quickSlot}
                    </button>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
        {list.length > limit ? (
          <li>
            <button type="button" className="btn-ghost w-full" onClick={() => setLimit((l) => l + 100)}>
              Show more ({list.length - limit} left)
            </button>
          </li>
        ) : null}
      </ul>
    </section>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${on ? 'bg-pitch-500 text-night-950' : 'bg-slate-200 dark:bg-night-700'}`}>
      {children}
    </button>
  );
}

// ---------- Pack Pick ----------

function PackPanel({ snapshot, pool, mine, busy, onPick }: { snapshot: GameSnapshot; pool: PoolData; mine: TeamState; busy: boolean; onPick: (playerId: number, slotKey: string) => Promise<void> }) {
  const code = snapshot.game.code;
  const { data } = useQuery({
    queryKey: ['pack', code, snapshot.game.currentPickNumber, mine.team.rerollsLeft],
    queryFn: () => api<{ options: number[] }>(`/api/games/${code}/pack`).then((r) => r.options),
    initialData: snapshot.draft?.pack ?? undefined,
  });
  const { run } = useAction();
  const options = (data ?? []).flatMap((id) => pool.playersById.get(id) ?? []);
  return (
    <section className="card p-4 ring-2 ring-pitch-500">
      <div className="flex items-center gap-2">
        <h2 className="display text-xl">Your pack</h2>
        <button
          type="button"
          className="btn-secondary ml-auto min-h-9 text-sm"
          disabled={mine.team.rerollsLeft < 1}
          onClick={() => void run(`/api/games/${code}/pack/reroll`)}
        >
          Reroll ({mine.team.rerollsLeft} left)
        </button>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5">
        {options.map((p, i) => {
          const fits = fittingKeys(p, mine);
          return (
            <li key={p.id} className="animate-reveal rounded-xl bg-slate-100 p-3 text-center dark:bg-night-900" style={{ animationDelay: `${i * 80}ms` }}>
              <TierBadge overall={p.overall} withLabel />
              <p className="mt-1 truncate font-semibold">{p.name}</p>
              <p className="text-xs text-slate-500">
                {positionsOf(p).join(', ')} · {pool.clubsById.get(p.clubId)?.shortName}
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {fits.map((slot) => (
                  <button key={slot} type="button" className="btn-primary min-h-9 px-2 text-xs" disabled={busy} onClick={() => void onPick(p.id, slot)}>
                    {slot}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- Tabs ----------

type TabKey = 'rivals' | 'activity' | 'queue' | 'chat';

function Tabs({ snapshot, pool, teams, takenBy, onSelect }: { snapshot: GameSnapshot; pool: PoolData; teams: TeamState[]; takenBy: Map<number, number>; onSelect: (id: number) => void }) {
  const [tab, setTab] = useState<TabKey>('activity');
  const tabs: [TabKey, string][] = [
    ['rivals', 'Rivals'],
    ['activity', 'Activity'],
    ...(snapshot.me.participantId !== null ? ([['queue', `Queue (${snapshot.draft?.myQueue.length ?? 0})`]] as [TabKey, string][]) : []),
    ['chat', 'Chat'],
  ];
  return (
    <section className="card p-4">
      <div role="tablist" className="flex gap-1 overflow-x-auto">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${tab === key ? 'bg-pitch-500 text-night-950' : 'hover:bg-slate-200 dark:hover:bg-night-700'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3" role="tabpanel">
        {tab === 'rivals' ? <Rivals snapshot={snapshot} pool={pool} teams={teams} /> : null}
        {tab === 'activity' ? <Activity snapshot={snapshot} pool={pool} /> : null}
        {tab === 'queue' ? <Queue snapshot={snapshot} pool={pool} takenBy={takenBy} onSelect={onSelect} /> : null}
        {tab === 'chat' ? <Chat snapshot={snapshot} bare /> : null}
      </div>
    </section>
  );
}

function Rivals({ snapshot, pool, teams }: { snapshot: GameSnapshot; pool: PoolData; teams: TeamState[] }) {
  const others = teams.filter((t) => t.team.id !== snapshot.me.participantId);
  if (others.length === 0) return <p className="text-sm text-slate-500">No rivals in this draft. It's you against the AI clubs.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {others.map((t) => {
        const r = teamRating(t, pool);
        return (
          <div key={t.team.id}>
            <p className="mb-1 flex items-center gap-1 truncate text-sm font-semibold">
              <TeamBadge color={t.team.color} monogram={t.team.monogram} size="sm" />
              <span className="truncate">{t.team.teamName}</span>
            </p>
            <Pitch compact slots={pitchSlots(t, pool)} label={`${t.team.teamName ?? 'Team'} formation`} />
            <p className="mt-1 text-xs text-slate-500">
              {t.picks.length}/11 · {r ? `ATT ${r.attack.toFixed(0)} DEF ${r.defense.toFixed(0)}` : 'no picks yet'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Activity({ snapshot, pool }: { snapshot: GameSnapshot; pool: PoolData }) {
  const picks = [...(snapshot.draft?.picks ?? [])].reverse();
  const teamById = new Map(snapshot.participants.map((p) => [p.id, p]));
  if (picks.length === 0) return <p className="text-sm text-slate-500">No picks yet. The first one is coming up.</p>;
  return (
    <ol className="grid max-h-80 gap-1 overflow-y-auto text-sm" aria-live="polite">
      {picks.map((p, i) => {
        const team = teamById.get(p.participantId);
        const player = pool.playersById.get(p.playerId);
        return (
          <li key={p.pickNumber} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${i === 0 ? 'animate-reveal bg-slate-100 dark:bg-night-900' : ''}`}>
            <span className="w-14 shrink-0 text-xs tabular-nums text-slate-500">
              #{p.pickNumber} R{p.round}
            </span>
            <TeamBadge color={team?.color ?? null} monogram={team?.monogram ?? null} size="sm" />
            <span className="min-w-0 flex-1 truncate">
              <strong>{team?.teamName}</strong> took {player?.name ?? 'a player'} ({p.slotKey})
            </span>
            {player ? <TierBadge overall={player.overall} /> : null}
            {p.autoPicked ? <span className="rounded bg-gold-500 px-1 text-[10px] font-bold text-night-950">AUTO</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Queue({ snapshot, pool, takenBy, onSelect }: { snapshot: GameSnapshot; pool: PoolData; takenBy: Map<number, number>; onSelect: (id: number) => void }) {
  const code = snapshot.game.code;
  const queue = snapshot.draft?.myQueue ?? [];
  const save = async (next: number[]) => {
    patchDraft(code, { myQueue: next });
    await api(`/api/games/${code}/queue`, { method: 'PUT', body: { playerIds: next } }).catch(() => patchDraft(code, { myQueue: queue }));
  };
  const move = (i: number, d: number) => {
    const next = [...queue];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x!);
    void save(next);
  };
  if (queue.length === 0) return <p className="text-sm text-slate-500">Star players in the pool to queue them. If your clock runs out, the first available one who fits is picked for you.</p>;
  return (
    <ol className="grid gap-1 text-sm">
      {queue.map((id, i) => {
        const p = pool.playersById.get(id);
        const gone = takenBy.has(id);
        return (
          <li key={id} className="flex items-center gap-2 rounded-lg px-2 py-1">
            <span className="w-5 text-xs text-slate-500">{i + 1}</span>
            <button type="button" className={`min-w-0 flex-1 truncate text-left ${gone ? 'line-through opacity-50' : ''}`} onClick={() => onSelect(id)}>
              {p?.name ?? id} {gone ? '(taken)' : ''}
            </button>
            {p ? <TierBadge overall={p.overall} /> : null}
            <button type="button" className="btn-ghost min-h-8 px-2" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}>
              ↑
            </button>
            <button type="button" className="btn-ghost min-h-8 px-2" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === queue.length - 1}>
              ↓
            </button>
            <button type="button" className="btn-ghost min-h-8 px-2" onClick={() => void save(queue.filter((x) => x !== id))} aria-label="Remove">
              ✕
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Player detail ----------

function PlayerPanel({
  player,
  compare,
  pool,
  snapshot,
  takenBy,
  fitting,
  onPick,
  onCompare,
  onClose,
}: {
  player: PoolPlayerView;
  compare: PoolPlayerView | undefined;
  pool: PoolData;
  snapshot: GameSnapshot;
  takenBy: Map<number, number>;
  fitting: string[];
  onPick: (slot: string) => void;
  onCompare: (id: number | null) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const matches = q.length >= 2 ? pool.players.filter((p) => p.id !== player.id && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 p-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem]" role="dialog" aria-label={`${player.name} details`}>
      <div className="card max-h-[70dvh] overflow-y-auto p-4 shadow-2xl">
        <div className="flex items-start gap-2">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <PlayerCard player={player} pool={pool} snapshot={snapshot} takenBy={takenBy} />
            {compare ? <PlayerCard player={compare} pool={pool} snapshot={snapshot} takenBy={takenBy} diffWith={player} /> : null}
          </div>
          <button type="button" className="btn-ghost min-h-9 px-2" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {fitting.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {fitting.map((slot) => (
              <button key={slot} type="button" className="btn-primary flex-1" onClick={() => onPick(slot)}>
                Draft as {slot}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
          {compare ? (
            <button type="button" className="btn-ghost w-full text-sm" onClick={() => onCompare(null)}>
              Stop comparing
            </button>
          ) : picking ? (
            <div>
              <input className="input" autoFocus placeholder="Compare with…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a player to compare" />
              <ul className="mt-1 grid gap-1">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="btn-ghost w-full justify-start text-sm" onClick={() => { onCompare(m.id); setPicking(false); }}>
                      {m.name} · {m.overall}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button type="button" className="btn-secondary w-full text-sm" onClick={() => setPicking(true)}>
              Compare
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerCard({ player, pool, snapshot, takenBy, diffWith }: { player: PoolPlayerView; pool: PoolData; snapshot: GameSnapshot; takenBy: Map<number, number>; diffWith?: PoolPlayerView }) {
  const club = pool.clubsById.get(player.clubId);
  const taker = takenBy.get(player.id);
  const team = snapshot.participants.find((p) => p.id === taker);
  const diff = diffWith ? player.overall - diffWith.overall : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="grid size-12 shrink-0 place-items-center rounded-full display text-lg" style={{ backgroundColor: club?.primaryColor ?? '#334155', color: textOn(club?.primaryColor ?? '#334155'), boxShadow: `inset 0 0 0 3px ${club?.secondaryColor ?? '#fff'}` }} aria-hidden>
          {initialsOf(player.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold">{player.name}</p>
          <p className="truncate text-xs text-slate-500">{club?.name}</p>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
        <dt className="text-slate-500">Overall</dt>
        <dd>
          <TierBadge overall={player.overall} withLabel />
          {diffWith && diff !== 0 ? <span className={`ml-1 text-xs font-bold ${diff > 0 ? 'text-pitch-500' : 'text-red-400'}`}>{diff > 0 ? `+${diff}` : diff}</span> : null}
        </dd>
        <dt className="text-slate-500">Positions</dt>
        <dd>{positionsOf(player).join(', ')}</dd>
        <dt className="text-slate-500">Nation</dt>
        <dd className="truncate">{player.nationality}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd>{team ? `Drafted by ${team.teamName}` : 'Available'}</dd>
      </dl>
    </div>
  );
}

// ---------- Host controls ----------

function HostControls({ snapshot }: { snapshot: GameSnapshot }) {
  const { game, participants } = snapshot;
  const { run, busy } = useAction();
  const base = `/api/games/${game.code}/draft`;
  const paused = game.status === 'paused';
  const humans = participants.filter((p) => !p.isBot);
  return (
    <section className="card p-4">
      <h2 className="display text-xl">Host controls</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(`${base}/${paused ? 'resume' : 'pause'}`)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn-secondary" disabled={busy || paused} onClick={() => void run(`${base}/skip`)}>
          Skip turn
        </button>
        <button type="button" className="btn-secondary" disabled={busy || (snapshot.draft?.picks.length ?? 0) === 0} onClick={() => void run(`${base}/undo`)}>
          Undo last pick
        </button>
        <button type="button" className="btn-secondary" disabled={busy || game.settings.pickTimerSeconds === null} onClick={() => void run(`${base}/extend`, 'POST', { seconds: 30 })}>
          +30 seconds
        </button>
        <button
          type="button"
          className="btn-danger col-span-2"
          disabled={busy}
          onClick={() => {
            if (window.confirm('End the draft now? Every empty slot is filled automatically.')) void run(`${base}/end`);
          }}
        >
          End draft early
        </button>
      </div>
      <label className="label mt-4" htmlFor="dc-policy">
        If a player disconnects for 60 seconds
      </label>
      <select id="dc-policy" className="input" value={game.settings.disconnectPolicy} onChange={(e) => void run(`${base}/disconnect-policy`, 'POST', { policy: e.target.value })}>
        <option value="autopick">Auto-pick for them (queue first)</option>
        <option value="bot">A bot takes over</option>
      </select>
      {humans.length > 0 ? (
        <ul className="mt-4 grid gap-1 text-sm">
          {humans.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${p.isConnected ? 'bg-pitch-500' : 'bg-slate-400'}`} aria-label={p.isConnected ? 'Connected' : 'Disconnected'} />
              <span className="min-w-0 flex-1 truncate">{p.teamName}</span>
              <button type="button" className="btn-ghost min-h-8 px-2 text-xs" disabled={busy} onClick={() => void run(`${base}/bot`, 'POST', { participantId: p.id, enabled: !p.autoDraft })}>
                {p.autoDraft ? 'Hand back' : 'Replace with bot'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
