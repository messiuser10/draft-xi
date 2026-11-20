/**
 * SQLite schema (default database). `pg.ts` mirrors it table-for-table and column-for-column;
 * `test/schema-parity.test.ts` fails if the two drift apart. Change both together, then run
 * `npm run db:generate`.
 */
import type { Position } from '@draft-xi/engine';
import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  AUTO_DRAFT_MODES,
  BOT_LEVELS,
  GAME_STATUSES,
  MATCH_EVENT_TYPES,
  ROSTER_MOVE_KINDS,
  SEASON_STATUSES,
  SEASON_TEAM_KINDS,
  TRADE_STATUSES,
  USER_ROLES,
  WINDOW_KINDS,
} from './enums';

/** Milliseconds since epoch, filled in by the database when omitted. */
const timestampNow = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);

const bool = (name: string) => integer(name, { mode: 'boolean' });

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Null for guest sessions, which only have a display name. */
    username: text('username'),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    isGuest: bool('is_guest').notNull().default(false),
    banned: bool('banned').notNull().default(false),
    createdAt: timestampNow('created_at'),
  },
  (t) => [uniqueIndex('users_username_unique').on(t.username)],
);

/** Login sessions. The cookie holds a random token; only its SHA-256 hash is stored. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const clubs = sqliteTable(
  'clubs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    country: text('country').notNull(),
    leagueName: text('league_name').notNull(),
    primaryColor: text('primary_color').notNull(),
    secondaryColor: text('secondary_color').notNull(),
    /** Cached club strength (best XI average plus depth bonus). Recomputed when players change. */
    strengthRating: real('strength_rating'),
    strengthOverride: real('strength_override'),
    inPool: bool('in_pool').notNull().default(true),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('clubs_name_unique').on(t.name)],
);

export const players = sqliteTable(
  'players',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clubId: integer('club_id')
      .notNull()
      .references(() => clubs.id),
    fullName: text('full_name').notNull(),
    displayName: text('display_name').notNull(),
    primaryPosition: text('primary_position').$type<Position>().notNull(),
    altPositions: json<Position[]>('alt_positions').notNull(),
    overall: integer('overall').notNull(),
    nationality: text('nationality').notNull(),
    isActive: bool('is_active').notNull().default(true),
    isInjured: bool('is_injured').notNull().default(false),
    sourceNote: text('source_note'),
    updatedAt: timestampNow('updated_at').$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('players_club_full_name_unique').on(t.clubId, t.fullName),
    check('players_overall_range', sql`${t.overall} between 40 and 99`),
  ],
);

export const games = sqliteTable(
  'games',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    joinCode: text('join_code').notNull(),
    name: text('name').notNull(),
    hostUserId: integer('host_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: GAME_STATUSES }).notNull().default('lobby'),
    settings: json<Record<string, unknown>>('settings').notNull(),
    seed: integer('seed'),
    currentPickNumber: integer('current_pick_number').notNull().default(0),
    currentParticipantId: integer('current_participant_id').references(
      (): AnySQLiteColumn => participants.id,
      { onDelete: 'set null' },
    ),
    pickDeadline: integer('pick_deadline', { mode: 'timestamp_ms' }),
    /** While paused: milliseconds that were left on the pick clock. */
    pausedRemainingMs: integer('paused_remaining_ms'),
    strengthSnapshot: json<unknown>('strength_snapshot'),
    aiClubIds: json<number[]>('ai_club_ids'),
    playbackState: json<unknown>('playback_state'),
    /** Rounds: games played again share a series (the first game's id); round 1, 2, ... */
    seriesId: integer('series_id'),
    roundNumber: integer('round_number').notNull().default(1),
    /** Transfer window and round progress once the seasons start (see games/round.ts). */
    windowState: json<unknown>('window_state'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('games_join_code_unique').on(t.joinCode),
    index('games_series_idx').on(t.seriesId),
    index('games_status_idx').on(t.status),
  ],
);

export const participants = sqliteTable(
  'participants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    /** Null for bots. */
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Null for spectators. */
    teamName: text('team_name'),
    color: text('color'),
    monogram: text('monogram'),
    formation: text('formation'),
    pickOrder: integer('pick_order'),
    isReady: bool('is_ready').notNull().default(false),
    isBot: bool('is_bot').notNull().default(false),
    botLevel: text('bot_level', { enum: BOT_LEVELS }),
    isConnected: bool('is_connected').notNull().default(false),
    isSpectator: bool('is_spectator').notNull().default(false),
    /** Pack Pick rerolls used this draft. */
    rerollsUsed: integer('rerolls_used').notNull().default(0),
    /** Set while the server drafts for a human: 'bot' (bot logic) or 'autopick' (queue, then best fit). */
    autoDraft: text('auto_draft', { enum: AUTO_DRAFT_MODES }),
    /** The captain gets a rating boost in every match. */
    captainPlayerId: integer('captain_player_id'),
    /** Club Spin: the pick number on which this team used its one re-spin. */
    respinPick: integer('respin_pick'),
  },
  (t) => [
    uniqueIndex('participants_game_team_name_unique').on(t.gameId, t.teamName),
    uniqueIndex('participants_game_user_unique').on(t.gameId, t.userId),
  ],
);

export const draftPicks = sqliteTable(
  'draft_picks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    participantId: integer('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    pickNumber: integer('pick_number').notNull(),
    round: integer('round').notNull(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    slotKey: text('slot_key').notNull(),
    autoPicked: bool('auto_picked').notNull().default(false),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('draft_picks_game_player_unique').on(t.gameId, t.playerId),
    uniqueIndex('draft_picks_game_pick_number_unique').on(t.gameId, t.pickNumber),
    uniqueIndex('draft_picks_participant_slot_unique').on(t.participantId, t.slotKey),
  ],
);

export const queueItems = sqliteTable(
  'queue_items',
  {
    participantId: integer('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ name: 'queue_items_pk', columns: [t.participantId, t.playerId] })],
);

/** Transfers and trades after the draft. A team's current XI is its draft picks with these applied in order. */
export const rosterMoves = sqliteTable(
  'roster_moves',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    participantId: integer('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    outPlayerId: integer('out_player_id').notNull(),
    inPlayerId: integer('in_player_id').notNull(),
    kind: text('kind', { enum: ROSTER_MOVE_KINDS }).notNull(),
    /** Which window: 'preseason' (after the draft), 'mini' (mid-season) or 'big' (between seasons). */
    windowKind: text('window_kind', { enum: WINDOW_KINDS }).notNull(),
    seasonNumber: integer('season_number').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('roster_moves_game_idx').on(t.gameId)],
);

export const trades = sqliteTable(
  'trades',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    fromParticipantId: integer('from_participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    toParticipantId: integer('to_participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    offerPlayerId: integer('offer_player_id').notNull(),
    requestPlayerId: integer('request_player_id').notNull(),
    status: text('status', { enum: TRADE_STATUSES }).notNull().default('pending'),
    createdAt: timestampNow('created_at'),
    respondedAt: integer('responded_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('trades_game_idx').on(t.gameId)],
);

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    seed: integer('seed').notNull(),
    status: text('status', { enum: SEASON_STATUSES }).notNull().default('pending'),
    parametersSnapshot: json<Record<string, unknown>>('parameters_snapshot').notNull(),
    /** The teams as they played the first half, so the second half can be re-simulated after the mid-season window. */
    inputsSnapshot: json<unknown>('inputs_snapshot'),
    championSeasonTeamId: integer('champion_season_team_id').references(
      (): AnySQLiteColumn => seasonTeams.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestampNow('created_at'),
  },
  (t) => [uniqueIndex('seasons_game_season_number_unique').on(t.gameId, t.seasonNumber)],
);

export const seasonTeams = sqliteTable(
  'season_teams',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SEASON_TEAM_KINDS }).notNull(),
    /** Set when kind is human. */
    participantId: integer('participant_id').references(() => participants.id, {
      onDelete: 'set null',
    }),
    /** Set when kind is ai. */
    clubId: integer('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    primaryColor: text('primary_color').notNull(),
    secondaryColor: text('secondary_color').notNull(),
    lineup: json<Record<string, unknown>>('lineup').notNull(),
    formation: text('formation').notNull(),
    attackRating: real('attack_rating').notNull(),
    defenseRating: real('defense_rating').notNull(),
    chemistryBonus: real('chemistry_bonus').notNull().default(0),
  },
  (t) => [index('season_teams_season_idx').on(t.seasonId)],
);

export const fixtures = sqliteTable(
  'fixtures',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    matchday: integer('matchday').notNull(),
    homeTeamId: integer('home_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    awayTeamId: integer('away_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    homeGoals: integer('home_goals'),
    awayGoals: integer('away_goals'),
  },
  (t) => [index('fixtures_season_matchday_idx').on(t.seasonId, t.matchday)],
);

export const matchEvents = sqliteTable(
  'match_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fixtureId: integer('fixture_id')
      .notNull()
      .references(() => fixtures.id, { onDelete: 'cascade' }),
    minute: integer('minute').notNull(),
    type: text('type', { enum: MATCH_EVENT_TYPES }).notNull(),
    /** Null when the player is a generic reserve rather than a real player. */
    playerId: integer('player_id').references(() => players.id, { onDelete: 'set null' }),
    seasonTeamId: integer('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
  },
  (t) => [index('match_events_fixture_idx').on(t.fixtureId)],
);

export const standingRows = sqliteTable(
  'standing_rows',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    matchday: integer('matchday').notNull(),
    seasonTeamId: integer('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    played: integer('played').notNull(),
    won: integer('won').notNull(),
    drawn: integer('drawn').notNull(),
    lost: integer('lost').notNull(),
    goalsFor: integer('goals_for').notNull(),
    goalsAgainst: integer('goals_against').notNull(),
    goalDifference: integer('goal_difference').notNull(),
    points: integer('points').notNull(),
    position: integer('position').notNull(),
    /** Last five results, oldest first, e.g. "WWDLW". */
    form: text('form').notNull().default(''),
  },
  (t) => [
    primaryKey({
      name: 'standing_rows_pk',
      columns: [t.seasonId, t.matchday, t.seasonTeamId],
    }),
  ],
);

export const playerSeasonStats = sqliteTable(
  'player_season_stats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    seasonTeamId: integer('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
    appearances: integer('appearances').notNull().default(0),
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    cleanSheets: integer('clean_sheets').notNull().default(0),
    yellows: integer('yellows').notNull().default(0),
    reds: integer('reds').notNull().default(0),
    ratingSum: real('rating_sum').notNull().default(0),
    avgRating: real('avg_rating').notNull().default(0),
  },
  (t) => [
    uniqueIndex('player_season_stats_unique').on(t.seasonId, t.playerId, t.seasonTeamId),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
});

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Null for system actions or when the user was later deleted. */
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Who acted, frozen at the time of the action (username, display name or "system"). */
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    gameId: integer('game_id').references(() => games.id, { onDelete: 'set null' }),
    details: json<Record<string, unknown>>('details'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_action_idx').on(t.action),
  ],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('chat_messages_game_created_idx').on(t.gameId, t.createdAt)],
);
