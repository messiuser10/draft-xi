/**
 * Rounds: captain, transfers and trades (after the draft and in the transfer windows), the
 * window panel, the round-over panel with Play again / Restart, the game leaderboard and the
 * season stat leaders.
 */
import { fitsSlot, getFormation } from '@draft-xi/engine';
import {
  CAPTAIN_BOOST,
  type GameSnapshot,
  type LeagueTeamView,
  type ParticipantView,
  playerValue,
  type PoolPlayerView,
  type SeasonView,
  type SeriesLeaderboardView,
} from '@draft-xi/server/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAction } from '../lib/actions';
import { api } from '../lib/api';
import { type PoolData, positionsOf, TierBadge, toEngine } from '../lib/pool';
import { useRematch, useToasts } from '../lib/socket';
import { useSecondsLeft } from './Countdown';
import { TeamBadge } from './TeamBadge';

type Round = NonNullable<GameSnapshot['round']>;

const WINDOW_TITLE = { mini: 'Mid-season transfer window', big: 'Summer transfer window' } as const;

function slotsOf(p: ParticipantView | undefined) {
  return p?.formation ? getFormation(p.formation).slots : [];
}

const money = (m: number) => `${m}M`;

const playerLabel = (pool: PoolData, id: number | undefined) => {
  const p = id === undefined ? undefined : pool.playersById.get(id);
  return p ? `${p.name} (${positionsOf(p)[0] ?? '?'}, ${p.overall})` : 'Player';
};

// ---------- Squad: captain, transfers, trades ----------

export function SquadManager({ snapshot, pool, round }: { snapshot: GameSnapshot; pool: PoolData; round: Round }) {
  const me = snapshot.participants.find((p) => p.id === snapshot.me.participantId && p.teamName !== null);
  const windowOpen = round.phase === 'mini' || round.phase === 'big';
  if (!me) return null;
  const roster = round.rosters[me.id] ?? {};
  const captain = round.captains[me.id] ?? null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MyXI me={me} roster={roster} captain={captain} pool={pool} round={round} code={snapshot.game.code} canTransfer={windowOpen} />
      <Trades snapshot={snapshot} pool={pool} round={round} me={me} />
    </div>
  );
}

function MyXI({
  me,
  roster,
  captain,
  pool,
  round,
  code,
  canTransfer,
}: {
  me: ParticipantView;
  roster: Record<string, number>;
  captain: number | null;
  pool: PoolData;
  round: Round;
  code: string;
  canTransfer: boolean;
}) {
  const { run, busy } = useAction();
  const [signing, setSigning] = useState<string | null>(null);
  const used = round.transfersUsed[me.id] ?? 0;
  const left = Math.max(0, round.transferLimit - used);
  const budget = round.budgetLeft[me.id] ?? 0;
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="display text-xl">Your XI</h3>
        <p className="text-sm text-slate-500">
          ⭐ Captain gets +{CAPTAIN_BOOST} every match
          {canTransfer ? ` · ${left} of ${round.transferLimit} transfers left` : ''}
        </p>
      </div>
      {canTransfer ? (
        <p className="mt-1 text-sm">
          💰 <strong>{money(budget)}</strong> to spend <span className="text-slate-500">(got {money(round.budgetGrants[me.id] ?? 0)} for your league points; selling a player adds his value)</span>
        </p>
      ) : null}
      <ul className="mt-3 grid gap-1">
        {slotsOf(me).map((slot) => {
          const id = roster[slot.key];
          const player = id === undefined ? undefined : pool.playersById.get(id);
          const isCaptain = id !== undefined && id === captain;
          return (
            <li key={slot.key} className="rounded-xl bg-slate-100 px-2 py-1.5 dark:bg-night-900">
              <div className="flex items-center gap-2">
                <span className="w-10 text-xs font-bold text-slate-500">{slot.key}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{player?.name ?? '—'}</span>
                {player && canTransfer ? <span className="text-xs text-slate-500">{money(playerValue(player.overall))}</span> : null}
                {player ? <TierBadge overall={player.overall} /> : null}
                <button
                  type="button"
                  className={`min-h-9 rounded-lg px-2 text-sm font-bold ${isCaptain ? 'bg-gold-400 text-night-950' : 'bg-slate-200 text-slate-500 dark:bg-night-700'}`}
                  aria-pressed={isCaptain}
                  aria-label={isCaptain ? `${player?.name ?? 'Player'} is captain` : `Make ${player?.name ?? 'player'} captain`}
                  disabled={busy || isCaptain || id === undefined}
                  onClick={() => void run(`/api/games/${code}/captain`, 'PUT', { playerId: id })}
                >
                  {isCaptain ? '⭐ C' : 'C'}
                </button>
                {canTransfer ? (
                  <button type="button" className="btn-ghost min-h-9 px-2 text-sm" disabled={left === 0 && signing !== slot.key} onClick={() => setSigning(signing === slot.key ? null : slot.key)}>
                    {signing === slot.key ? 'Close' : 'Replace'}
                  </button>
                ) : null}
              </div>
              {signing === slot.key ? (
                <SignPlayer
                  slotType={slot.type}
                  current={player}
                  taken={new Set(Object.values(round.rosters).flatMap((r) => Object.values(r)))}
                  budget={budget}
                  pool={pool}
                  busy={busy}
                  onSign={async (playerId) => {
                    if (await run(`/api/games/${code}/transfers`, 'POST', { slotKey: slot.key, playerId })) setSigning(null);
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SignPlayer({
  slotType,
  current,
  taken,
  budget,
  pool,
  busy,
  onSign,
}: {
  slotType: Parameters<typeof fitsSlot>[1];
  current: PoolPlayerView | undefined;
  taken: Set<number>;
  budget: number;
  pool: PoolData;
  busy: boolean;
  onSign: (playerId: number) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  // Selling the current player pays for part of the new one.
  const spend = budget + (current ? playerValue(current.overall) : 0);
  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const affordable = (p: PoolPlayerView) => playerValue(p.overall) <= spend;
    return pool.players
      .filter((p) => !taken.has(p.id) && fitsSlot(toEngine(p), slotType) && (q === '' || p.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(affordable(b)) - Number(affordable(a)) || b.overall - a.overall)
      .slice(0, 30);
  }, [pool, taken, slotType, search, spend]);
  return (
    <div className="mt-2 rounded-xl bg-white p-2 dark:bg-night-800">
      <p className="text-xs text-slate-500">
        Free players who can play {slotType}. {current ? `Selling ${current.name} brings in ${money(playerValue(current.overall))}, so you can spend up to ${money(spend)}.` : ''}
      </p>
      <input className="input mt-1 min-h-9 w-full py-1" placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search free players" />
      <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto">
        {options.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {p.name} <span className="text-xs text-slate-500">{pool.clubsById.get(p.clubId)?.shortName}</span>
            </span>
            <span className={`text-xs font-semibold ${playerValue(p.overall) <= spend ? '' : 'text-red-500'}`}>{money(playerValue(p.overall))}</span>
            <TierBadge overall={p.overall} />
            <button
              type="button"
              className="btn-primary min-h-8 px-2 py-0 text-xs"
              disabled={busy || playerValue(p.overall) > spend}
              title={playerValue(p.overall) > spend ? 'Too expensive' : undefined}
              onClick={() => void onSign(p.id)}
            >
              Sign
            </button>
          </li>
        ))}
        {options.length === 0 ? <li className="text-sm text-slate-500">No free player fits.</li> : null}
      </ul>
    </div>
  );
}

function Trades({ snapshot, pool, round, me }: { snapshot: GameSnapshot; pool: PoolData; round: Round; me: ParticipantView }) {
  const code = snapshot.game.code;
  const { run, busy } = useAction();
  const teams = snapshot.participants.filter((p) => p.teamName !== null && p.id !== me.id);
  const [withId, setWithId] = useState<number | null>(null);
  const partner = teams.find((p) => p.id === withId) ?? teams[0];
  const [give, setGive] = useState<number | null>(null);
  const [get, setGet] = useState<number | null>(null);
  const name = (id: number) => snapshot.participants.find((p) => p.id === id)?.teamName ?? 'A team';
  // In formation order, keeper first.
  const inOrder = (p: ParticipantView | undefined) => slotsOf(p).flatMap((s) => (p && round.rosters[p.id]?.[s.key] !== undefined ? [round.rosters[p.id]![s.key]!] : []));
  const mineList = inOrder(me);
  const theirList = inOrder(partner);
  const push = useToasts((s) => s.push);
  const pending = round.trades.filter((t) => t.status === 'pending' && (t.fromParticipantId === me.id || t.toParticipantId === me.id));
  const recent = round.trades.filter((t) => t.status !== 'pending' && (t.fromParticipantId === me.id || t.toParticipantId === me.id)).slice(-3).reverse();

  const propose = async () => {
    if (!partner || give === null || get === null) return;
    const res = await run<{ trade: { status: string } }>(`/api/games/${code}/trades`, 'POST', { toParticipantId: partner.id, offerPlayerId: give, requestPlayerId: get });
    if (res) {
      setGive(null);
      setGet(null);
      const who = partner.teamName ?? 'They';
      push(res.trade.status === 'accepted' ? `${who} accepted the trade` : res.trade.status === 'declined' ? `${who} declined the trade` : `Offer sent to ${who}`);
    }
  };

  return (
    <section className="card p-4">
      <h3 className="display text-xl">Trades</h3>
      <p className="text-sm text-slate-500">Swap one player for one with another team. No money changes hands and it does not use a transfer. Both teams must agree, and each player must be able to play the other's slot so both formations stay valid.</p>
      {teams.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No other drafting teams.</p>
      ) : (
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-slate-500">Trade with</span>
            <select
              className="input min-h-10"
              value={partner?.id ?? ''}
              onChange={(e) => {
                setWithId(Number(e.target.value));
                setGet(null);
              }}
            >
              {teams.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.teamName}
                  {p.isBot ? ' (bot, answers at once)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-500">You give</span>
              <select className="input min-h-10" value={give ?? ''} onChange={(e) => setGive(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">Choose a player</option>
                {mineList.map((id) => (
                  <option key={id} value={id}>
                    {playerLabel(pool, id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-slate-500">You get</span>
              <select className="input min-h-10" value={get ?? ''} onChange={(e) => setGet(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">Choose a player</option>
                {theirList.map((id) => (
                  <option key={id} value={id}>
                    {playerLabel(pool, id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" className="btn-primary" disabled={busy || give === null || get === null} onClick={() => void propose()}>
            Offer trade
          </button>
        </div>
      )}
      {pending.length > 0 ? (
        <ul className="mt-4 grid gap-2" aria-label="Pending trades">
          {pending.map((t) => {
            const incoming = t.toParticipantId === me.id;
            return (
              <li key={t.id} className={`rounded-xl p-2 text-sm ${incoming ? 'bg-gold-400/15 ring-1 ring-gold-400' : 'bg-slate-100 dark:bg-night-900'}`}>
                <p>
                  {incoming ? (
                    <>
                      <strong>{name(t.fromParticipantId)}</strong> offer {playerLabel(pool, t.offerPlayerId)} for your {playerLabel(pool, t.requestPlayerId)}
                    </>
                  ) : (
                    <>
                      You offered {playerLabel(pool, t.offerPlayerId)} to <strong>{name(t.toParticipantId)}</strong> for {playerLabel(pool, t.requestPlayerId)}
                    </>
                  )}
                </p>
                <div className="mt-1 flex gap-2">
                  {incoming ? (
                    <>
                      <button type="button" className="btn-primary min-h-9 py-0" disabled={busy} onClick={() => void run(`/api/games/${code}/trades/${t.id}`, 'POST', { action: 'accept' })}>
                        Accept
                      </button>
                      <button type="button" className="btn-secondary min-h-9 py-0" disabled={busy} onClick={() => void run(`/api/games/${code}/trades/${t.id}`, 'POST', { action: 'decline' })}>
                        Decline
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn-secondary min-h-9 py-0" disabled={busy} onClick={() => void run(`/api/games/${code}/trades/${t.id}`, 'POST', { action: 'cancel' })}>
                      Cancel offer
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {recent.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-xs text-slate-500">
          {recent.map((t) => (
            <li key={t.id}>
              {t.status === 'accepted' ? '✅' : '✖️'} {name(t.fromParticipantId)} ↔ {name(t.toParticipantId)}: {playerLabel(pool, t.offerPlayerId)} for {playerLabel(pool, t.requestPlayerId)} ({t.status})
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ---------- Transfer window ----------

function WindowClock({ closesAt }: { closesAt: string | null }) {
  const secs = useSecondsLeft(closesAt);
  if (secs === null) return null;
  const urgent = secs <= 30;
  return (
    <p className={`display text-2xl tabular-nums ${urgent ? 'text-red-500' : ''}`} role="timer" aria-label={`${secs} seconds until the window closes`}>
      ⏱ {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
    </p>
  );
}

export function TransferWindow({ snapshot, pool }: { snapshot: GameSnapshot; pool: PoolData }) {
  const round = snapshot.round!;
  const { run, busy } = useAction();
  const code = snapshot.game.code;
  if (round.phase !== 'mini' && round.phase !== 'big') return null;
  const me = snapshot.participants.find((p) => p.id === snapshot.me.participantId && p.teamName !== null);
  const ready = me ? round.ready.includes(me.id) : false;
  const humans = snapshot.participants.filter((p) => p.teamName !== null && !p.isBot);
  const waiting = humans.filter((p) => !round.ready.includes(p.id));
  const name = (id: number) => snapshot.participants.find((p) => p.id === id)?.teamName ?? 'A team';
  const moves = round.moves.filter((m) => m.windowKind === round.phase && m.seasonNumber === round.seasonNumber && m.kind === 'transfer');
  return (
    <section className="card animate-reveal p-4 ring-2 ring-gold-400" id="window" aria-labelledby="window-title">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="display text-gold-500">{round.phase === 'mini' ? `Season ${round.seasonNumber} · after matchday 19` : 'Between season 1 and season 2'}</p>
          <h2 id="window-title" className="display text-3xl">
            🔁 {WINDOW_TITLE[round.phase]}
          </h2>
          <p className="text-sm text-slate-500">
            {round.transferLimit} transfers per team (sell a player, buy a free one with your budget), plus as many trades as you agree. {waiting.length > 0 ? `Waiting for ${waiting.map((p) => p.teamName).join(', ')}.` : 'Everyone is done.'}
          </p>
        </div>
        <WindowClock closesAt={round.closesAt} />
        {me ? (
          <button type="button" className={ready ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => void run(`/api/games/${code}/window/ready`, 'POST', { ready: !ready })}>
            {ready ? 'Not done yet' : "I'm done ✓"}
          </button>
        ) : null}
        {snapshot.me.isHost || snapshot.me.isAdmin ? (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void run(`/api/games/${code}/window/close`)}>
            {busy ? 'Simulating…' : 'Close window & play on'}
          </button>
        ) : null}
      </div>
      <div className="mt-4">
        <SquadManager snapshot={snapshot} pool={pool} round={round} />
      </div>
      {moves.length > 0 ? (
        <div className="mt-4">
          <h3 className="display text-lg">Deals done</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {moves.map((m, i) => (
              <li key={i}>
                <strong>{name(m.participantId)}</strong>: {pool.playersById.get(m.inPlayerId)?.name ?? 'Player'} in, {pool.playersById.get(m.outPlayerId)?.name ?? 'Player'} out ({m.slotKey})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------- Leaderboard and round over ----------

export function useSeriesLeaderboard(code: string, key: unknown) {
  return useQuery({
    queryKey: ['leaderboard', code, key],
    queryFn: () => api<SeriesLeaderboardView>(`/api/games/${code}/leaderboard`),
  });
}

export function SeriesLeaderboard({ code, refreshKey }: { code: string; refreshKey: unknown }) {
  const board = useSeriesLeaderboard(code, refreshKey);
  if (!board.data) return null;
  const { rows, rounds, roundNumber } = board.data;
  return (
    <section className="card p-4" aria-labelledby="lb-title">
      <h2 id="lb-title" className="display text-2xl">
        🏆 Game leaderboard
      </h2>
      <p className="text-sm text-slate-500">
        Round {roundNumber}. The team with the most points over both seasons of a round wins 1 leaderboard point.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Manager</th>
              <th className="py-1 pr-2 text-right" title="Leaderboard points (rounds won)">
                LB pts
              </th>
              <th className="py-1 pr-2 text-right" title="League points this round">
                This round
              </th>
              <th className="py-1 text-right" title="League points over every round">
                All rounds
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-slate-200 dark:border-night-700">
                <td className="py-1.5 pr-2 tabular-nums text-slate-500">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <span className="font-semibold">{r.teamName}</span> <span className="text-xs text-slate-500">{r.name}</span>
                </td>
                <td className="py-1.5 pr-2 text-right font-bold tabular-nums text-gold-500">{r.points}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.currentRoundPoints}</td>
                <td className="py-1.5 text-right tabular-nums">{r.leaguePoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rounds.some((r) => r.complete) ? (
        <ul className="mt-3 grid gap-1 text-xs text-slate-500">
          {rounds
            .filter((r) => r.complete)
            .map((r) => (
              <li key={r.code}>
                Round {r.roundNumber}: won by {r.winners.join(' & ') || 'nobody'}
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}

export function RoundOver({ snapshot }: { snapshot: GameSnapshot }) {
  const code = snapshot.game.code;
  const round = snapshot.round!;
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const rematchCode = useRematch((s) => s[code]) ?? round.nextCode;
  const host = snapshot.me.isHost || snapshot.me.isAdmin;
  const start = async (mode: 'next' | 'restart') => {
    const res = await run<{ game: { code: string } }>(`/api/games/${code}/rematch`, 'POST', { mode });
    if (res) void navigate(`/lobby/${res.game.code}`);
  };
  return (
    <div className="grid gap-4" id="round-over">
      <section className="card animate-reveal p-5 text-center ring-2 ring-pitch-500">
        <p className="display text-pitch-500">Round {round.roundNumber} complete</p>
        <h2 className="display text-4xl">Both seasons are in the books</h2>
        <p className="mt-1 text-slate-500">Play again to start round {round.roundNumber + 1} with the same teams and keep the leaderboard, or restart from round 1.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {rematchCode ? (
            <Link to={`/lobby/${rematchCode}`} className="btn-primary">
              Join the next round →
            </Link>
          ) : host ? (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void start('next')}>
                ▶ Play again (round {round.roundNumber + 1})
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void start('restart')}>
                ↺ Restart from round 1
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500">Waiting for the host to play again or restart.</p>
          )}
          <Link to={`/results/${code}`} className="btn-ghost">
            Season results
          </Link>
        </div>
      </section>
      <SeriesLeaderboard code={code} refreshKey={`${round.phase}:${snapshot.seasons.length}`} />
    </div>
  );
}

// ---------- Season stat leaders ----------

export function SeasonLeaders({ season, title = 'Season stats' }: { season: SeasonView; title?: string }) {
  const teams = new Map(season.teams.map((t) => [t.id, t]));
  const top = (key: 'goals' | 'assists' | 'cleanSheets' | 'avgRating', min = 0) =>
    [...season.playerStats]
      .filter((s) => (key === 'avgRating' ? s.appearances >= 10 : s[key] > min))
      .sort((a, b) => b[key] - a[key] || b.appearances - a.appearances)
      .slice(0, 5);
  const boards: { label: string; icon: string; rows: ReturnType<typeof top>; value: (s: SeasonView['playerStats'][number]) => string }[] = [
    { label: 'Most goals', icon: '⚽', rows: top('goals'), value: (s) => String(s.goals) },
    { label: 'Most assists', icon: '🅰️', rows: top('assists'), value: (s) => String(s.assists) },
    { label: 'Clean sheets', icon: '🧤', rows: top('cleanSheets'), value: (s) => String(s.cleanSheets) },
    { label: 'Best rating', icon: '⭐', rows: top('avgRating'), value: (s) => s.avgRating.toFixed(2) },
  ];
  return (
    <section className="card animate-reveal p-4" aria-labelledby="leaders-title">
      <h2 id="leaders-title" className="display text-2xl">
        📊 {title}
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {boards.map((b) => (
          <div key={b.label} className="rounded-xl bg-slate-100 p-3 dark:bg-night-900">
            <h3 className="font-bold">
              {b.icon} {b.label}
            </h3>
            <ol className="mt-2 grid gap-1 text-sm">
              {b.rows.map((s, i) => (
                <li key={`${s.playerId}-${s.teamId}`} className={`flex items-center gap-2 ${i === 0 ? 'font-semibold' : ''}`}>
                  <span className="w-4 text-xs text-slate-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {s.name}
                    <TeamTag team={teams.get(s.teamId)} />
                  </span>
                  <span className="tabular-nums">{b.value(s)}</span>
                </li>
              ))}
              {b.rows.length === 0 ? <li className="text-slate-500">Nobody yet</li> : null}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamTag({ team }: { team: LeagueTeamView | undefined }) {
  if (!team) return null;
  return team.kind === 'human' ? (
    <span className="ml-1 inline-flex align-middle">
      <TeamBadge color={team.primaryColor} monogram={team.monogram} size="sm" />
    </span>
  ) : (
    <span className="ml-1 text-xs text-slate-500">{team.monogram}</span>
  );
}
