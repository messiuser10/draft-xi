/**
 * Rounds: two seasons per round, a mini transfer window after matchday 19 of each season and a
 * big one between the seasons. Also captains, transfers (bought with a window budget), trades
 * between teams and the series
 * leaderboard (one point per round to the team with the most league points over both seasons).
 *
 * A team's current XI is its draft picks with `roster_moves` applied in order, so the draft
 * itself (and its grades) never changes.
 */
import { getFormation, HALF_SEASON_MATCHDAYS, type SlotCompatibility } from '@draft-xi/engine';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { actorOf, type AuthUser, requireUser } from '../auth/service';
import { SYSTEM_ACTOR, writeAudit } from '../audit';
import {
  playerValue,
  ROUND_SEASONS,
  type RoundPhase,
  type RoundView,
  SEASON_MATCHDAYS,
  type SeriesLeaderboardView,
  TRANSFER_LIMITS,
  type TradeView,
  windowBudget,
} from '../contracts';
import type { AppDb, Database } from '../db/database';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors';
import { getSetting } from '../settings/app-settings';
import { slotAccepts } from './draft';
import { loadPool, type Pool } from './pool';
import type { GameHub } from './service';
import { formationOf, type GameRow, type ParticipantRow, settingsOf } from './views';

export interface RosterEntry {
  participantId: number;
  slotKey: string;
  playerId: number;
}

type MoveRow = Database['t']['rosterMoves']['$inferSelect'];
type TradeRow = Database['t']['trades']['$inferSelect'];

/** Stored in `games.window_state` once the seasons start. */
export interface WindowState {
  phase: 'mini' | 'big' | 'over';
  seasonNumber: number;
  ready: number[];
  nextCode?: string | null;
  /** Budget each team got for this window, by participant id (JSON keys are strings). */
  grants?: Record<string, number>;
  /** Teams whose players have watched the matches up to this break (each player watches at their own pace). */
  watched?: number[];
}

type WindowMove = Pick<MoveRow, 'participantId' | 'outPlayerId' | 'inPlayerId' | 'kind' | 'windowKind' | 'seasonNumber'>;

/** Money a team has left in a window: its grant, plus what it sold, minus what it bought. */
export function budgetLeftOf(
  w: WindowState,
  phase: 'mini' | 'big',
  participantId: number,
  moves: readonly WindowMove[],
  overallOf: (playerId: number) => number,
): number {
  let left = w.grants?.[String(participantId)] ?? 0;
  for (const m of moves) {
    if (m.participantId !== participantId || m.kind !== 'transfer' || m.windowKind !== phase || m.seasonNumber !== w.seasonNumber) continue;
    left += playerValue(overallOf(m.outPlayerId)) - playerValue(overallOf(m.inPlayerId));
  }
  return left;
}

export function windowOf(game: GameRow): WindowState | null {
  const w = game.windowState as WindowState | null;
  return w && typeof w === 'object' && 'phase' in w ? w : null;
}

export function phaseOf(game: GameRow): RoundPhase | null {
  if (game.status === 'draft_complete') return 'preseason';
  if (game.status === 'simulating') return 'season';
  if (game.status === 'completed') return windowOf(game)?.phase ?? 'over';
  return null;
}

export const seriesIdOf = (game: GameRow) => game.seriesId ?? game.id;

/** Draft picks with every transfer and trade applied in order. */
export function applyMoves(picks: readonly RosterEntry[], moves: readonly Pick<MoveRow, 'participantId' | 'slotKey' | 'inPlayerId'>[]): RosterEntry[] {
  const out = new Map(picks.map((p) => [`${p.participantId}:${p.slotKey}`, { ...p }]));
  for (const m of moves) {
    const e = out.get(`${m.participantId}:${m.slotKey}`);
    if (e) e.playerId = m.inPlayerId;
  }
  return [...out.values()];
}

export async function loadRosters(database: Database, gameId: number, db: AppDb = database.db): Promise<RosterEntry[]> {
  const { t } = database;
  const picks = await db
    .select({ participantId: t.draftPicks.participantId, slotKey: t.draftPicks.slotKey, playerId: t.draftPicks.playerId })
    .from(t.draftPicks)
    .where(eq(t.draftPicks.gameId, gameId))
    .orderBy(asc(t.draftPicks.pickNumber));
  const moves = await db.select().from(t.rosterMoves).where(eq(t.rosterMoves.gameId, gameId)).orderBy(asc(t.rosterMoves.id));
  return applyMoves(picks, moves);
}

/** Season service hooks the round service needs (set in app.ts to avoid a cycle). */
export interface WindowCloser {
  closeWindow(gameId: number, user: AuthUser | null): Promise<void>;
}

export class RoundService {
  private closer: WindowCloser | null = null;

  constructor(
    private readonly database: Database,
    private hub: GameHub,
  ) {}

  setHub(hub: GameHub): void {
    this.hub = hub;
  }

  setCloser(closer: WindowCloser): void {
    this.closer = closer;
  }

  /**
   * Human teams whose player must still act: connected, drafting humans. Offline players are
   * skipped so one closed tab cannot hold up everyone else.
   */
  private waitingOn(parts: readonly ParticipantRow[]): ParticipantRow[] {
    return parts.filter((p) => p.teamName !== null && !p.isBot && p.isConnected);
  }

  /** Every connected human has watched up to the break (bots never need to). */
  private everyoneWatched(w: WindowState | null, parts: readonly ParticipantRow[]): boolean {
    const watched = new Set(w?.watched ?? []);
    return this.waitingOn(parts).every((p) => watched.has(p.id));
  }

  // ---------- Reads ----------

  async view(game: GameRow): Promise<RoundView | null> {
    const phase = phaseOf(game);
    if (phase === null) return null;
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const rosters = await loadRosters(this.database, game.id);
    const moves = await db.select().from(t.rosterMoves).where(eq(t.rosterMoves.gameId, game.id)).orderBy(asc(t.rosterMoves.id));
    const trades = await db.select().from(t.trades).where(eq(t.trades.gameId, game.id)).orderBy(asc(t.trades.id));
    const w = windowOf(game);
    const open = phase === 'mini' || phase === 'big';
    const seasonNumber = w?.seasonNumber ?? 1;
    const used: Record<number, number> = {};
    const grants: Record<number, number> = {};
    const left: Record<number, number> = {};
    for (const p of parts) used[p.id] = 0;
    if (open && w) {
      for (const m of moves) {
        if (m.kind === 'transfer' && m.windowKind === phase && m.seasonNumber === seasonNumber) used[m.participantId] = (used[m.participantId] ?? 0) + 1;
      }
      const pool = await loadPool(this.database);
      const overallOf = (id: number) => pool.players.find((p) => p.id === id)?.overall ?? 0;
      for (const p of parts) {
        if (p.teamName === null) continue;
        grants[p.id] = w.grants?.[String(p.id)] ?? 0;
        left[p.id] = budgetLeftOf(w, phase, p.id, moves, overallOf);
      }
    }
    const byTeam: Record<number, Record<string, number>> = {};
    for (const r of rosters) (byTeam[r.participantId] ??= {})[r.slotKey] = r.playerId;
    return {
      seriesId: seriesIdOf(game),
      roundNumber: game.roundNumber,
      phase,
      seasonNumber,
      transferLimit: open ? TRANSFER_LIMITS[phase] : 0,
      transfersUsed: used,
      budgetGrants: grants,
      budgetLeft: left,
      watched: w?.watched ?? [],
      allWatched: phase === 'mini' || phase === 'big' || phase === 'over' ? this.everyoneWatched(w, parts) : true,
      ready: open ? (w?.ready ?? []) : [],
      rosters: byTeam,
      captains: Object.fromEntries(parts.filter((p) => p.teamName !== null).map((p) => [p.id, p.captainPlayerId])),
      trades: trades.map(toTradeView),
      moves: moves.map((m) => ({
        participantId: m.participantId,
        slotKey: m.slotKey,
        outPlayerId: m.outPlayerId,
        inPlayerId: m.inPlayerId,
        kind: m.kind,
        windowKind: m.windowKind,
        seasonNumber: m.seasonNumber,
      })),
      nextCode: w?.nextCode ?? null,
    };
  }

  // ---------- Captain ----------

  async setCaptain(code: string, userIn: AuthUser | null, playerId: number): Promise<void> {
    const { game, me } = await this.mine(code, userIn);
    const phase = phaseOf(game);
    if (phase !== 'preseason' && phase !== 'mini' && phase !== 'big') throw conflict('locked', 'You can change your captain before the season or in a transfer window');
    const rosters = await loadRosters(this.database, game.id);
    if (!rosters.some((r) => r.participantId === me.id && r.playerId === playerId)) throw badRequest('not_yours', 'Your captain must be in your XI');
    const { db, t } = this.database;
    await db.update(t.participants).set({ captainPlayerId: playerId }).where(eq(t.participants.id, me.id));
    this.hub.resync(game.id);
  }

  /** Before season 1: every team without a captain gets its highest rated player. */
  async autoCaptains(gameId: number): Promise<void> {
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, gameId));
    const rosters = await loadRosters(this.database, gameId);
    const pool = await loadPool(this.database);
    const overall = (id: number) => pool.players.find((p) => p.id === id)?.overall ?? 0;
    for (const p of parts) {
      const mine = rosters.filter((r) => r.participantId === p.id);
      if (mine.length === 0) continue;
      if (p.captainPlayerId !== null && mine.some((r) => r.playerId === p.captainPlayerId)) continue;
      const best = [...mine].sort((a, b) => overall(b.playerId) - overall(a.playerId))[0]!;
      await db.update(t.participants).set({ captainPlayerId: best.playerId }).where(eq(t.participants.id, p.id));
    }
  }

  // ---------- Transfers ----------

  /**
   * Sell the player in one of your slots and buy a free player (on no drafted team) who fits it.
   * The price difference comes out of (or goes into) your window budget.
   */
  async transfer(code: string, userIn: AuthUser | null, slotKey: string, playerId: number): Promise<void> {
    const { game, me } = await this.mine(code, userIn);
    const phase = phaseOf(game);
    if (phase !== 'mini' && phase !== 'big') throw conflict('window_closed', 'Transfers happen in the transfer windows');
    await this.requireWatched(game);
    await this.applyTransfer(game, me, slotKey, playerId, phase);
    await writeAudit(this.database.db, this.database.t, { actor: actorOf(requireUser(userIn)), action: 'round.transfer', target: `game:${game.joinCode}`, gameId: game.id, details: { slotKey, playerId } });
    this.hub.resync(game.id);
  }

  private async applyTransfer(game: GameRow, me: ParticipantRow, slotKey: string, playerId: number, phase: 'mini' | 'big'): Promise<void> {
    const w = windowOf(game)!;
    const pool = await loadPool(this.database);
    const compatibility = await this.compatibility();
    const settings = settingsOf(game);
    await this.database.transaction(async (tx) => {
      const { t } = this.database;
      const moves = await tx.select().from(t.rosterMoves).where(eq(t.rosterMoves.gameId, game.id));
      const used = moves.filter((m) => m.participantId === me.id && m.kind === 'transfer' && m.windowKind === phase && m.seasonNumber === w.seasonNumber).length;
      if (used >= TRANSFER_LIMITS[phase]) throw conflict('no_transfers', `You have used all ${TRANSFER_LIMITS[phase]} transfers in this window`);
      const rosters = await loadRosters(this.database, game.id, tx);
      const current = rosters.find((r) => r.participantId === me.id && r.slotKey === slotKey);
      if (!current) throw badRequest('wrong_slot', 'You have no player in that slot');
      if (rosters.some((r) => r.playerId === playerId)) throw conflict('player_taken', 'That player is already on a drafted team');
      const player = pool.players.find((p) => p.id === playerId);
      if (!player) throw badRequest('unknown_player', 'That player is not in the pool');
      const slot = this.slotOf(me, slotKey);
      if (!slotAccepts(player, slot, compatibility, settings.strictPositions)) throw badRequest('wrong_slot', `${player.name} (${player.primaryPosition}) cannot play ${slot.type}`);
      if (settings.clubCap !== null) {
        const sameClub = rosters.filter((r) => r.participantId === me.id && r.slotKey !== slotKey && pool.players.find((x) => x.id === r.playerId)?.clubId === player.clubId).length;
        if (sameClub >= settings.clubCap) throw badRequest('club_cap', `You can take at most ${settings.clubCap} players from one club`);
      }
      const overallOf = (id: number) => pool.players.find((p) => p.id === id)?.overall ?? 0;
      const left = budgetLeftOf(w, phase, me.id, moves, overallOf);
      const cost = playerValue(player.overall) - playerValue(overallOf(current.playerId));
      if (cost > left) throw conflict('budget', `${player.name} costs ${cost}M more than the player you sell, and you have ${left}M left`);
      await tx.insert(t.rosterMoves).values({
        gameId: game.id,
        participantId: me.id,
        slotKey,
        outPlayerId: current.playerId,
        inPlayerId: playerId,
        kind: 'transfer',
        windowKind: phase,
        seasonNumber: w.seasonNumber,
      });
      if (me.captainPlayerId === current.playerId) await tx.update(t.participants).set({ captainPlayerId: playerId }).where(eq(t.participants.id, me.id));
      await this.cancelTradesFor(tx, game.id, [current.playerId]);
    });
  }

  // ---------- Trades ----------

  async proposeTrade(code: string, userIn: AuthUser | null, input: { toParticipantId: number; offerPlayerId: number; requestPlayerId: number }): Promise<TradeView> {
    const { game, me, parts } = await this.mine(code, userIn);
    this.requireTradePhase(game);
    await this.requireWatched(game);
    const other = parts.find((p) => p.id === input.toParticipantId && p.teamName !== null);
    if (!other || other.id === me.id) throw badRequest('wrong_team', 'Choose another team to trade with');
    const { db, t } = this.database;
    const ctx = await this.tradeContext(game);
    this.checkTrade(ctx, await loadRosters(this.database, game.id), me, other, input.offerPlayerId, input.requestPlayerId);
    const dup = await db
      .select({ id: t.trades.id })
      .from(t.trades)
      .where(
        and(
          eq(t.trades.gameId, game.id),
          eq(t.trades.status, 'pending'),
          eq(t.trades.fromParticipantId, me.id),
          eq(t.trades.offerPlayerId, input.offerPlayerId),
          eq(t.trades.requestPlayerId, input.requestPlayerId),
        ),
      );
    if (dup.length > 0) throw conflict('duplicate', 'You already offered that trade');
    const [row] = await db
      .insert(t.trades)
      .values({ gameId: game.id, fromParticipantId: me.id, toParticipantId: other.id, offerPlayerId: input.offerPlayerId, requestPlayerId: input.requestPlayerId })
      .returning();
    if (!row) throw new Error('Insert returned no trade');
    if (other.isBot) {
      // Bots answer at once: they take the deal when the player they get is at least as good.
      const ovr = (id: number) => ctx.pool.players.find((p) => p.id === id)?.overall ?? 0;
      const accept = ovr(input.offerPlayerId) >= ovr(input.requestPlayerId);
      if (accept) await this.executeTrade(game, row);
      else await db.update(t.trades).set({ status: 'declined', respondedAt: new Date() }).where(eq(t.trades.id, row.id));
    }
    this.hub.resync(game.id);
    const [fresh] = await db.select().from(t.trades).where(eq(t.trades.id, row.id));
    return toTradeView(fresh ?? row);
  }

  async respondTrade(code: string, userIn: AuthUser | null, tradeId: number, action: 'accept' | 'decline' | 'cancel'): Promise<TradeView> {
    const { game, me } = await this.mine(code, userIn);
    const { db, t } = this.database;
    const [trade] = await db.select().from(t.trades).where(and(eq(t.trades.id, tradeId), eq(t.trades.gameId, game.id)));
    if (!trade) throw notFound('No such trade');
    if (trade.status !== 'pending') throw conflict('settled', 'That trade has already been settled');
    if (action === 'cancel') {
      if (trade.fromParticipantId !== me.id) throw forbidden('Only the team that offered a trade can cancel it');
    } else if (trade.toParticipantId !== me.id) {
      throw forbidden('Only the team receiving the offer can answer it');
    }
    if (action === 'accept') {
      this.requireTradePhase(game);
      await this.requireWatched(game);
      await this.executeTrade(game, trade);
    } else {
      await db
        .update(t.trades)
        .set({ status: action === 'decline' ? 'declined' : 'cancelled', respondedAt: new Date() })
        .where(and(eq(t.trades.id, trade.id), eq(t.trades.status, 'pending')));
    }
    this.hub.resync(game.id);
    const [fresh] = await db.select().from(t.trades).where(eq(t.trades.id, trade.id));
    return toTradeView(fresh!);
  }

  private requireTradePhase(game: GameRow): void {
    const phase = phaseOf(game);
    if (phase !== 'preseason' && phase !== 'mini' && phase !== 'big') throw conflict('window_closed', 'Trades happen after the draft and in the transfer windows');
  }

  private async tradeContext(game: GameRow): Promise<{ pool: Pool; compatibility: SlotCompatibility; strict: boolean }> {
    return { pool: await loadPool(this.database), compatibility: await this.compatibility(), strict: settingsOf(game).strictPositions };
  }

  /** Both players must still be where they were, and each must be able to play the other's slot. */
  private checkTrade(
    ctx: { pool: Pool; compatibility: SlotCompatibility; strict: boolean },
    rosters: readonly RosterEntry[],
    from: ParticipantRow,
    to: ParticipantRow,
    offerPlayerId: number,
    requestPlayerId: number,
  ) {
    const { pool, compatibility, strict } = ctx;
    const offer = rosters.find((r) => r.participantId === from.id && r.playerId === offerPlayerId);
    const request = rosters.find((r) => r.participantId === to.id && r.playerId === requestPlayerId);
    if (!offer) throw badRequest('not_yours', 'The player you offer must be in your XI');
    if (!request) throw badRequest('not_theirs', 'The player you ask for must be in their XI');
    const offerPlayer = this.playerOf(pool, offerPlayerId);
    const requestPlayer = this.playerOf(pool, requestPlayerId);
    const fromSlot = this.slotOf(from, offer.slotKey);
    const toSlot = this.slotOf(to, request.slotKey);
    // Positions are locked: each player takes over the other's slot.
    if (!slotAccepts(requestPlayer, fromSlot, compatibility, strict)) throw badRequest('wrong_slot', `${requestPlayer.name} cannot play your ${fromSlot.key} slot`);
    if (!slotAccepts(offerPlayer, toSlot, compatibility, strict)) throw badRequest('wrong_slot', `${offerPlayer.name} cannot play their ${toSlot.key} slot`);
    return { offer, request };
  }

  private async executeTrade(game: GameRow, trade: TradeRow): Promise<void> {
    const { t } = this.database;
    const phase = phaseOf(game);
    const windowKind = phase === 'mini' || phase === 'big' ? phase : 'preseason';
    const seasonNumber = windowOf(game)?.seasonNumber ?? 1;
    const ctx = await this.tradeContext(game);
    try {
      await this.runTrade(game, trade, ctx, windowKind, seasonNumber);
    } catch (err) {
      if (!(err instanceof AppError) || err.code === 'settled') throw err;
      const { db } = this.database;
      await db.update(t.trades).set({ status: 'cancelled', respondedAt: new Date() }).where(and(eq(t.trades.id, trade.id), eq(t.trades.status, 'pending')));
      throw conflict('stale_trade', `That trade no longer works: ${err.message}`);
    }
  }

  private async runTrade(
    game: GameRow,
    trade: TradeRow,
    ctx: { pool: Pool; compatibility: SlotCompatibility; strict: boolean },
    windowKind: 'preseason' | 'mini' | 'big',
    seasonNumber: number,
  ): Promise<void> {
    const { t } = this.database;
    await this.database.transaction(async (tx) => {
      const parts = await tx.select().from(t.participants).where(inArray(t.participants.id, [trade.fromParticipantId, trade.toParticipantId]));
      const from = parts.find((p) => p.id === trade.fromParticipantId);
      const to = parts.find((p) => p.id === trade.toParticipantId);
      if (!from || !to) throw notFound('That team has left');
      const { offer, request } = this.checkTrade(ctx, await loadRosters(this.database, game.id, tx), from, to, trade.offerPlayerId, trade.requestPlayerId);
      const [claimed] = await tx
        .update(t.trades)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(and(eq(t.trades.id, trade.id), eq(t.trades.status, 'pending')))
        .returning();
      if (!claimed) throw conflict('settled', 'That trade has already been settled');
      await tx.insert(t.rosterMoves).values([
        { gameId: game.id, participantId: from.id, slotKey: offer.slotKey, outPlayerId: offer.playerId, inPlayerId: request.playerId, kind: 'trade', windowKind, seasonNumber },
        { gameId: game.id, participantId: to.id, slotKey: request.slotKey, outPlayerId: request.playerId, inPlayerId: offer.playerId, kind: 'trade', windowKind, seasonNumber },
      ]);
      if (from.captainPlayerId === offer.playerId) await tx.update(t.participants).set({ captainPlayerId: request.playerId }).where(eq(t.participants.id, from.id));
      if (to.captainPlayerId === request.playerId) await tx.update(t.participants).set({ captainPlayerId: offer.playerId }).where(eq(t.participants.id, to.id));
      await this.cancelTradesFor(tx, game.id, [offer.playerId, request.playerId]);
      await writeAudit(tx, t, { actor: SYSTEM_ACTOR, action: 'round.trade', target: `game:${game.joinCode}`, gameId: game.id, details: { tradeId: trade.id } });
    });
  }

  /** Other pending offers involving players who just moved can no longer happen. */
  private async cancelTradesFor(db: AppDb, gameId: number, playerIds: number[]): Promise<void> {
    const { t } = this.database;
    await db
      .update(t.trades)
      .set({ status: 'cancelled', respondedAt: new Date() })
      .where(
        and(
          eq(t.trades.gameId, gameId),
          eq(t.trades.status, 'pending'),
          or(inArray(t.trades.offerPlayerId, playerIds), inArray(t.trades.requestPlayerId, playerIds)),
        ),
      );
  }

  /** When a phase ends, offers still waiting lapse. */
  async cancelPendingTrades(gameId: number): Promise<void> {
    const { db, t } = this.database;
    await db
      .update(t.trades)
      .set({ status: 'cancelled', respondedAt: new Date() })
      .where(and(eq(t.trades.gameId, gameId), eq(t.trades.status, 'pending')));
  }

  // ---------- Windows ----------

  /**
   * Window state is one JSON value, so changes to it for one game run one at a time (two players
   * pressing a button together must not overwrite each other). The app runs as one instance.
   */
  private readonly windowLocks = new Map<number, Promise<unknown>>();
  private async editWindow<T>(gameId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.windowLocks.get(gameId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.windowLocks.set(gameId, run);
    try {
      return await run;
    } finally {
      if (this.windowLocks.get(gameId) === run) this.windowLocks.delete(gameId);
    }
  }

  async setReady(code: string, userIn: AuthUser | null, ready: boolean): Promise<void> {
    const { game: found, me } = await this.mine(code, userIn);
    await this.editWindow(found.id, async () => {
      const game = await this.getById(found.id);
      const w = windowOf(game);
      const phase = phaseOf(game);
      if (!w || (phase !== 'mini' && phase !== 'big')) throw conflict('window_closed', 'No transfer window is open');
      const parts = await this.partsOf(game.id);
      if (!this.everyoneWatched(w, parts)) throw conflict('still_watching', 'The window opens once everyone has watched the matches');
      const set = new Set(w.ready);
      if (ready) set.add(me.id);
      else set.delete(me.id);
      const { db, t } = this.database;
      await db.update(t.games).set({ windowState: { ...w, ready: [...set] } }).where(eq(t.games.id, game.id));
    });
    this.hub.resync(found.id);
    await this.maybeClose(found.id);
  }

  /** A player's screen reached the break (or the end of the round): they are done watching. */
  async markWatched(code: string, userIn: AuthUser | null): Promise<void> {
    const { game: found, me } = await this.mine(code, userIn);
    const changed = await this.editWindow(found.id, async () => {
      const game = await this.getById(found.id);
      const w = windowOf(game);
      if (!w || game.status !== 'completed') return false;
      if ((w.watched ?? []).includes(me.id)) return false;
      const { db, t } = this.database;
      await db.update(t.games).set({ windowState: { ...w, watched: [...(w.watched ?? []), me.id] } }).where(eq(t.games.id, game.id));
      return true;
    });
    if (changed) this.hub.resync(found.id);
  }

  /** Someone came or went: who we wait for changed, so the window may now close. */
  async connectionChanged(gameId: number): Promise<void> {
    const game = await this.getById(gameId).catch(() => null);
    if (!game || game.status !== 'completed' || !windowOf(game)) return;
    this.hub.resync(gameId);
    await this.maybeClose(gameId);
  }

  /** Admin (or host) closes the window even if some teams are not done, for a stuck game. */
  async close(code: string, userIn: AuthUser | null): Promise<void> {
    const game = await this.getByCode(code);
    const user = requireUser(userIn);
    if (game.hostUserId !== user.id && user.role !== 'admin') throw forbidden('Only the host can do that');
    const phase = phaseOf(game);
    if (phase !== 'mini' && phase !== 'big') throw conflict('window_closed', 'No transfer window is open');
    await this.closer!.closeWindow(game.id, user);
  }

  /**
   * Closes the window once every connected human has watched the matches and pressed done (bots
   * are done as soon as it opens), and at least one player has pressed done.
   */
  private async maybeClose(gameId: number): Promise<void> {
    const game = await this.getById(gameId);
    const w = windowOf(game);
    const phase = phaseOf(game);
    if (!w || (phase !== 'mini' && phase !== 'big')) return;
    const parts = await this.partsOf(gameId);
    if (!this.everyoneWatched(w, parts)) return;
    // Someone must have pressed done (bots are marked done when the window opens).
    const humanDone = parts.some((p) => p.teamName !== null && !p.isBot && w.ready.includes(p.id));
    if (humanDone && this.waitingOn(parts).every((p) => w.ready.includes(p.id))) await this.closer!.closeWindow(gameId, null).catch(() => undefined);
  }

  private async partsOf(gameId: number): Promise<ParticipantRow[]> {
    const { db, t } = this.database;
    return db.select().from(t.participants).where(eq(t.participants.gameId, gameId));
  }

  /** Transfers and trades in a window wait until everyone has watched up to it. */
  private async requireWatched(game: GameRow): Promise<void> {
    const phase = phaseOf(game);
    if (phase !== 'mini' && phase !== 'big') return;
    if (!this.everyoneWatched(windowOf(game), await this.partsOf(game.id))) throw conflict('still_watching', 'The window opens once everyone has watched the matches');
  }

  /**
   * A window just opened. Every team gets its budget from the league points it has so far; bots
   * are done at once (they shop when it closes, after the humans). It closes when every player
   * has pressed done.
   */
  async windowOpened(gameId: number): Promise<void> {
    const game = await this.getById(gameId);
    const phase = phaseOf(game);
    const w = windowOf(game);
    if (!w || (phase !== 'mini' && phase !== 'big')) return;
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, gameId));
    const bots = parts.filter((p) => p.isBot && p.teamName !== null);
    const ready = [...new Set([...w.ready, ...bots.map((b) => b.id)])];
    const points = await this.pointsSoFar(gameId, w.seasonNumber, phase === 'mini' ? HALF_SEASON_MATCHDAYS : SEASON_MATCHDAYS);
    const grants: Record<string, number> = {};
    for (const p of parts) if (p.teamName !== null) grants[String(p.id)] = windowBudget(phase, points.get(p.id) ?? 0);
    await this.editWindow(gameId, async () => {
      const fresh = windowOf(await this.getById(gameId)) ?? w;
      await db.update(t.games).set({ windowState: { ...fresh, ready: [...new Set([...fresh.ready, ...ready])], grants } }).where(eq(t.games.id, gameId));
    });
    this.hub.resync(gameId);
  }

  /** League points of each drafted team at a matchday of a season, by participant id. */
  private async pointsSoFar(gameId: number, seasonNumber: number, matchday: number): Promise<Map<number, number>> {
    const { db, t } = this.database;
    const rows = await db
      .select({ participantId: t.seasonTeams.participantId, points: t.standingRows.points })
      .from(t.standingRows)
      .innerJoin(t.seasonTeams, eq(t.standingRows.seasonTeamId, t.seasonTeams.id))
      .innerJoin(t.seasons, eq(t.standingRows.seasonId, t.seasons.id))
      .where(and(eq(t.seasons.gameId, gameId), eq(t.seasons.seasonNumber, seasonNumber), eq(t.standingRows.matchday, matchday)));
    return new Map(rows.flatMap((r) => (r.participantId === null ? [] : [[r.participantId, r.points] as const])));
  }

  /**
   * The window is closing: bots now upgrade their weakest slots with the best free players who
   * fit, up to the window's limit. Doing this last means humans always get first pick of the
   * free players.
   */
  async botTransfers(gameId: number, phase: 'mini' | 'big'): Promise<void> {
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, gameId));
    const bots = parts.filter((p) => p.isBot && p.teamName !== null);
    if (bots.length === 0) return;
    const game = await this.getById(gameId);
    const pool = await loadPool(this.database);
    const compatibility = await this.compatibility();
    const strict = settingsOf(game).strictPositions;
    const w = windowOf(game);
    if (!w) return;
    const ovr = (id: number) => pool.players.find((p) => p.id === id)?.overall ?? 0;
    // Take turns, one transfer per bot per pass, so the first bot does not get every star.
    for (let n = 0; n < TRANSFER_LIMITS[phase]; n++) {
      for (const bot of bots) {
        const rosters = await loadRosters(this.database, gameId);
        const moves = await db.select().from(t.rosterMoves).where(eq(t.rosterMoves.gameId, gameId));
        const left = budgetLeftOf(w, phase, bot.id, moves, ovr);
        const taken = new Set(rosters.map((r) => r.playerId));
        const mine = rosters.filter((r) => r.participantId === bot.id).sort((a, b) => ovr(a.playerId) - ovr(b.playerId));
        for (const r of mine) {
          const slot = this.slotOf(bot, r.slotKey);
          const budget = left + playerValue(ovr(r.playerId));
          const best = pool.players
            .filter((p) => !taken.has(p.id) && p.overall > ovr(r.playerId) && playerValue(p.overall) <= budget && slotAccepts(p, slot, compatibility, strict))
            .sort((a, b) => b.overall - a.overall)[0];
          if (!best) continue;
          try {
            await this.applyTransfer(game, bot, r.slotKey, best.id, phase);
            break;
          } catch {
            /* club cap, budget or no transfers left: try the next slot */
          }
        }
      }
    }
  }

  // ---------- Series leaderboard ----------

  async leaderboard(code: string): Promise<SeriesLeaderboardView> {
    const game = await this.getByCode(code);
    const seriesId = seriesIdOf(game);
    const { db, t } = this.database;
    const games = (await db.select().from(t.games).where(or(eq(t.games.id, seriesId), eq(t.games.seriesId, seriesId)))).sort((a, b) => a.roundNumber - b.roundNumber || a.id - b.id);
    const gameIds = games.map((g) => g.id);
    const finals = gameIds.length === 0
      ? []
      : await db
          .select({ row: t.standingRows, team: t.seasonTeams, season: t.seasons, part: t.participants })
          .from(t.standingRows)
          .innerJoin(t.seasonTeams, eq(t.standingRows.seasonTeamId, t.seasonTeams.id))
          .innerJoin(t.seasons, eq(t.standingRows.seasonId, t.seasons.id))
          .innerJoin(t.participants, eq(t.seasonTeams.participantId, t.participants.id))
          .where(and(inArray(t.seasons.gameId, gameIds), eq(t.standingRows.matchday, SEASON_MATCHDAYS), eq(t.seasons.status, 'completed')));
    const names = new Map<number, string>();
    const userIds = [...new Set(finals.flatMap((f) => (f.part.userId === null ? [] : [f.part.userId])))];
    if (userIds.length > 0) for (const u of await db.select().from(t.users).where(inArray(t.users.id, userIds))) names.set(u.id, u.displayName);

    const keyOf = (p: ParticipantRow) => (p.userId !== null && !p.isBot ? `u${p.userId}` : `b:${p.teamName ?? p.id}`);
    const rows = new Map<string, SeriesLeaderboardView['rows'][number]>();
    const rounds: SeriesLeaderboardView['rounds'] = [];
    for (const g of games) {
      const mine = finals.filter((f) => f.season.gameId === g.id && f.season.seasonNumber <= ROUND_SEASONS);
      const totals = new Map<string, { points: number; gd: number }>();
      for (const f of mine) {
        const key = keyOf(f.part);
        const r = rows.get(key) ?? {
          key,
          userId: f.part.isBot ? null : f.part.userId,
          name: f.part.isBot ? `Bot (${f.part.botLevel ?? 'medium'})` : (names.get(f.part.userId ?? -1) ?? 'Player'),
          teamName: f.part.teamName ?? 'Team',
          points: 0,
          roundsPlayed: 0,
          leaguePoints: 0,
          currentRoundPoints: 0,
        };
        r.teamName = f.part.teamName ?? r.teamName;
        r.leaguePoints += f.row.points;
        if (g.id === game.id) r.currentRoundPoints += f.row.points;
        rows.set(key, r);
        const tot = totals.get(key) ?? { points: 0, gd: 0 };
        tot.points += f.row.points;
        tot.gd += f.row.goalDifference;
        totals.set(key, tot);
      }
      const complete = phaseOf(g) === 'over' && new Set(mine.map((f) => f.season.seasonNumber)).size >= ROUND_SEASONS;
      let winners: string[] = [];
      if (complete && totals.size > 0) {
        const best = [...totals.values()].sort((a, b) => b.points - a.points || b.gd - a.gd)[0]!;
        winners = [...totals.entries()].filter(([, v]) => v.points === best.points && v.gd === best.gd).map(([k]) => k);
        for (const k of totals.keys()) rows.get(k)!.roundsPlayed++;
        for (const k of winners) rows.get(k)!.points++;
      }
      rounds.push({ roundNumber: g.roundNumber, code: g.joinCode, complete, winners: winners.map((k) => rows.get(k)?.teamName ?? k) });
    }
    // Teams in this round who have no finished season yet still appear.
    const current = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const currentNames = new Map<number, string>();
    const curIds = current.flatMap((p) => (p.userId === null ? [] : [p.userId]));
    if (curIds.length > 0) for (const u of await db.select().from(t.users).where(inArray(t.users.id, curIds))) currentNames.set(u.id, u.displayName);
    for (const p of current) {
      if (p.teamName === null) continue;
      const key = keyOf(p);
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          userId: p.isBot ? null : p.userId,
          name: p.isBot ? `Bot (${p.botLevel ?? 'medium'})` : (currentNames.get(p.userId ?? -1) ?? 'Player'),
          teamName: p.teamName,
          points: 0,
          roundsPlayed: 0,
          leaguePoints: 0,
          currentRoundPoints: 0,
        });
      }
    }
    return {
      seriesId,
      roundNumber: game.roundNumber,
      rounds,
      rows: [...rows.values()].sort((a, b) => b.points - a.points || b.currentRoundPoints - a.currentRoundPoints || b.leaguePoints - a.leaguePoints || a.teamName.localeCompare(b.teamName)),
    };
  }

  // ---------- Internals ----------

  private slotOf(p: ParticipantRow, slotKey: string) {
    const formation = formationOf(p);
    const slot = formation ? getFormation(formation).slots.find((s) => s.key === slotKey) : undefined;
    if (!slot) throw badRequest('wrong_slot', `No ${slotKey} slot in this team`);
    return slot;
  }

  private playerOf(pool: Pool, id: number) {
    const p = pool.players.find((x) => x.id === id);
    if (!p) throw badRequest('unknown_player', 'That player is not in the pool');
    return p;
  }

  private async mine(code: string, userIn: AuthUser | null): Promise<{ game: GameRow; me: ParticipantRow; parts: ParticipantRow[] }> {
    const user = requireUser(userIn);
    const game = await this.getByCode(code);
    const { db, t } = this.database;
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, game.id));
    const me = parts.find((p) => p.userId === user.id && p.teamName !== null);
    if (!me) throw forbidden('You do not have a team in this game');
    return { game, me, parts };
  }

  private async getByCode(code: string): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.joinCode, code.toUpperCase())).limit(1);
    if (!game) throw notFound('No game with that code');
    return game;
  }

  private async getById(id: number): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, id)).limit(1);
    if (!game) throw notFound('Game not found');
    return game;
  }

  private async compatibility(): Promise<SlotCompatibility> {
    return getSetting(this.database, 'positions.compatibility');
  }
}

function toTradeView(r: TradeRow): TradeView {
  return {
    id: r.id,
    fromParticipantId: r.fromParticipantId,
    toParticipantId: r.toParticipantId,
    offerPlayerId: r.offerPlayerId,
    requestPlayerId: r.requestPlayerId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}
