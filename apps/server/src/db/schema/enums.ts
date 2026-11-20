/**
 * Allowed values for text "enum" columns. Shared by the SQLite and Postgres schemas so
 * both dialects store the same strings. These are TypeScript-level enums; zod validates
 * input at the API boundary.
 */
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const GAME_STATUSES = [
  'lobby',
  'drafting',
  'paused',
  'draft_complete',
  'simulating',
  'completed',
  'cancelled',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const BOT_LEVELS = ['easy', 'medium', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

export const SEASON_STATUSES = ['pending', 'simulating', 'completed', 'failed'] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const SEASON_TEAM_KINDS = ['human', 'ai'] as const;
export type SeasonTeamKind = (typeof SEASON_TEAM_KINDS)[number];

export const MATCH_EVENT_TYPES = ['goal', 'assist', 'yellow', 'red'] as const;
export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];
