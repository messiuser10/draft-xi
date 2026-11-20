/**
 * API contract shared by the server and the web app: input schemas (zod) and the shapes the
 * server sends back. Imports nothing from the server's runtime, so the web app can use it.
 */
import { FORMATION_IDS, type FormationId } from '@draft-xi/engine';
import { z } from 'zod';

// ---------- Auth ----------

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, 'Username must be 3 to 20 letters, numbers or underscores');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Display name must be at least 2 characters')
  .max(24, 'Display name must be at most 24 characters');

export const registerSchema = z.object({
  username: usernameSchema,
  // bcrypt only uses the first 72 bytes.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password is too long'),
  displayName: displayNameSchema.optional(),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

export const guestSchema = z.object({ displayName: displayNameSchema });

export interface MeView {
  id: number;
  username: string | null;
  displayName: string;
  role: 'admin' | 'user';
  isGuest: boolean;
}

// ---------- Game settings ----------

export const DRAFT_MODES = ['snake', 'linear', 'pack'] as const;
export const VISIBILITIES = ['private', 'public'] as const;
export const FORMATION_RULES = ['choose', 'forced'] as const;
export const PLAYBACK_MODES = ['synchronized', 'own_pace'] as const;
/** What happens to a human who stays disconnected for 60 seconds during the draft. */
export const DISCONNECT_POLICIES = ['autopick', 'bot'] as const;
export const HARD_MAX_HUMANS = 20;

export const formationIdSchema = z.enum(FORMATION_IDS);

export const gameSettingsSchema = z.object({
  visibility: z.enum(VISIBILITIES),
  maxHumans: z.number().int().min(1).max(HARD_MAX_HUMANS),
  draftMode: z.enum(DRAFT_MODES),
  /** Seconds per pick, or null for no timer. */
  pickTimerSeconds: z.number().int().min(5).max(600).nullable(),
  formationRule: z.enum(FORMATION_RULES),
  forcedFormation: formationIdSchema.nullable(),
  /** Maximum players from one real club per team, or null for no cap. */
  clubCap: z.number().int().min(1).max(11).nullable(),
  strictPositions: z.boolean(),
  removeDraftedFromAi: z.boolean(),
  botsAllowed: z.boolean(),
  playbackMode: z.enum(PLAYBACK_MODES),
  disconnectPolicy: z.enum(DISCONNECT_POLICIES),
});
export type GameSettings = z.infer<typeof gameSettingsSchema>;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  visibility: 'private',
  maxHumans: 8,
  draftMode: 'snake',
  pickTimerSeconds: 60,
  formationRule: 'choose',
  forcedFormation: null,
  clubCap: null,
  strictPositions: true,
  removeDraftedFromAi: true,
  botsAllowed: true,
  playbackMode: 'synchronized',
  disconnectPolicy: 'autopick',
};


export const updateSettingsSchema = z.object({
  name: z.string().trim().min(3).max(40).optional(),
  settings: gameSettingsSchema.partial(),
});

// ---------- Teams ----------

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const TEAM_COLORS = [
  '#22C55E',
  '#3B82F6',
  '#EF4444',
  '#F59E0B',
  '#A855F7',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#84CC16',
  '#06B6D4',
  '#E11D48',
  '#8B5CF6',
] as const;

export const teamNameSchema = z
  .string()
  .trim()
  .min(3, 'Team name must be 3 to 24 characters')
  .max(24, 'Team name must be 3 to 24 characters');

export const teamDetailsSchema = z.object({
  teamName: teamNameSchema,
  color: z.string().regex(HEX_COLOR, 'Colour must be like #22C55E'),
  monogram: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,3}$/, 'Monogram must be 1 to 3 letters or numbers'),
  formation: formationIdSchema.nullable(),
});
export type TeamDetails = z.infer<typeof teamDetailsSchema>;

export const joinGameSchema = teamDetailsSchema;

export const gameNameSchema = z.string().trim().min(3, 'Game name must be 3 to 40 characters').max(40, 'Game name must be 3 to 40 characters');

/** The host creates the game and their own team in one step. */
export const createGameSchema = z.object({
  name: gameNameSchema,
  settings: gameSettingsSchema.partial().optional(),
  team: teamDetailsSchema,
});

/** Play Solo vs AI: one human team, 19 AI clubs, starts immediately. */
export const soloGameSchema = z.object({ team: teamDetailsSchema });
export const updateMeSchema = teamDetailsSchema.partial().extend({ isReady: z.boolean().optional() });

export const BOT_LEVELS = ['easy', 'medium', 'hard'] as const;
export const addBotSchema = z.object({ level: z.enum(BOT_LEVELS) });
export const promoteSchema = z.object({ role: z.enum(['admin', 'user']) });
export const transferHostSchema = z.object({ participantId: z.number().int().positive() });
export const pickOrderSchema = z.union([
  z.object({ randomize: z.literal(true) }),
  z.object({ order: z.array(z.number().int().positive()).min(1) }),
]);
export const startGameSchema = z.object({ force: z.boolean().optional() });
export const chatSchema = z.object({ body: z.string().trim().min(1).max(300) });
// ---------- Draft ----------

export const pickSchema = z.object({
  playerId: z.number().int().positive(),
  slotKey: z.string().trim().min(1).max(8),
});
export const queueSchema = z.object({ playerIds: z.array(z.number().int().positive()).max(100) });
export const extendTimerSchema = z.object({ seconds: z.number().int().min(5).max(300).default(30) });
export const replaceWithBotSchema = z.object({ participantId: z.number().int().positive(), enabled: z.boolean().default(true) });
export const disconnectPolicySchema = z.object({ policy: z.enum(DISCONNECT_POLICIES) });

// ---------- Season ----------

export const PLAYBACK_SPEEDS = [1, 2, 5] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
/** Milliseconds one matchday stays on screen at 1x. */
export const MATCHDAY_MS = 4000;
export const SEASON_MATCHDAYS = 38;

/** Matchday a playback state shows at `nowMs` (server time). */
export function playbackMatchday(state: PlaybackState, nowMs: number): number {
  if (!state.playing) return state.matchday;
  const elapsed = Math.max(0, nowMs - Date.parse(state.anchorAt));
  return Math.min(SEASON_MATCHDAYS, state.matchday + Math.floor((elapsed * state.speed) / MATCHDAY_MS));
}

export const runSeasonsSchema = z.object({ count: z.number().int().min(1).max(10).default(1) });
export const playbackSchema = z.object({
  action: z.enum(['play', 'pause', 'speed', 'jump', 'end']),
  speed: z.union([z.literal(1), z.literal(2), z.literal(5)]).optional(),
  matchday: z.number().int().min(0).max(SEASON_MATCHDAYS).optional(),
  seasonNumber: z.number().int().min(1).optional(),
});
export const monteCarloQuerySchema = z.object({
  runs: z.coerce.number().int().min(10).max(1000).default(1000),
  season: z.coerce.number().int().min(1).optional(),
});

export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Game codes are 6 letters or numbers');

// ---------- Views ----------

export type GameStatus =
  | 'lobby'
  | 'drafting'
  | 'paused'
  | 'draft_complete'
  | 'simulating'
  | 'completed'
  | 'cancelled';

export interface ParticipantView {
  id: number;
  userId: number | null;
  displayName: string;
  teamName: string | null;
  color: string | null;
  monogram: string | null;
  formation: FormationId | null;
  pickOrder: number | null;
  isReady: boolean;
  isBot: boolean;
  botLevel: 'easy' | 'medium' | 'hard' | null;
  isConnected: boolean;
  isHost: boolean;
  /** Set while the server drafts for this team. */
  autoDraft: 'bot' | 'autopick' | null;
  rerollsLeft: number;
}

export interface PoolHealthView {
  ok: boolean;
  teams: number;
  byPosition: { slotType: string; label: string; needed: number; available: number }[];
  warnings: string[];
}

export interface ClubStrengthView {
  clubId: number;
  clubName: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  rating: number;
  rank: number;
}

export interface GameView {
  id: number;
  code: string;
  name: string;
  status: GameStatus;
  hostUserId: number | null;
  settings: GameSettings;
  currentPickNumber: number;
  currentParticipantId: number | null;
  pickDeadline: string | null;
  /** While paused: what was left on the pick clock. */
  pausedRemainingMs: number | null;
  createdAt: string;
}

export interface ChatMessageView {
  id: number;
  userId: number | null;
  displayName: string;
  body: string;
  createdAt: string;
}

export interface KickoffView {
  /** All 20 clubs ranked by the pre-draft strength snapshot. */
  strengths: ClubStrengthView[];
  aiClubIds: number[];
}

export interface PickView {
  pickNumber: number;
  round: number;
  participantId: number;
  playerId: number;
  slotKey: string;
  autoPicked: boolean;
  createdAt: string;
}

export interface DraftView {
  totalPicks: number;
  rounds: number;
  picks: PickView[];
  /** The viewer's own queue (player ids in order). Empty for spectators. */
  myQueue: number[];
  /** Pack Pick: the viewer's five options when they are on the clock. */
  pack: number[] | null;
}

export interface PoolClubView {
  id: number;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  strengthRating: number | null;
}

export interface PoolPlayerView {
  id: number;
  clubId: number;
  name: string;
  primaryPosition: string;
  altPositions: string[];
  overall: number;
  nationality: string;
}

export interface PoolView {
  clubs: PoolClubView[];
  players: PoolPlayerView[];
}

export interface PlaybackState {
  seasonNumber: number;
  /** Matchday shown at `anchorAt` (0 = before kickoff). */
  matchday: number;
  playing: boolean;
  speed: PlaybackSpeed;
  anchorAt: string;
}

export interface SeasonListItem {
  number: number;
  seed: number;
  championTeamId: number | null;
  championName: string | null;
  championIsHuman: boolean;
  createdAt: string;
}

export interface LineupSlotView {
  slotKey: string;
  slotType: string;
  x: number;
  y: number;
  playerId: number | null;
  name: string;
  overall: number;
  effectiveOverall: number;
  clubId: number | null;
  nationality: string | null;
  outOfPosition: boolean;
  reserve: boolean;
}

export interface LeagueTeamView {
  /** season_teams id, or "p<participantId>" / "ai:<clubId>" before a season exists. */
  id: string;
  kind: 'human' | 'ai';
  participantId: number | null;
  clubId: number | null;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  monogram: string;
  formation: string;
  attack: number;
  defense: number;
  chemistry: number;
  overall: number;
  strength: number;
  rank: number;
  lineup: LineupSlotView[];
}

export interface LeagueView {
  teams: LeagueTeamView[];
  /** "draft" while built from current picks, "season" once a season stored the teams. */
  source: 'draft' | 'season';
}

export interface MatchEventView {
  minute: number;
  type: 'goal' | 'assist' | 'yellow' | 'red';
  teamId: string;
  playerId: number | null;
  playerName: string;
}

export interface FixtureView {
  id: number;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  events: MatchEventView[];
}

export interface StandingView {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  position: number;
  form: string;
}

export interface KeyMomentView {
  matchday: number;
  kind: 'hat_trick' | 'big_win' | 'upset' | 'new_leader' | 'human_derby';
  text: string;
  fixtureId: number | null;
  teamIds: string[];
}

export interface PlayerStatView {
  playerId: number;
  teamId: string;
  name: string;
  appearances: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  avgRating: number;
}

export interface SeasonView {
  number: number;
  seed: number;
  championTeamId: string | null;
  teams: LeagueTeamView[];
  fixtures: FixtureView[];
  /** standings[i] is the table after matchday i + 1. */
  standings: StandingView[][];
  keyMoments: KeyMomentView[];
  playerStats: PlayerStatView[];
}

export interface TitlesRow {
  name: string;
  kind: 'human' | 'ai';
  titles: number;
  avgPosition: number;
  avgPoints: number;
}

export interface MonteCarloView {
  runs: number;
  rows: {
    teamId: string;
    name: string;
    kind: 'human' | 'ai';
    avgPoints: number;
    avgPosition: number;
    titleChance: number;
    top4Chance: number;
    bottom3Chance: number;
  }[];
  goalsPerMatch: number;
  homeWinRate: number;
}

export interface GameSnapshot {
  game: GameView;
  participants: ParticipantView[];
  me: { userId: number | null; participantId: number | null; isHost: boolean; isAdmin: boolean };
  poolHealth: PoolHealthView;
  /** How many AI clubs will join: 20 minus the number of drafting teams. */
  aiClubCount: number;
  kickoff: KickoffView | null;
  draft: DraftView | null;
  seasons: SeasonListItem[];
  playback: PlaybackState | null;
  chat: ChatMessageView[];
  /** Pending start countdown, if any. */
  startsAt: string | null;
  serverTime: string;
}

export type GameEvent =
  | { type: 'participant:joined'; participant: ParticipantView }
  | { type: 'participant:updated'; participant: ParticipantView }
  | { type: 'participant:left'; participantId: number; kicked: boolean }
  | { type: 'game:updated'; game: GameView }
  | { type: 'game:countdown'; startsAt: string | null; reason?: string }
  | { type: 'chat:message'; message: ChatMessageView }
  | { type: 'pool:health'; poolHealth: PoolHealthView; aiClubCount: number }
  | { type: 'draft:pick'; pick: PickView; game: GameView; teamName: string; playerName: string }
  | { type: 'draft:undo'; pickNumber: number; game: GameView }
  | { type: 'playback:updated'; playback: PlaybackState };

export interface PublicLobbyView {
  code: string;
  name: string;
  hostName: string;
  teams: number;
  maxHumans: number;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}
