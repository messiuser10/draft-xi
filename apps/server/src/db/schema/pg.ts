/**
 * Postgres schema, used when DATABASE_URL is a postgres:// URL. Mirrors `sqlite.ts` exactly
 * (same tables, columns, keys and indexes); `test/schema-parity.test.ts` enforces this.
 */
import type { Position } from '@draft-xi/engine';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  AUTO_DRAFT_MODES,
  BOT_LEVELS,
  GAME_STATUSES,
  MATCH_EVENT_TYPES,
  SEASON_STATUSES,
  SEASON_TEAM_KINDS,
  USER_ROLES,
} from './enums';

const id = () => integer('id').primaryKey().generatedByDefaultAsIdentity();

const timestampTz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const timestampNow = (name: string) => timestampTz(name).notNull().defaultNow();

const json = <T>(name: string) => jsonb(name).$type<T>();

/** PRNG seeds are unsigned 32-bit, which overflows Postgres `integer`. */
const seedColumn = (name: string) => bigint(name, { mode: 'number' });

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username'),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    isGuest: boolean('is_guest').notNull().default(false),
    banned: boolean('banned').notNull().default(false),
    createdAt: timestampNow('created_at'),
  },
  (t) => [uniqueIndex('users_username_unique').on(t.username)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    expiresAt: timestampTz('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const clubs = pgTable(
  'clubs',
  {
    id: id(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    country: text('country').notNull(),
    leagueName: text('league_name').notNull(),
    primaryColor: text('primary_color').notNull(),
    secondaryColor: text('secondary_color').notNull(),
    strengthRating: doublePrecision('strength_rating'),
    inPool: boolean('in_pool').notNull().default(true),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('clubs_name_unique').on(t.name)],
);

export const players = pgTable(
  'players',
  {
    id: id(),
    clubId: integer('club_id')
      .notNull()
      .references(() => clubs.id),
    fullName: text('full_name').notNull(),
    displayName: text('display_name').notNull(),
    primaryPosition: text('primary_position').$type<Position>().notNull(),
    altPositions: json<Position[]>('alt_positions').notNull(),
    overall: integer('overall').notNull(),
    nationality: text('nationality').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isInjured: boolean('is_injured').notNull().default(false),
    sourceNote: text('source_note'),
    updatedAt: timestampNow('updated_at').$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('players_club_full_name_unique').on(t.clubId, t.fullName),
    check('players_overall_range', sql`${t.overall} between 40 and 99`),
  ],
);

export const games = pgTable(
  'games',
  {
    id: id(),
    joinCode: text('join_code').notNull(),
    name: text('name').notNull(),
    hostUserId: integer('host_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: GAME_STATUSES }).notNull().default('lobby'),
    settings: json<Record<string, unknown>>('settings').notNull(),
    seed: seedColumn('seed'),
    currentPickNumber: integer('current_pick_number').notNull().default(0),
    currentParticipantId: integer('current_participant_id').references(
      (): AnyPgColumn => participants.id,
      { onDelete: 'set null' },
    ),
    pickDeadline: timestampTz('pick_deadline'),
    /** While paused: milliseconds that were left on the pick clock. */
    pausedRemainingMs: integer('paused_remaining_ms'),
    strengthSnapshot: json<unknown>('strength_snapshot'),
    aiClubIds: json<number[]>('ai_club_ids'),
    playbackState: json<unknown>('playback_state'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('games_join_code_unique').on(t.joinCode),
    index('games_status_idx').on(t.status),
  ],
);

export const participants = pgTable(
  'participants',
  {
    id: id(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    teamName: text('team_name'),
    color: text('color'),
    monogram: text('monogram'),
    formation: text('formation'),
    pickOrder: integer('pick_order'),
    isReady: boolean('is_ready').notNull().default(false),
    isBot: boolean('is_bot').notNull().default(false),
    botLevel: text('bot_level', { enum: BOT_LEVELS }),
    isConnected: boolean('is_connected').notNull().default(false),
    isSpectator: boolean('is_spectator').notNull().default(false),
    /** Pack Pick rerolls used this draft. */
    rerollsUsed: integer('rerolls_used').notNull().default(0),
    /** Set while the server drafts for a human: 'bot' (bot logic) or 'autopick' (queue, then best fit). */
    autoDraft: text('auto_draft', { enum: AUTO_DRAFT_MODES }),
  },
  (t) => [
    uniqueIndex('participants_game_team_name_unique').on(t.gameId, t.teamName),
    uniqueIndex('participants_game_user_unique').on(t.gameId, t.userId),
  ],
);

export const draftPicks = pgTable(
  'draft_picks',
  {
    id: id(),
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
    autoPicked: boolean('auto_picked').notNull().default(false),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('draft_picks_game_player_unique').on(t.gameId, t.playerId),
    uniqueIndex('draft_picks_game_pick_number_unique').on(t.gameId, t.pickNumber),
    uniqueIndex('draft_picks_participant_slot_unique').on(t.participantId, t.slotKey),
  ],
);

export const queueItems = pgTable(
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

export const seasons = pgTable(
  'seasons',
  {
    id: id(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    seed: seedColumn('seed').notNull(),
    status: text('status', { enum: SEASON_STATUSES }).notNull().default('pending'),
    parametersSnapshot: json<Record<string, unknown>>('parameters_snapshot').notNull(),
    championSeasonTeamId: integer('champion_season_team_id').references(
      (): AnyPgColumn => seasonTeams.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestampNow('created_at'),
  },
  (t) => [uniqueIndex('seasons_game_season_number_unique').on(t.gameId, t.seasonNumber)],
);

export const seasonTeams = pgTable(
  'season_teams',
  {
    id: id(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SEASON_TEAM_KINDS }).notNull(),
    participantId: integer('participant_id').references(() => participants.id, {
      onDelete: 'set null',
    }),
    clubId: integer('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    primaryColor: text('primary_color').notNull(),
    secondaryColor: text('secondary_color').notNull(),
    lineup: json<Record<string, unknown>>('lineup').notNull(),
    formation: text('formation').notNull(),
    attackRating: doublePrecision('attack_rating').notNull(),
    defenseRating: doublePrecision('defense_rating').notNull(),
    chemistryBonus: doublePrecision('chemistry_bonus').notNull().default(0),
  },
  (t) => [index('season_teams_season_idx').on(t.seasonId)],
);

export const fixtures = pgTable(
  'fixtures',
  {
    id: id(),
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

export const matchEvents = pgTable(
  'match_events',
  {
    id: id(),
    fixtureId: integer('fixture_id')
      .notNull()
      .references(() => fixtures.id, { onDelete: 'cascade' }),
    minute: integer('minute').notNull(),
    type: text('type', { enum: MATCH_EVENT_TYPES }).notNull(),
    playerId: integer('player_id').references(() => players.id, { onDelete: 'set null' }),
    seasonTeamId: integer('season_team_id')
      .notNull()
      .references(() => seasonTeams.id, { onDelete: 'cascade' }),
  },
  (t) => [index('match_events_fixture_idx').on(t.fixtureId)],
);

export const standingRows = pgTable(
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
    form: text('form').notNull().default(''),
  },
  (t) => [
    primaryKey({
      name: 'standing_rows_pk',
      columns: [t.seasonId, t.matchday, t.seasonTeamId],
    }),
  ],
);

export const playerSeasonStats = pgTable(
  'player_season_stats',
  {
    id: id(),
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
    ratingSum: doublePrecision('rating_sum').notNull().default(0),
    avgRating: doublePrecision('avg_rating').notNull().default(0),
  },
  (t) => [
    uniqueIndex('player_season_stats_unique').on(t.seasonId, t.playerId, t.seasonTeamId),
  ],
);

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
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

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('chat_messages_game_created_idx').on(t.gameId, t.createdAt)],
);
