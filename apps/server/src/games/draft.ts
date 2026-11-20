/**
 * The draft (spec section 8): pick validation in one transaction, server-owned timers,
 * auto-pick, queues, Pack Pick, bots, disconnect handling and host controls. Timers live in
 * memory but every deadline is stored in `games.pick_deadline`, so `restore()` rebuilds them
 * after a restart.
 */
import {
  autoPick,
  type AutoPickChoice,
  botPick,
  type BotLevel,
  deriveRng,
  type EnginePlayer,
  type FormationSlot,
  getFormation,
  isGoalkeeper,
  openSlots,
  packOptions,
  pickTurn,
  ROUNDS,
  type SlotCompatibility,
  fitsSlot,
  totalPicks,
} from '@draft-xi/engine';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { actorOf, type AuthUser, isUniqueViolation, requireUser } from '../auth/service';
import { SYSTEM_ACTOR, writeAudit } from '../audit';
import type { DraftView, GameSettings, PickView } from '../contracts';
import type { AppDb, Database } from '../db/database';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors';
import { getSetting } from '../settings/app-settings';
import { loadPool, type Pool } from './pool';
import type { GameHub } from './service';
import {
  byPickOrder,
  formationOf,
  type GameRow,
  PACK_REROLLS,
  type ParticipantRow,
  settingsOf,
  toGameView,
  toParticipantView,
} from './views';

export type PickRow = Database['t']['draftPicks']['$inferSelect'];

export interface DraftOptions {
  /** Delay before a bot (or a team on auto-draft) picks, so it feels human. */
  botDelayMs: number;
  /** How long a human may be disconnected during the draft before the host's policy applies. */
  disconnectGraceMs: number;
  /** Delay before the season auto-starts after the draft, when that admin setting is on. */
  autoStartSeasonMs: number;
}

export const DEFAULT_DRAFT_OPTIONS: DraftOptions = { botDelayMs: 1500, disconnectGraceMs: 60_000, autoStartSeasonMs: 10_000 };

interface DraftState {
  game: GameRow;
  parts: ParticipantRow[];
  picks: PickRow[];
}

interface PickRequest {
  participantId: number;
  playerId: number;
  slotKey: string;
  autoPicked: boolean;
  /** The pick number the caller saw; the pick fails if the turn has moved on. */
  pickNumber: number;
}

export function toPickView(p: PickRow): PickView {
  return {
    pickNumber: p.pickNumber,
    round: p.round,
    participantId: p.participantId,
    playerId: p.playerId,
    slotKey: p.slotKey,
    autoPicked: p.autoPicked,
    createdAt: p.createdAt.toISOString(),
  };
}

export class DraftService {
  private readonly turnTimers = new Map<number, NodeJS.Timeout>();
  private readonly disconnectTimers = new Map<number, NodeJS.Timeout>();
  private readonly seasonTimers = new Map<number, NodeJS.Timeout>();
  /** Set by the season service: starts the season when the admin setting auto-starts it. */
  onDraftComplete: ((gameId: number) => Promise<void>) | null = null;

  constructor(
    private readonly database: Database,
    private hub: GameHub,
    private readonly options: DraftOptions = DEFAULT_DRAFT_OPTIONS,
  ) {}

  setHub(hub: GameHub): void {
    this.hub = hub;
  }

  dispose(): void {
    for (const map of [this.turnTimers, this.disconnectTimers, this.seasonTimers]) {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    }
  }

  /** Stops the turn and season timers of one game (it was deleted or reset). */
  forget(gameId: number): void {
    for (const map of [this.turnTimers, this.seasonTimers]) {
      const timer = map.get(gameId);
      if (timer) clearTimeout(timer);
      map.delete(gameId);
    }
  }

  /** On boot: re-arm the timer of every draft in progress from its stored deadline. */
  async restore(): Promise<number> {
    const { db, t } = this.database;
    const live = await db.select().from(t.games).where(eq(t.games.status, 'drafting'));
    for (const g of live) await this.schedule(g.id);
    return live.length;
  }

  // ---------- Reads ----------

  async picksOf(db: AppDb, gameId: number): Promise<PickRow[]> {
    const { t } = this.database;
    return db.select().from(t.draftPicks).where(eq(t.draftPicks.gameId, gameId)).orderBy(asc(t.draftPicks.pickNumber));
  }

  async queueOf(db: AppDb, participantId: number): Promise<number[]> {
    const { t } = this.database;
    const rows = await db
      .select({ playerId: t.queueItems.playerId })
      .from(t.queueItems)
      .where(eq(t.queueItems.participantId, participantId))
      .orderBy(asc(t.queueItems.sortOrder));
    return rows.map((r) => r.playerId);
  }

  /** Draft part of the snapshot, as seen by one participant (or a spectator). */
  async draftView(game: GameRow, parts: readonly ParticipantRow[], viewer: ParticipantRow | undefined): Promise<DraftView | null> {
    if (game.status === 'lobby' || game.strengthSnapshot === null) return null;
    const picks = await this.picksOf(this.database.db, game.id);
    const myQueue = viewer ? await this.queueOf(this.database.db, viewer.id) : [];
    let pack: number[] | null = null;
    if (viewer && settingsOf(game).draftMode === 'pack' && game.currentParticipantId === viewer.id) {
      pack = this.packFor(game, viewer, picks, await loadPool(this.database), await this.compatibility()).map((p) => p.id);
    }
    return { totalPicks: totalPicks(parts.length), rounds: ROUNDS, picks: picks.map(toPickView), myQueue, pack };
  }

  async packOptionsFor(code: string, userIn: AuthUser | null): Promise<number[]> {
    const user = requireUser(userIn);
    const { game, parts, picks } = await this.loadByCode(code);
    const me = parts.find((p) => p.userId === user.id);
    if (!me) throw forbidden('You are not drafting in this game');
    if (settingsOf(game).draftMode !== 'pack') return [];
    if (game.currentParticipantId !== me.id) return [];
    return this.packFor(game, me, picks, await loadPool(this.database), await this.compatibility()).map((p) => p.id);
  }

  // ---------- Picks ----------

  /** A human's pick. All checks happen on the server inside one transaction. */
  async pick(code: string, userIn: AuthUser | null, playerId: number, slotKey: string): Promise<PickView> {
    const user = requireUser(userIn);
    const { game, parts } = await this.loadByCode(code);
    const me = parts.find((p) => p.userId === user.id);
    if (!me) throw forbidden('You are not drafting in this game');
    return this.commit(game.id, {
      participantId: me.id,
      playerId,
      slotKey,
      autoPicked: false,
      pickNumber: game.currentPickNumber,
    });
  }

  async reroll(code: string, userIn: AuthUser | null): Promise<number[]> {
    const user = requireUser(userIn);
    const { game, parts } = await this.loadByCode(code);
    const me = parts.find((p) => p.userId === user.id);
    if (!me) throw forbidden('You are not drafting in this game');
    if (settingsOf(game).draftMode !== 'pack') throw badRequest('not_pack', 'Rerolls are only for Pack Pick drafts');
    if (game.status !== 'drafting') throw conflict('not_drafting', 'The draft is not running');
    if (game.currentParticipantId !== me.id) throw new AppError(403, 'not_your_turn', "It's not your turn");
    if (me.rerollsUsed >= PACK_REROLLS) throw conflict('no_rerolls', 'You have used your reroll');
    const { db, t } = this.database;
    // Conditional on the old count, so two quick taps cannot both reroll.
    const [updated] = await db
      .update(t.participants)
      .set({ rerollsUsed: me.rerollsUsed + 1 })
      .where(and(eq(t.participants.id, me.id), eq(t.participants.rerollsUsed, me.rerollsUsed)))
      .returning();
    if (!updated) throw conflict('no_rerolls', 'You have used your reroll');
    await this.emitParticipant(game.id, updated);
    return this.packOptionsFor(code, user);
  }

  private async commit(gameId: number, req: PickRequest): Promise<PickView> {
    // Reads outside the transaction (single-connection databases would wait on it).
    const pool = await loadPool(this.database);
    const compatibility = await this.compatibility();
    const { t } = this.database;
    const result = await this.database.transaction(async (tx) => {
      const state = await this.loadState(tx, gameId);
      const { game, parts, picks } = state;
      const settings = settingsOf(game);
      if (game.status === 'paused') throw conflict('paused', 'The draft is paused');
      if (game.status !== 'drafting') throw conflict('not_drafting', 'The draft is not running');

      const player = pool.players.find((p) => p.id === req.playerId);
      if (!player) throw badRequest('unknown_player', 'That player is not in the pool');
      if (picks.some((p) => p.playerId === req.playerId)) {
        throw conflict('player_taken', 'Someone just drafted that player, pick another');
      }
      if (game.currentParticipantId !== req.participantId) throw new AppError(403, 'not_your_turn', "It's not your turn");
      if (game.currentPickNumber !== req.pickNumber) throw conflict('turn_moved', 'That turn has already passed');

      const participant = parts.find((p) => p.id === req.participantId)!;
      const formation = formationOf(participant);
      if (!formation) throw badRequest('no_formation', 'This team has no formation');
      const slot = getFormation(formation).slots.find((s) => s.key === req.slotKey);
      if (!slot) throw badRequest('wrong_slot', `${formation} has no ${req.slotKey} slot`);
      const mine = picks.filter((p) => p.participantId === participant.id);
      if (mine.some((p) => p.slotKey === slot.key)) throw badRequest('slot_filled', `Your ${slot.key} slot is already filled`);
      if (!slotAccepts(player, slot, compatibility, settings.strictPositions)) {
        throw badRequest('wrong_slot', `${player.name} (${player.primaryPosition}) cannot play ${slot.type}`);
      }
      if (settings.clubCap !== null) {
        const sameClub = mine.filter((p) => pool.players.find((x) => x.id === p.playerId)?.clubId === player.clubId).length;
        if (sameClub >= settings.clubCap) {
          throw badRequest('club_cap', `You can take at most ${settings.clubCap} players from one club`);
        }
      }
      if (settings.draftMode === 'pack' && !req.autoPicked && !participant.isBot) {
        const options = this.packFor(game, participant, picks, pool, compatibility);
        if (!options.some((p) => p.id === player.id)) throw badRequest('not_in_pack', 'Pick one of the players in your pack');
      }

      const total = totalPicks(parts.length);
      const round = Math.ceil(req.pickNumber / parts.length);
      const [inserted] = await tx
        .insert(t.draftPicks)
        .values({
          gameId,
          participantId: participant.id,
          pickNumber: req.pickNumber,
          round,
          playerId: player.id,
          slotKey: slot.key,
          autoPicked: req.autoPicked,
        })
        .returning()
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) throw conflict('player_taken', 'Someone just drafted that player, pick another');
          throw err;
        });
      if (!inserted) throw new Error('Insert returned no pick');

      const next = req.pickNumber + 1;
      const ordered = byPickOrder(parts);
      const done = next > total;
      const [updated] = await tx
        .update(t.games)
        .set(
          done
            ? { status: 'draft_complete', currentPickNumber: next, currentParticipantId: null, pickDeadline: null, pausedRemainingMs: null }
            : {
                currentPickNumber: next,
                currentParticipantId: ordered[pickTurn(next, parts.length, settings.draftMode).participantIndex]!.id,
                pickDeadline: deadlineFrom(settings),
              },
        )
        .where(and(eq(t.games.id, gameId), eq(t.games.currentPickNumber, req.pickNumber)))
        .returning();
      if (!updated) throw conflict('turn_moved', 'That turn has already passed');
      return { pick: inserted, game: updated, teamName: participant.teamName ?? 'A team', playerName: player.name, done };
    });

    this.hub.emit(gameId, {
      type: 'draft:pick',
      pick: toPickView(result.pick),
      game: toGameView(result.game),
      teamName: result.teamName,
      playerName: result.playerName,
    });
    if (result.done) await this.finish(gameId);
    else await this.schedule(gameId);
    return toPickView(result.pick);
  }

  /** The server picks for the team on the clock (timer expiry, bots, skip, end early). */
  private async autoPickNow(gameId: number, expectedPickNumber: number, force = false): Promise<PickView | null> {
    const pool = await loadPool(this.database);
    const compatibility = await this.compatibility();
    const state = await this.loadState(this.database.db, gameId);
    const { game, parts } = state;
    if (game.status !== 'drafting' || game.currentPickNumber !== expectedPickNumber || game.currentParticipantId === null) {
      return null;
    }
    const p = parts.find((x) => x.id === game.currentParticipantId)!;
    // A human with time left is not auto-picked unless forced (skip, end early).
    if (!force && !p.isBot && p.autoDraft === null && game.pickDeadline && game.pickDeadline.getTime() > Date.now() + 50) {
      return null;
    }
    const queue = await this.queueOf(this.database.db, p.id);
    const choice = this.chooseFor(state, p, pool, compatibility, queue);
    if (!choice) throw conflict('no_legal_pick', `No player in the pool fits ${p.teamName ?? 'this team'}'s open slots`);
    return this.commit(gameId, {
      participantId: p.id,
      playerId: choice.player.id,
      slotKey: choice.slot.key,
      autoPicked: !p.isBot,
      pickNumber: expectedPickNumber,
    });
  }

  private chooseFor(
    state: DraftState,
    p: ParticipantRow,
    pool: Pool,
    compatibility: SlotCompatibility,
    queue: readonly number[],
  ): AutoPickChoice | undefined {
    const { game, parts, picks } = state;
    const settings = settingsOf(game);
    const taken = new Set(picks.map((x) => x.playerId));
    const available = pool.players.filter((x) => !taken.has(x.id));
    const formation = formationOf(p)!;
    const mine = picks.filter((x) => x.participantId === p.id);
    const open = openSlots(formation, mine.map((x) => x.slotKey));
    const byId = new Map(pool.players.map((x) => [x.id, x]));
    const roster = mine.flatMap((x) => byId.get(x.playerId) ?? []);
    const clubAllowance = allowanceOf(roster, pool, settings.clubCap);
    const rng = deriveRng(game.seed ?? 0, 'bot', game.currentPickNumber, p.id);

    if (p.isBot || p.autoDraft === 'bot') {
      const rivalOpenSlots = parts
        .filter((x) => x.id !== p.id)
        .map((x) => openSlots(formationOf(x)!, picks.filter((k) => k.participantId === x.id).map((k) => k.slotKey)));
      const level: BotLevel = p.botLevel ?? 'medium';
      const pickFrom = settings.draftMode === 'pack' && !p.isBot ? this.packFor(game, p, picks, pool, compatibility) : available;
      const choice =
        botPick({ level, available: pickFrom, openSlots: open, roster, compatibility, clubAllowance, rivalOpenSlots }, rng) ??
        botPick({ level, available, openSlots: open, roster, compatibility, clubAllowance, rivalOpenSlots }, rng);
      if (choice) return choice;
    } else {
      if (settings.draftMode === 'pack') {
        const pack = this.packFor(game, p, picks, pool, compatibility);
        const fromPack = autoPick({ available: pack, openSlots: open, queue, compatibility, clubAllowance });
        if (fromPack) return fromPack;
      }
      const choice = autoPick({ available, openSlots: open, queue, compatibility, clubAllowance });
      if (choice) return choice;
    }
    // Loose positions: anyone except a keeper outfield (or an outfielder in goal).
    if (!settings.strictPositions) {
      for (const slot of open) {
        const player = [...available]
          .sort((a, b) => b.overall - a.overall)
          .find((x) => slotAccepts(x, slot, compatibility, false) && (clubAllowance?.get(x.clubId) ?? 1) > 0);
        if (player) return { player, slot, fromQueue: false };
      }
    }
    return undefined;
  }

  private packFor(
    game: GameRow,
    p: ParticipantRow,
    picks: readonly PickRow[],
    pool: Pool,
    compatibility: SlotCompatibility,
  ): EnginePlayer[] {
    const taken = new Set(picks.map((x) => x.playerId));
    const formation = formationOf(p);
    if (!formation) return [];
    const open = openSlots(formation, picks.filter((x) => x.participantId === p.id).map((x) => x.slotKey));
    const rng = deriveRng(game.seed ?? 0, 'pack', game.currentPickNumber, p.id, p.rerollsUsed);
    return packOptions(pool.players.filter((x) => !taken.has(x.id)), open, rng, 5, compatibility);
  }

  // ---------- Timers ----------

  /** Arms the timer for whoever is on the clock: their deadline, or a short delay for bots. */
  async schedule(gameId: number): Promise<void> {
    this.clearTurnTimer(gameId);
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, gameId)).limit(1);
    if (!game || game.status !== 'drafting' || game.currentParticipantId === null) return;
    const [p] = await db.select().from(t.participants).where(eq(t.participants.id, game.currentParticipantId)).limit(1);
    if (!p) return;
    let delay: number;
    if (p.isBot || p.autoDraft !== null) delay = this.options.botDelayMs;
    else if (game.pickDeadline) delay = Math.max(0, game.pickDeadline.getTime() - Date.now());
    else return;
    const expected = game.currentPickNumber;
    const timer = setTimeout(() => {
      this.turnTimers.delete(gameId);
      this.autoPickNow(gameId, expected).catch((err: unknown) => this.reportTimerError(gameId, err));
    }, delay);
    timer.unref?.();
    this.turnTimers.set(gameId, timer);
  }

  private clearTurnTimer(gameId: number): void {
    const timer = this.turnTimers.get(gameId);
    if (timer) clearTimeout(timer);
    this.turnTimers.delete(gameId);
  }

  private reportTimerError(gameId: number, err: unknown): void {
    // A lost race (someone picked first) is normal; anything else is reported to the room.
    if (err instanceof AppError && (err.code === 'turn_moved' || err.code === 'player_taken' || err.code === 'not_drafting' || err.code === 'paused')) {
      void this.schedule(gameId);
      return;
    }
    const message = err instanceof AppError ? err.message : 'The auto-pick failed';
    this.hub.emit(gameId, { type: 'game:countdown', startsAt: null, reason: message });
  }

  private async finish(gameId: number): Promise<void> {
    this.clearTurnTimer(gameId);
    const { t } = this.database;
    const game = await this.getById(gameId);
    await writeAudit(this.database.db, t, { actor: SYSTEM_ACTOR, action: 'draft.complete', target: `game:${game.joinCode}`, gameId });
    this.hub.resync(gameId);
    if ((await getSetting(this.database, 'season.autoStart')) && this.onDraftComplete) {
      const timer = setTimeout(() => {
        this.seasonTimers.delete(gameId);
        void this.onDraftComplete?.(gameId).catch(() => undefined);
      }, this.options.autoStartSeasonMs);
      timer.unref?.();
      this.seasonTimers.set(gameId, timer);
    }
  }

  cancelAutoStart(gameId: number): void {
    const timer = this.seasonTimers.get(gameId);
    if (timer) clearTimeout(timer);
    this.seasonTimers.delete(gameId);
  }

  // ---------- Queue ----------

  async setQueue(code: string, userIn: AuthUser | null, playerIds: readonly number[]): Promise<number[]> {
    const user = requireUser(userIn);
    const { game, parts } = await this.loadByCode(code);
    const me = parts.find((p) => p.userId === user.id);
    if (!me) throw forbidden('You are not drafting in this game');
    if (game.status === 'completed' || game.status === 'cancelled') throw conflict('game_over', 'This game is over');
    const unique = [...new Set(playerIds)];
    const pool = await loadPool(this.database);
    const known = new Set(pool.players.map((p) => p.id));
    if (!unique.every((id) => known.has(id))) throw badRequest('unknown_player', 'One of those players is not in the pool');
    const { t } = this.database;
    await this.database.transaction(async (tx) => {
      await tx.delete(t.queueItems).where(eq(t.queueItems.participantId, me.id));
      if (unique.length > 0) {
        await tx.insert(t.queueItems).values(unique.map((playerId, i) => ({ participantId: me.id, playerId, sortOrder: i })));
      }
    });
    return unique;
  }

  // ---------- Host controls ----------

  async pause(code: string, userIn: AuthUser | null): Promise<void> {
    const { game } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status !== 'drafting') throw conflict('not_drafting', 'The draft is not running');
    this.clearTurnTimer(game.id);
    const remaining = game.pickDeadline ? Math.max(0, game.pickDeadline.getTime() - Date.now()) : null;
    await this.updateGame(game, { status: 'paused', pickDeadline: null, pausedRemainingMs: remaining }, user, 'draft.pause');
  }

  async resume(code: string, userIn: AuthUser | null): Promise<void> {
    const { game } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status !== 'paused') throw conflict('not_paused', 'The draft is not paused');
    const remaining = game.pausedRemainingMs;
    await this.updateGame(
      game,
      { status: 'drafting', pickDeadline: remaining === null ? null : new Date(Date.now() + remaining), pausedRemainingMs: null },
      user,
      'draft.resume',
    );
    await this.schedule(game.id);
  }

  async extend(code: string, userIn: AuthUser | null, seconds: number): Promise<void> {
    const { game } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    const ms = seconds * 1000;
    if (game.status === 'drafting' && game.pickDeadline) {
      await this.updateGame(game, { pickDeadline: new Date(game.pickDeadline.getTime() + ms) }, user, 'draft.extend', { seconds });
      await this.schedule(game.id);
    } else if (game.status === 'paused' && game.pausedRemainingMs !== null) {
      await this.updateGame(game, { pausedRemainingMs: game.pausedRemainingMs + ms }, user, 'draft.extend', { seconds });
    } else {
      throw conflict('no_timer', 'There is no pick timer to extend');
    }
  }

  /** Skip turn: the server auto-picks for whoever is on the clock. */
  async skip(code: string, userIn: AuthUser | null): Promise<PickView> {
    const { game } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status !== 'drafting') throw conflict('not_drafting', 'The draft is not running');
    const pick = await this.autoPickNow(game.id, game.currentPickNumber, true);
    if (!pick) throw conflict('turn_moved', 'That turn has already passed');
    await writeAudit(this.database.db, this.database.t, { actor: actorOf(user), action: 'draft.skip', target: `game:${game.joinCode}`, gameId: game.id, details: { pickNumber: pick.pickNumber } });
    return pick;
  }

  /** Undo the last pick (audit logged). The team that made it is back on the clock. */
  async undo(code: string, userIn: AuthUser | null): Promise<void> {
    const { game: before } = await this.loadByCode(code);
    const user = this.requireHost(before, userIn);
    if (!['drafting', 'paused', 'draft_complete'].includes(before.status)) {
      throw conflict('not_drafting', 'Picks can only be undone before the season starts');
    }
    this.cancelAutoStart(before.id);
    const { t } = this.database;
    const result = await this.database.transaction(async (tx) => {
      const { game, picks } = await this.loadState(tx, before.id);
      const last = picks[picks.length - 1];
      if (!last) throw conflict('no_picks', 'There are no picks to undo');
      const settings = settingsOf(game);
      await tx.delete(t.draftPicks).where(eq(t.draftPicks.id, last.id));
      const paused = game.status === 'paused';
      const timerMs = settings.pickTimerSeconds === null ? null : settings.pickTimerSeconds * 1000;
      const [updated] = await tx
        .update(t.games)
        .set({
          status: paused ? 'paused' : 'drafting',
          currentPickNumber: last.pickNumber,
          currentParticipantId: last.participantId,
          pickDeadline: paused || timerMs === null ? null : new Date(Date.now() + timerMs),
          pausedRemainingMs: paused ? timerMs : null,
        })
        .where(eq(t.games.id, game.id))
        .returning();
      await writeAudit(tx, t, {
        actor: actorOf(user),
        action: 'draft.undo',
        target: `game:${game.joinCode}`,
        gameId: game.id,
        details: { pickNumber: last.pickNumber, playerId: last.playerId, participantId: last.participantId },
      });
      return { updated: updated!, pickNumber: last.pickNumber, wasComplete: game.status === 'draft_complete' };
    });
    this.hub.emit(before.id, { type: 'draft:undo', pickNumber: result.pickNumber, game: toGameView(result.updated) });
    if (result.wasComplete) this.hub.resync(before.id);
    await this.schedule(before.id);
  }

  /** Replace a team with a bot (or hand it back). */
  async setAutoDraft(code: string, userIn: AuthUser | null, participantId: number, enabled: boolean): Promise<void> {
    const { game, parts } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status !== 'drafting' && game.status !== 'paused') throw conflict('not_drafting', 'The draft is not running');
    const target = parts.find((p) => p.id === participantId);
    if (!target || target.isBot) throw badRequest('bad_team', 'Choose a human team in this game');
    const { db, t } = this.database;
    const [updated] = await db
      .update(t.participants)
      .set({ autoDraft: enabled ? 'bot' : null, ...(enabled && target.botLevel === null ? { botLevel: 'medium' as const } : {}) })
      .where(eq(t.participants.id, target.id))
      .returning();
    await writeAudit(db, t, { actor: actorOf(user), action: enabled ? 'draft.replace_with_bot' : 'draft.restore_human', target: `participant:${target.id}`, gameId: game.id });
    if (updated) await this.emitParticipant(game.id, updated);
    if (game.currentParticipantId === target.id) await this.schedule(game.id);
  }

  async setDisconnectPolicy(code: string, userIn: AuthUser | null, policy: GameSettings['disconnectPolicy']): Promise<void> {
    const { game } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    const settings = { ...settingsOf(game), disconnectPolicy: policy };
    await this.updateGame(game, { settings }, user, 'draft.disconnect_policy', { policy });
  }

  /** End the draft early: every remaining slot is auto-filled, in turn order. */
  async endEarly(code: string, userIn: AuthUser | null): Promise<void> {
    const { game } = await this.loadByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status === 'paused') {
      await this.updateGame(game, { status: 'drafting', pausedRemainingMs: null }, user, 'draft.resume');
    } else if (game.status !== 'drafting') {
      throw conflict('not_drafting', 'The draft is not running');
    }
    this.clearTurnTimer(game.id);
    await writeAudit(this.database.db, this.database.t, { actor: actorOf(user), action: 'draft.end_early', target: `game:${game.joinCode}`, gameId: game.id });
    for (let guard = 0; guard < 400; guard++) {
      const current = await this.getById(game.id);
      if (current.status !== 'drafting') return;
      this.clearTurnTimer(game.id);
      await this.autoPickNow(game.id, current.currentPickNumber, true).catch((err: unknown) => {
        if (err instanceof AppError && (err.code === 'turn_moved' || err.code === 'player_taken')) return null;
        throw err;
      });
    }
  }

  // ---------- Disconnects ----------

  /** Called when a participant's last socket closes or a new one opens. */
  async connectionChanged(gameId: number, participantId: number, connected: boolean): Promise<void> {
    const existing = this.disconnectTimers.get(participantId);
    if (existing) clearTimeout(existing);
    this.disconnectTimers.delete(participantId);
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, gameId)).limit(1);
    if (!game || (game.status !== 'drafting' && game.status !== 'paused')) return;

    if (connected) {
      const [p] = await db.select().from(t.participants).where(eq(t.participants.id, participantId)).limit(1);
      if (p && p.autoDraft !== null && !p.isBot) {
        const [updated] = await db.update(t.participants).set({ autoDraft: null }).where(eq(t.participants.id, p.id)).returning();
        if (updated) await this.emitParticipant(gameId, updated);
        if (game.currentParticipantId === p.id) await this.schedule(gameId);
      }
      return;
    }

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(participantId);
      void this.applyDisconnectPolicy(gameId, participantId).catch(() => undefined);
    }, this.options.disconnectGraceMs);
    timer.unref?.();
    this.disconnectTimers.set(participantId, timer);
  }

  private async applyDisconnectPolicy(gameId: number, participantId: number): Promise<void> {
    const { db, t } = this.database;
    const game = await this.getById(gameId);
    if (game.status !== 'drafting' && game.status !== 'paused') return;
    const [p] = await db.select().from(t.participants).where(eq(t.participants.id, participantId)).limit(1);
    if (!p || p.isBot || p.isConnected || p.autoDraft !== null) return;
    const policy = settingsOf(game).disconnectPolicy;
    const [updated] = await db
      .update(t.participants)
      .set({ autoDraft: policy, ...(policy === 'bot' && p.botLevel === null ? { botLevel: 'medium' as const } : {}) })
      .where(eq(t.participants.id, p.id))
      .returning();
    await writeAudit(db, t, { actor: SYSTEM_ACTOR, action: 'draft.disconnected', target: `participant:${p.id}`, gameId, details: { policy } });
    if (updated) await this.emitParticipant(gameId, updated);
    if (game.currentParticipantId === p.id) await this.schedule(gameId);
  }

  // ---------- Internals ----------

  private async loadState(db: AppDb, gameId: number): Promise<DraftState> {
    const { t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, gameId)).limit(1);
    if (!game) throw notFound('Game not found');
    const parts = await db.select().from(t.participants).where(eq(t.participants.gameId, gameId)).orderBy(t.participants.id);
    return { game, parts, picks: await this.picksOf(db, gameId) };
  }

  private async loadByCode(code: string): Promise<DraftState> {
    const { db, t } = this.database;
    const [game] = await db.select({ id: t.games.id }).from(t.games).where(eq(t.games.joinCode, code.toUpperCase())).limit(1);
    if (!game) throw notFound('No game with that code');
    return this.loadState(db, game.id);
  }

  private async getById(id: number): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, id)).limit(1);
    if (!game) throw notFound('Game not found');
    return game;
  }

  private requireHost(game: GameRow, userIn: AuthUser | null): AuthUser {
    const user = requireUser(userIn);
    if (game.hostUserId === user.id || user.role === 'admin') return user;
    throw forbidden('Only the host can do that');
  }

  private async compatibility(): Promise<SlotCompatibility> {
    return getSetting(this.database, 'positions.compatibility');
  }

  private async updateGame(
    game: GameRow,
    patch: Partial<GameRow>,
    user: AuthUser,
    action: string,
    details?: Record<string, unknown>,
  ): Promise<GameRow> {
    const { db, t } = this.database;
    const [updated] = await db.update(t.games).set(patch).where(eq(t.games.id, game.id)).returning();
    await writeAudit(db, t, { actor: actorOf(user), action, target: `game:${game.joinCode}`, gameId: game.id, ...(details ? { details } : {}) });
    if (updated) this.hub.emit(game.id, { type: 'game:updated', game: toGameView(updated) });
    return updated ?? game;
  }

  private async emitParticipant(gameId: number, row: ParticipantRow): Promise<void> {
    const game = await this.getById(gameId);
    const { db, t } = this.database;
    let name = 'Player';
    if (row.isBot) name = `Bot (${row.botLevel ?? 'medium'})`;
    else if (row.userId !== null) {
      const [u] = await db.select({ n: t.users.displayName }).from(t.users).where(inArray(t.users.id, [row.userId])).limit(1);
      name = u?.n ?? name;
    }
    this.hub.emit(gameId, { type: 'participant:updated', participant: toParticipantView(row, game, name) });
  }
}

/** Strict: the compatibility map. Loose: anyone, except keepers stay in goal and outfielders out of it. */
export function slotAccepts(player: EnginePlayer, slot: FormationSlot, compatibility: SlotCompatibility, strict: boolean): boolean {
  if (fitsSlot(player, slot.type, compatibility)) return true;
  if (strict) return false;
  return isGoalkeeper(player) === (slot.type === 'GK');
}

function allowanceOf(roster: readonly EnginePlayer[], pool: Pool, cap: number | null): Map<number, number> | undefined {
  if (cap === null) return undefined;
  const allowance = new Map(pool.clubs.map((c) => [c.id, cap]));
  for (const p of roster) allowance.set(p.clubId, (allowance.get(p.clubId) ?? cap) - 1);
  return allowance;
}

function deadlineFrom(settings: GameSettings): Date | null {
  return settings.pickTimerSeconds === null ? null : new Date(Date.now() + settings.pickTimerSeconds * 1000);
}
