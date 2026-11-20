/**
 * Game lifecycle up to the start of the draft: create, join, lobby edits, host controls, the
 * start countdown and the start itself. Every rule is checked here on the server; routes and
 * sockets only parse input and call these methods.
 */
import { randomInt } from 'node:crypto';
import {
  createRng,
  type FormationId,
  LEAGUE_SIZE,
  pickTurn,
  poolHealth,
} from '@draft-xi/engine';
import type { SlotCompatibility } from '@draft-xi/engine';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { actorOf, type AuthUser, isUniqueViolation, requireUser } from '../auth/service';
import { writeAudit } from '../audit';
import {
  type ChatMessageView,
  type ClubStrengthView,
  type GameEvent,
  type GameSettings,
  gameSettingsSchema,
  type GameSnapshot,
  HARD_MAX_HUMANS,
  type KickoffView,
  type PoolHealthView,
  type PublicLobbyView,
  TEAM_COLORS,
  type TeamDetails,
  type createGameSchema,
  type pickOrderSchema,
  type updateMeSchema,
  type updateSettingsSchema,
} from '../contracts';
import type { AppDb, Database } from '../db/database';
import type { BotLevel } from '../db/schema/enums';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors';
import { getSetting } from '../settings/app-settings';
import { containsProfanity } from '../settings/profanity';
import { aiSelection, chooseAiClubs, strengthsWithOverrides } from './ai-clubs';
import { loadPool, type Pool } from './pool';
import {
  byPickOrder,
  formationOf,
  type GameRow,
  type ParticipantRow,
  settingsOf,
  toGameView,
  toParticipantView,
  SPIN_MS,
  spinApplies,
} from './views';

export interface GameHub {
  emit(gameId: number, event: GameEvent): void;
  /** Sends a fresh full snapshot to every subscriber (after large changes such as the start). */
  resync(gameId: number): void;
}

/** Draft and season services plug into the snapshot, presence and start flow through this. */
export interface GameExtensions {
  snapshotExtras(
    game: GameRow,
    parts: readonly ParticipantRow[],
    viewer: ParticipantRow | undefined,
  ): Promise<Pick<GameSnapshot, 'draft' | 'seasons' | 'playback'>>;
  connectionChanged(gameId: number, participantId: number, connected: boolean): Promise<void>;
  draftStarted(gameId: number): Promise<void>;
}

export const NULL_HUB: GameHub = { emit: () => undefined, resync: () => undefined };

/** Shape of `games.strength_snapshot`. */
export interface StrengthSnapshotEntry {
  clubId: number;
  clubName: string;
  rating: number;
  xiAverage: number;
  depthBonus: number;
  formation: FormationId;
  rank: number;
}

/** No 0/O or 1/I, so codes are easy to read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_FORMATION: FormationId = '4-3-3';
const CHAT_HISTORY = 50;

const BOT_TEAM_NAMES = [
  'Robo Rovers',
  'Circuit City',
  'Silicon Saints',
  'Binary Wanderers',
  'Algorithm Athletic',
  'Kernel Town',
  'Pixel Park Rangers',
  'Data United',
  'Cache Albion',
  'Byte Borough',
  'Logic Lions',
  'Server Strollers',
  'Script Sporting',
  'Vector Villa',
  'Turbo Torpedoes',
  'Quantum Rovers',
  'Matrix Mariners',
  'Cyber Celtic',
  'Neural Norths',
  'Proto Palace',
];

export function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export interface GameServiceOptions {
  /** Seconds between Start and the draft starting (spec: 5). */
  countdownSeconds: number;
}

interface Countdown {
  timer: NodeJS.Timeout;
  startsAt: Date;
  force: boolean;
}

export class GameService {
  private readonly countdowns = new Map<number, Countdown>();
  /** Users kicked from a lobby may not rejoin it. Kept in memory: lobbies are short-lived. */
  private readonly kicked = new Map<number, Set<number>>();
  /** Open sockets per participant, for the connection dots. */
  private readonly connections = new Map<number, number>();

  constructor(
    private readonly database: Database,
    private hub: GameHub = NULL_HUB,
    private readonly options: GameServiceOptions = { countdownSeconds: 5 },
  ) {}

  private extensions: GameExtensions | null = null;

  setHub(hub: GameHub): void {
    this.hub = hub;
  }

  setExtensions(extensions: GameExtensions): void {
    this.extensions = extensions;
  }

  /** Stops pending countdowns (server shutdown, tests). */
  dispose(): void {
    for (const c of this.countdowns.values()) clearTimeout(c.timer);
    this.countdowns.clear();
  }

  // ---------- Reads ----------

  async getByCode(code: string): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.joinCode, code.toUpperCase())).limit(1);
    if (!game) throw notFound('No game with that code');
    return game;
  }

  async getById(id: number): Promise<GameRow> {
    const { db, t } = this.database;
    const [game] = await db.select().from(t.games).where(eq(t.games.id, id)).limit(1);
    if (!game) throw notFound('Game not found');
    return game;
  }

  async listPublicLobbies(limit = 30): Promise<PublicLobbyView[]> {
    if (!(await getSetting(this.database, 'lobbies.publicEnabled'))) return [];
    const { db, t } = this.database;
    const lobbies = (
      await db.select().from(t.games).where(eq(t.games.status, 'lobby')).orderBy(desc(t.games.createdAt)).limit(200)
    )
      .filter((g) => settingsOf(g).visibility === 'public')
      .slice(0, limit);
    if (lobbies.length === 0) return [];
    const ids = lobbies.map((g) => g.id);
    const parts = await db.select().from(t.participants).where(inArray(t.participants.gameId, ids));
    const hostIds = lobbies.flatMap((g) => (g.hostUserId === null ? [] : [g.hostUserId]));
    const hosts =
      hostIds.length === 0
        ? []
        : await db.select({ id: t.users.id, displayName: t.users.displayName }).from(t.users).where(inArray(t.users.id, hostIds));
    const hostName = new Map(hosts.map((h) => [h.id, h.displayName]));
    return lobbies.map((g) => ({
      code: g.joinCode,
      name: g.name,
      hostName: (g.hostUserId !== null && hostName.get(g.hostUserId)) || 'Unknown',
      teams: parts.filter((p) => p.gameId === g.id).length,
      maxHumans: settingsOf(g).maxHumans,
      createdAt: g.createdAt.toISOString(),
    }));
  }

  /** The full authoritative state of a game, as seen by `viewer` (null for anonymous spectators). */
  async snapshot(gameId: number, viewer: AuthUser | null): Promise<GameSnapshot> {
    const { db, t } = this.database;
    const game = await this.getById(gameId);
    const parts = await this.participantsOf(db, gameId);
    const names = await this.displayNames(db, parts);
    const participants = byPickOrder(parts).map((p) => toParticipantView(p, game, this.nameOf(p, names)));
    const mine = viewer ? parts.find((p) => p.userId === viewer.id) : undefined;
    const pool = await loadPool(this.database);
    const chatRows = await db
      .select({ m: t.chatMessages, name: t.users.displayName })
      .from(t.chatMessages)
      .leftJoin(t.users, eq(t.chatMessages.userId, t.users.id))
      .where(eq(t.chatMessages.gameId, gameId))
      .orderBy(desc(t.chatMessages.id))
      .limit(CHAT_HISTORY);
    const countdown = this.countdowns.get(gameId);
    const extras = (await this.extensions?.snapshotExtras(game, parts, mine)) ?? { draft: null, seasons: [], playback: null };
    return {
      game: toGameView(game),
      participants,
      me: {
        userId: viewer?.id ?? null,
        participantId: mine?.id ?? null,
        isHost: viewer !== null && viewer.id === game.hostUserId,
        isAdmin: viewer?.role === 'admin',
      },
      poolHealth: this.poolHealthFor(game, parts, pool, await this.compatibility()),
      aiClubCount: Math.max(0, LEAGUE_SIZE - parts.length),
      kickoff: this.kickoffOf(game, pool),
      ...extras,
      chat: chatRows.reverse().map(({ m, name }) => toChatView(m, name)),
      startsAt: countdown?.startsAt.toISOString() ?? null,
      serverTime: new Date().toISOString(),
    };
  }

  async snapshotByCode(code: string, viewer: AuthUser | null): Promise<GameSnapshot> {
    return this.snapshot((await this.getByCode(code)).id, viewer);
  }

  // ---------- Create and join ----------

  async create(userIn: AuthUser | null, input: z.infer<typeof createGameSchema>): Promise<GameRow> {
    const user = requireUser(userIn);
    const maintenance = await getSetting(this.database, 'site.maintenance');
    if (maintenance.enabled && user.role !== 'admin') throw new AppError(503, 'maintenance', maintenance.message);
    const defaults = await getSetting(this.database, 'game.defaults');
    const settings = await this.resolveSettings({ ...defaults, ...input.settings }, 1);
    const team = await this.checkTeam(input.team, settings);
    const { t } = this.database;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.transaction(async (tx) => {
          const [game] = await tx
            .insert(t.games)
            .values({ joinCode: generateJoinCode(), name: input.name, hostUserId: user.id, settings })
            .returning();
          if (!game) throw new Error('Insert returned no game');
          await tx.insert(t.participants).values({ gameId: game.id, userId: user.id, pickOrder: 1, ...team });
          await writeAudit(tx, t, {
            actor: actorOf(user),
            action: 'game.create',
            target: `game:${game.joinCode}`,
            gameId: game.id,
            details: { settings },
          });
          return game;
        });
      } catch (err) {
        // A join-code collision: try a fresh code.
        if (isUniqueViolation(err) && attempt < 5) continue;
        throw err;
      }
    }
  }

  /** Play Solo vs AI: N = 1, so all 19 AI clubs join. Starts immediately. */
  async createSolo(userIn: AuthUser | null, team: TeamDetails): Promise<GameRow> {
    const user = requireUser(userIn);
    const game = await this.create(user, {
      name: `${user.displayName}'s solo league`.slice(0, 40),
      settings: { visibility: 'private', maxHumans: 1, botsAllowed: false },
      team,
    });
    const { db, t } = this.database;
    await db.update(t.participants).set({ isReady: true }).where(eq(t.participants.gameId, game.id));
    await this.performStart(game.id, user, true);
    return this.getById(game.id);
  }

  async join(code: string, userIn: AuthUser | null, details: TeamDetails): Promise<ParticipantRow> {
    const user = requireUser(userIn);
    const game = await this.getByCode(code);
    const { t } = this.database;
    const existing = (await this.participantsOf(this.database.db, game.id)).find((p) => p.userId === user.id);
    if (existing) return existing;
    if (game.status !== 'lobby') throw conflict('not_in_lobby', 'This game has already started. You can still watch it.');
    if (this.kicked.get(game.id)?.has(user.id)) throw forbidden('The host removed you from this game');
    const settings = settingsOf(game);
    const team = await this.checkTeam(details, settings);

    const row = await this.database.transaction(async (tx) => {
      const parts = await this.participantsOf(tx, game.id);
      if (parts.length >= settings.maxHumans) throw conflict('game_full', 'This game is full');
      this.assertUniqueName(parts, team.teamName, null);
      const pickOrder = Math.max(0, ...parts.map((p) => p.pickOrder ?? 0)) + 1;
      const [inserted] = await tx
        .insert(t.participants)
        .values({ gameId: game.id, userId: user.id, pickOrder, ...team })
        .returning()
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) throw conflict('team_name_taken', 'Another team already has that name');
          throw err;
        });
      if (!inserted) throw new Error('Insert returned no participant');
      return inserted;
    });
    this.cancelCountdownSilently(game.id, 'A new team joined, so the countdown was cancelled');
    await this.emitParticipant(game, row, 'participant:joined', user.displayName);
    await this.emitPoolHealth(game.id);
    return row;
  }

  async updateMe(code: string, userIn: AuthUser | null, patch: z.infer<typeof updateMeSchema>): Promise<ParticipantRow> {
    const user = requireUser(userIn);
    const game = await this.getByCode(code);
    this.requireLobby(game);
    const { t } = this.database;
    const settings = settingsOf(game);
    const next: Partial<ParticipantRow> = {};
    if (patch.teamName !== undefined) {
      this.assertCleanName(patch.teamName, await getSetting(this.database, 'profanity.words'));
      next.teamName = patch.teamName;
    }
    if (patch.color !== undefined) next.color = patch.color.toUpperCase();
    if (patch.monogram !== undefined) next.monogram = patch.monogram;
    if (patch.formation !== undefined) next.formation = await this.checkFormation(patch.formation, settings);
    if (patch.isReady !== undefined) next.isReady = patch.isReady;
    const row = await this.database.transaction(async (tx) => {
      const parts = await this.participantsOf(tx, game.id);
      const me = parts.find((p) => p.userId === user.id);
      if (!me) throw forbidden('Join the game first');
      if (next.teamName) this.assertUniqueName(parts, next.teamName, me.id);
      if (Object.keys(next).length === 0) return me;
      const [updated] = await tx.update(t.participants).set(next).where(eq(t.participants.id, me.id)).returning();
      return updated ?? me;
    });
    if (patch.isReady === false || patch.formation !== undefined) {
      this.cancelCountdownSilently(game.id, 'A team changed, so the countdown was cancelled');
    }
    await this.emitParticipant(game, row, 'participant:updated', user.displayName);
    if (patch.formation !== undefined) await this.emitPoolHealth(game.id);
    return row;
  }

  async leave(code: string, userIn: AuthUser | null): Promise<void> {
    const user = requireUser(userIn);
    const game = await this.getByCode(code);
    this.requireLobby(game);
    const parts = await this.participantsOf(this.database.db, game.id);
    const me = parts.find((p) => p.userId === user.id);
    if (!me) return;
    await this.removeParticipant(game, me, false);
    if (game.hostUserId === user.id) {
      const nextHost = byPickOrder(parts).find((p) => p.id !== me.id && !p.isBot && p.userId !== null);
      if (nextHost?.userId) {
        await this.setHost(game, nextHost.userId, actorOf(user), 'game.host_left');
      } else {
        await this.cancelGame(game, user, 'host_left');
      }
    }
  }

  // ---------- Host controls ----------

  async updateSettings(code: string, userIn: AuthUser | null, input: z.infer<typeof updateSettingsSchema>): Promise<GameRow> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    this.requireLobby(game);
    const { db, t } = this.database;
    const parts = await this.participantsOf(db, game.id);
    const settings = await this.resolveSettings({ ...settingsOf(game), ...input.settings }, parts.length);
    if (!settings.botsAllowed && parts.some((p) => p.isBot)) {
      throw badRequest('bots_present', 'Remove the bots before turning bots off');
    }
    const updated = await this.database.transaction(async (tx) => {
      const [row] = await tx
        .update(t.games)
        .set({ settings, ...(input.name ? { name: input.name } : {}) })
        .where(eq(t.games.id, game.id))
        .returning();
      if (settings.formationRule === 'forced' && settings.forcedFormation) {
        await tx.update(t.participants).set({ formation: settings.forcedFormation }).where(eq(t.participants.gameId, game.id));
      }
      await writeAudit(tx, t, { actor: actorOf(user), action: 'game.settings', target: `game:${game.joinCode}`, gameId: game.id, details: { settings } });
      return row ?? game;
    });
    this.cancelCountdownSilently(game.id, 'Settings changed, so the countdown was cancelled');
    this.hub.emit(game.id, { type: 'game:updated', game: toGameView(updated) });
    if (settings.formationRule === 'forced') this.hub.resync(game.id);
    await this.emitPoolHealth(game.id);
    return updated;
  }

  async addBot(code: string, userIn: AuthUser | null, level: BotLevel): Promise<ParticipantRow> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    this.requireLobby(game);
    const settings = settingsOf(game);
    if (!settings.botsAllowed) throw forbidden('Bots are turned off for this game');
    const { t } = this.database;
    const enabled = await getSetting(this.database, 'formations.enabled');
    const row = await this.database.transaction(async (tx) => {
      const parts = await this.participantsOf(tx, game.id);
      if (parts.length >= settings.maxHumans) throw conflict('game_full', 'This game is full');
      const taken = new Set(parts.map((p) => p.teamName?.toLowerCase()));
      const rng = createRng(randomInt(2 ** 31));
      const teamName =
        rng.shuffle(BOT_TEAM_NAMES).find((n) => !taken.has(n.toLowerCase())) ?? `Bot Team ${parts.length + 1}`;
      const color = rng.pick(TEAM_COLORS);
      const formation =
        settings.formationRule === 'forced' && settings.forcedFormation
          ? settings.forcedFormation
          : enabled.includes(DEFAULT_FORMATION)
            ? DEFAULT_FORMATION
            : (enabled[0] ?? DEFAULT_FORMATION);
      const [inserted] = await tx
        .insert(t.participants)
        .values({
          gameId: game.id,
          userId: null,
          teamName,
          color,
          monogram: initials(teamName),
          formation,
          pickOrder: Math.max(0, ...parts.map((p) => p.pickOrder ?? 0)) + 1,
          isReady: true,
          isBot: true,
          botLevel: level,
        })
        .returning();
      if (!inserted) throw new Error('Insert returned no bot');
      await writeAudit(tx, t, { actor: actorOf(user), action: 'game.add_bot', target: `game:${game.joinCode}`, gameId: game.id, details: { level, teamName } });
      return inserted;
    });
    await this.emitParticipant(game, row, 'participant:joined', botName(level));
    await this.emitPoolHealth(game.id);
    return row;
  }

  async kick(code: string, userIn: AuthUser | null, participantId: number): Promise<void> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    this.requireLobby(game);
    const target = (await this.participantsOf(this.database.db, game.id)).find((p) => p.id === participantId);
    if (!target) throw notFound('That team is not in this game');
    if (target.userId === user.id) throw badRequest('kick_self', 'You cannot kick yourself. Leave the game instead.');
    if (target.userId !== null) {
      const set = this.kicked.get(game.id) ?? new Set<number>();
      set.add(target.userId);
      this.kicked.set(game.id, set);
    }
    await this.removeParticipant(game, target, true);
    await writeAudit(this.database.db, this.database.t, {
      actor: actorOf(user),
      action: target.isBot ? 'game.remove_bot' : 'game.kick',
      target: `participant:${target.id}`,
      gameId: game.id,
      details: { teamName: target.teamName },
    });
  }

  async transferHost(code: string, userIn: AuthUser | null, participantId: number): Promise<void> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status === 'completed' || game.status === 'cancelled') throw conflict('game_over', 'This game is over');
    const target = (await this.participantsOf(this.database.db, game.id)).find((p) => p.id === participantId);
    if (!target || target.isBot || target.userId === null) throw badRequest('bad_host', 'Choose a human player in this game');
    await this.setHost(game, target.userId, actorOf(user), 'game.transfer_host');
  }

  async setPickOrder(code: string, userIn: AuthUser | null, input: z.infer<typeof pickOrderSchema>): Promise<number[]> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    this.requireLobby(game);
    const { t } = this.database;
    const ordered = await this.database.transaction(async (tx) => {
      const parts = await this.participantsOf(tx, game.id);
      let ids: number[];
      if ('randomize' in input) {
        ids = createRng(randomInt(2 ** 31)).shuffle(parts.map((p) => p.id));
      } else {
        ids = input.order;
        const expected = new Set(parts.map((p) => p.id));
        if (ids.length !== expected.size || new Set(ids).size !== ids.length || !ids.every((id) => expected.has(id))) {
          throw badRequest('bad_order', 'The order must list every team exactly once');
        }
      }
      for (const [i, id] of ids.entries()) {
        await tx.update(t.participants).set({ pickOrder: i + 1 }).where(eq(t.participants.id, id));
      }
      await writeAudit(tx, t, { actor: actorOf(user), action: 'game.pick_order', target: `game:${game.joinCode}`, gameId: game.id, details: { order: ids } });
      return ids;
    });
    this.hub.resync(game.id);
    return ordered;
  }

  async cancel(code: string, userIn: AuthUser | null): Promise<void> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    if (game.status === 'completed' || game.status === 'cancelled') throw conflict('game_over', 'This game is already over');
    await this.cancelGame(game, user, 'host_cancelled');
  }

  // ---------- Start ----------

  /** Host presses Start: checks everything now, then counts down before the real start. */
  async requestStart(code: string, userIn: AuthUser | null, force = false): Promise<{ startsAt: string }> {
    const game = await this.getByCode(code);
    const user = this.requireHost(game, userIn);
    this.requireLobby(game);
    const existing = this.countdowns.get(game.id);
    if (existing) return { startsAt: existing.startsAt.toISOString() };
    const parts = await this.participantsOf(this.database.db, game.id);
    this.assertStartable(game, parts, force, await loadPool(this.database), await this.compatibility());

    const delayMs = Math.round(this.options.countdownSeconds * 1000);
    const startsAt = new Date(Date.now() + delayMs);
    const timer = setTimeout(() => {
      this.countdowns.delete(game.id);
      this.performStart(game.id, user, force).catch((err: unknown) => {
        this.hub.emit(game.id, { type: 'game:countdown', startsAt: null, reason: messageOf(err) });
      });
    }, delayMs);
    timer.unref?.();
    this.countdowns.set(game.id, { timer, startsAt, force });
    this.hub.emit(game.id, { type: 'game:countdown', startsAt: startsAt.toISOString() });
    return { startsAt: startsAt.toISOString() };
  }

  async cancelStart(code: string, userIn: AuthUser | null): Promise<void> {
    const game = await this.getByCode(code);
    this.requireHost(game, userIn);
    this.cancelCountdownSilently(game.id, 'The host stopped the countdown');
  }

  /**
   * Spec section 7, step 3: freeze the pick order, snapshot every club's pre-draft strength,
   * choose the (20 - N) strongest clubs as AI teams, store the seed and open the draft.
   * Re-validates everything inside one transaction.
   */
  async performStart(gameId: number, actor: AuthUser | null, force: boolean): Promise<GameRow> {
    // Settings and the pool are read before the transaction: on a single-connection database
    // (PGlite, SQLite) a query outside the transaction would wait for it to finish.
    const pool = await loadPool(this.database);
    const compatibility = await this.compatibility();
    const selection = await aiSelection(this.database);
    const seed = randomInt(1, 2 ** 31);
    const { t } = this.database;
    const started = await this.database.transaction(async (tx) => {
      const [game] = await tx.select().from(t.games).where(eq(t.games.id, gameId)).limit(1);
      if (!game) throw notFound('Game not found');
      this.requireLobby(game);
      const parts = byPickOrder(await this.participantsOf(tx, gameId));
      this.assertStartable(game, parts, force, pool, compatibility);
      const settings = settingsOf(game);

      for (const [i, p] of parts.entries()) {
        if (p.pickOrder !== i + 1) await tx.update(t.participants).set({ pickOrder: i + 1 }).where(eq(t.participants.id, p.id));
      }
      const strengths = strengthsWithOverrides(pool);
      const snapshot: StrengthSnapshotEntry[] = strengths.map((s) => ({
        clubId: s.clubId,
        clubName: s.clubName,
        rating: s.rating,
        xiAverage: s.xiAverage,
        depthBonus: s.depthBonus,
        formation: s.formation,
        rank: s.rank,
      }));
      const aiClubIds = chooseAiClubs(strengths, parts.length, selection, seed);
      const first = parts[pickTurn(1, parts.length, settings.draftMode).participantIndex];
      const now = Date.now();
      const [updated] = await tx
        .update(t.games)
        .set({
          status: 'drafting',
          seed,
          currentPickNumber: 1,
          currentParticipantId: first?.id ?? null,
          pickDeadline: settings.pickTimerSeconds === null ? null : new Date(now + settings.pickTimerSeconds * 1000 + (spinApplies(settings) ? SPIN_MS : 0)),
          strengthSnapshot: snapshot,
          aiClubIds,
        })
        .where(and(eq(t.games.id, gameId), eq(t.games.status, 'lobby')))
        .returning();
      if (!updated) throw conflict('not_in_lobby', 'This game has already started');
      await writeAudit(tx, t, {
        actor: actor ? actorOf(actor) : { id: null, name: 'system' },
        action: 'game.start',
        target: `game:${game.joinCode}`,
        gameId,
        details: { teams: parts.length, aiClubIds, force },
      });
      return updated;
    });
    this.hub.emit(gameId, { type: 'game:countdown', startsAt: null });
    this.hub.resync(gameId);
    await this.extensions?.draftStarted(gameId);
    return started;
  }

  // ---------- Chat and presence ----------

  async chat(code: string, userIn: AuthUser | null, body: string): Promise<ChatMessageView> {
    const user = requireUser(userIn);
    const game = await this.getByCode(code);
    if (game.status === 'cancelled') throw conflict('game_over', 'This game was cancelled');
    const words = await getSetting(this.database, 'profanity.words');
    const clean = containsProfanity(body, words) ? body.replace(/\S/g, '*') : body;
    const { db, t } = this.database;
    const [row] = await db.insert(t.chatMessages).values({ gameId: game.id, userId: user.id, body: clean }).returning();
    if (!row) throw new Error('Insert returned no message');
    const message = toChatView(row, user.displayName);
    this.hub.emit(game.id, { type: 'chat:message', message });
    return message;
  }

  /** Called by the socket layer when a viewer's socket subscribes to or leaves a game. */
  async trackConnection(gameId: number, user: AuthUser | null, delta: 1 | -1): Promise<void> {
    if (!user) return;
    const { db, t } = this.database;
    const [p] = await db
      .select()
      .from(t.participants)
      .where(and(eq(t.participants.gameId, gameId), eq(t.participants.userId, user.id)))
      .limit(1);
    if (!p) return;
    const before = this.connections.get(p.id) ?? 0;
    const after = Math.max(0, before + delta);
    if (after === 0) this.connections.delete(p.id);
    else this.connections.set(p.id, after);
    const connected = after > 0;
    if (connected === p.isConnected) return;
    const [updated] = await db.update(t.participants).set({ isConnected: connected }).where(eq(t.participants.id, p.id)).returning();
    if (updated) await this.emitParticipant(await this.getById(gameId), updated, 'participant:updated', user.displayName);
    await this.extensions?.connectionChanged(gameId, p.id, connected);
  }

  /** On boot nobody is connected yet. */
  async resetConnections(): Promise<void> {
    const { db, t } = this.database;
    await db.update(t.participants).set({ isConnected: false }).where(eq(t.participants.isConnected, true));
  }

  // ---------- Internals ----------

  private async participantsOf(db: AppDb, gameId: number): Promise<ParticipantRow[]> {
    const { t } = this.database;
    return db.select().from(t.participants).where(eq(t.participants.gameId, gameId)).orderBy(t.participants.id);
  }

  private async displayNames(db: AppDb, parts: readonly ParticipantRow[]): Promise<Map<number, string>> {
    const ids = parts.flatMap((p) => (p.userId === null ? [] : [p.userId]));
    if (ids.length === 0) return new Map();
    const { t } = this.database;
    const users = await db.select({ id: t.users.id, displayName: t.users.displayName }).from(t.users).where(inArray(t.users.id, ids));
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  private nameOf(p: ParticipantRow, names: Map<number, string>): string {
    if (p.isBot) return botName(p.botLevel ?? 'medium');
    return (p.userId !== null && names.get(p.userId)) || 'Player';
  }

  private requireHost(game: GameRow, userIn: AuthUser | null): AuthUser {
    const user = requireUser(userIn);
    if (game.hostUserId === user.id) return user;
    // Admins can use every host control in any game (spec section 11, Games tab).
    if (user.role === 'admin') return user;
    throw forbidden('Only the host can do that');
  }

  private requireLobby(game: GameRow): void {
    if (game.status !== 'lobby') throw conflict('not_in_lobby', 'The draft has already started');
  }

  /** Merges and checks settings against the site limits in app_settings. */
  private async resolveSettings(merged: GameSettings, teamCount: number): Promise<GameSettings> {
    const settings = gameSettingsSchema.parse(merged);
    const limit = Math.min(HARD_MAX_HUMANS, await getSetting(this.database, 'game.maxHumansLimit'));
    if (settings.maxHumans > limit) throw badRequest('max_humans', `A game can have at most ${limit} teams`);
    if (settings.maxHumans < teamCount) {
      throw badRequest('max_humans', `There are already ${teamCount} teams in this game`);
    }
    if (settings.pickTimerSeconds !== null) {
      const range = await getSetting(this.database, 'draft.timerRange');
      if (settings.pickTimerSeconds < range.min || settings.pickTimerSeconds > range.max) {
        throw badRequest('pick_timer', `The pick timer must be ${range.min} to ${range.max} seconds, or off`);
      }
    }
    const enabled = await getSetting(this.database, 'formations.enabled');
    if (settings.formationRule === 'forced') {
      settings.forcedFormation ??= enabled.includes(DEFAULT_FORMATION) ? DEFAULT_FORMATION : (enabled[0] ?? DEFAULT_FORMATION);
      if (!enabled.includes(settings.forcedFormation)) throw badRequest('formation', 'That formation is not enabled');
    } else {
      settings.forcedFormation = null;
    }
    if (settings.visibility === 'public' && !(await getSetting(this.database, 'lobbies.publicEnabled'))) {
      throw badRequest('public_disabled', 'Public lobbies are turned off');
    }
    return settings;
  }

  private async checkTeam(details: TeamDetails, settings: GameSettings): Promise<TeamDetails> {
    this.assertCleanName(details.teamName, await getSetting(this.database, 'profanity.words'));
    return {
      teamName: details.teamName,
      color: details.color.toUpperCase(),
      monogram: details.monogram,
      formation: await this.checkFormation(details.formation, settings),
    };
  }

  private async checkFormation(formation: FormationId | null, settings: GameSettings): Promise<FormationId | null> {
    if (settings.formationRule === 'forced') return settings.forcedFormation;
    if (formation === null) return null;
    const enabled = await getSetting(this.database, 'formations.enabled');
    if (!enabled.includes(formation)) throw badRequest('formation', 'That formation is not enabled');
    return formation;
  }

  private assertCleanName(name: string, words: readonly string[]): void {
    if (containsProfanity(name, words)) throw badRequest('team_name_profanity', 'Please choose a different team name');
  }

  private assertUniqueName(parts: readonly ParticipantRow[], name: string, exceptId: number | null): void {
    const lower = name.trim().toLowerCase();
    if (parts.some((p) => p.id !== exceptId && p.teamName?.toLowerCase() === lower)) {
      throw conflict('team_name_taken', 'Another team already has that name');
    }
  }

  /** Pure checks (no queries), so it can run inside a transaction. */
  private assertStartable(
    game: GameRow,
    parts: readonly ParticipantRow[],
    force: boolean,
    pool: Pool,
    compatibility: SlotCompatibility,
  ): void {
    const humans = parts.filter((p) => !p.isBot);
    if (humans.length === 0) throw badRequest('no_humans', 'At least one human player is needed');
    if (parts.length > LEAGUE_SIZE) throw badRequest('too_many', `A league has at most ${LEAGUE_SIZE} teams`);
    if (!force) {
      const notReady = humans.filter((p) => !p.isReady);
      if (notReady.length > 0) {
        throw badRequest('not_ready', `Waiting for ${notReady.map((p) => p.teamName ?? 'a player').join(', ')} to be ready`);
      }
    }
    const noFormation = parts.filter((p) => formationOf(p) === null);
    if (noFormation.length > 0) {
      throw badRequest('no_formation', `${noFormation.map((p) => p.teamName ?? 'A team').join(', ')} must choose a formation`);
    }
    const health = this.poolHealthFor(game, parts, pool, compatibility);
    if (!health.ok) throw badRequest('pool_health', health.warnings[0] ?? 'The player pool cannot fill every team');
    if (pool.clubs.length < LEAGUE_SIZE - parts.length) {
      throw badRequest('not_enough_clubs', 'Not enough clubs are in the pool to fill the league');
    }
  }

  private async compatibility(): Promise<SlotCompatibility> {
    return getSetting(this.database, 'positions.compatibility');
  }

  private poolHealthFor(
    game: GameRow,
    parts: readonly ParticipantRow[],
    pool: Pool,
    compatibility: SlotCompatibility,
  ): PoolHealthView {
    const settings = settingsOf(game);
    const formations = parts.map((p) => formationOf(p) ?? settings.forcedFormation ?? DEFAULT_FORMATION);
    const health = poolHealth({
      players: pool.players,
      formations,
      compatibility,
      strictPositions: settings.strictPositions,
    });
    const undecided = parts.filter((p) => formationOf(p) === null).length;
    const warnings = [...health.warnings];
    if (undecided > 0) {
      warnings.push(`${undecided} ${undecided === 1 ? 'team has' : 'teams have'} not chosen a formation yet (counted as ${DEFAULT_FORMATION})`);
    }
    return { ok: health.ok, teams: health.teams, byPosition: health.byPosition, warnings };
  }

  private kickoffOf(game: GameRow, pool: Pool): KickoffView | null {
    if (!Array.isArray(game.strengthSnapshot)) return null;
    const clubs = new Map(pool.clubs.map((c) => [c.id, c]));
    const strengths = (game.strengthSnapshot as StrengthSnapshotEntry[]).map((s): ClubStrengthView => {
      const club = clubs.get(s.clubId);
      return {
        clubId: s.clubId,
        clubName: s.clubName,
        shortName: club?.shortName ?? s.clubName.slice(0, 3).toUpperCase(),
        primaryColor: club?.primaryColor ?? '#64748B',
        secondaryColor: club?.secondaryColor ?? '#FFFFFF',
        rating: s.rating,
        rank: s.rank,
      };
    });
    return { strengths, aiClubIds: game.aiClubIds ?? [] };
  }

  private async removeParticipant(game: GameRow, p: ParticipantRow, kicked: boolean): Promise<void> {
    const { db, t } = this.database;
    await db.delete(t.participants).where(eq(t.participants.id, p.id));
    this.connections.delete(p.id);
    this.cancelCountdownSilently(game.id, 'A team left, so the countdown was cancelled');
    this.hub.emit(game.id, { type: 'participant:left', participantId: p.id, kicked });
    await this.emitPoolHealth(game.id);
  }

  private async setHost(game: GameRow, userId: number, actor: ReturnType<typeof actorOf>, action: string): Promise<void> {
    const { db, t } = this.database;
    const [updated] = await db.update(t.games).set({ hostUserId: userId }).where(eq(t.games.id, game.id)).returning();
    await writeAudit(db, t, { actor, action, target: `user:${userId}`, gameId: game.id });
    if (updated) this.hub.emit(game.id, { type: 'game:updated', game: toGameView(updated) });
    this.hub.resync(game.id);
  }

  private async cancelGame(game: GameRow, user: AuthUser, reason: string): Promise<void> {
    const { db, t } = this.database;
    this.cancelCountdownSilently(game.id, null);
    const [updated] = await db
      .update(t.games)
      .set({ status: 'cancelled', pickDeadline: null })
      .where(eq(t.games.id, game.id))
      .returning();
    await writeAudit(db, t, { actor: actorOf(user), action: 'game.cancel', target: `game:${game.joinCode}`, gameId: game.id, details: { reason } });
    if (updated) this.hub.emit(game.id, { type: 'game:updated', game: toGameView(updated) });
    this.hub.resync(game.id);
  }

  private cancelCountdownSilently(gameId: number, reason: string | null): void {
    const c = this.countdowns.get(gameId);
    if (!c) return;
    clearTimeout(c.timer);
    this.countdowns.delete(gameId);
    this.hub.emit(gameId, { type: 'game:countdown', startsAt: null, ...(reason ? { reason } : {}) });
  }

  private async emitParticipant(
    game: GameRow,
    row: ParticipantRow,
    type: 'participant:joined' | 'participant:updated',
    displayName: string,
  ): Promise<void> {
    const fresh = await this.getById(game.id);
    this.hub.emit(game.id, { type, participant: toParticipantView(row, fresh, displayName) });
  }

  private async emitPoolHealth(gameId: number): Promise<void> {
    const game = await this.getById(gameId);
    const parts = await this.participantsOf(this.database.db, gameId);
    const poolHealthView = this.poolHealthFor(game, parts, await loadPool(this.database), await this.compatibility());
    this.hub.emit(gameId, { type: 'pool:health', poolHealth: poolHealthView, aiClubCount: Math.max(0, LEAGUE_SIZE - parts.length) });
  }
}

function toChatView(m: { id: number; userId: number | null; body: string; createdAt: Date }, name: string | null): ChatMessageView {
  return { id: m.id, userId: m.userId, displayName: name ?? 'Player', body: m.body, createdAt: m.createdAt.toISOString() };
}

function botName(level: BotLevel): string {
  return `Bot (${level[0]?.toUpperCase()}${level.slice(1)})`;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3) || 'BOT'
  );
}

function messageOf(err: unknown): string {
  if (err instanceof AppError) return err.message;
  return 'The game could not start';
}
