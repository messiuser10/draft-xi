/**
 * Data rules for the seed files (spec section 5). Errors block seeding; warnings are printed
 * for the owner to review.
 */
import { isPosition, MAX_OVERALL, MIN_OVERALL } from '@draft-xi/engine';
import type { Dataset } from './dataset';

export const DATA_RULES = {
  expectedPlayerCount: 618,
  expectedClubCount: 20,
  minSquadSize: 22,
  minGoalkeepers: 2,
};
export type DataRules = typeof DATA_RULES;

export type IssueCode =
  // errors
  | 'player-count'
  | 'unknown-club'
  | 'duplicate-club'
  | 'squad-too-small'
  | 'too-few-goalkeepers'
  | 'duplicate-player'
  | 'invalid-position'
  | 'rating-out-of-range'
  | 'missing-value'
  // warnings
  | 'club-count'
  | 'squad-size-mismatch'
  | 'csv-mismatch'
  | 'redundant-alt-position'
  | 'invalid-color';

export interface DataIssue {
  code: IssueCode;
  message: string;
  club?: string;
  player?: string;
}

export interface ClubSummary {
  name: string;
  players: number;
  goalkeepers: number;
  /** squad_size as written in clubs.json, if present. */
  declaredSquadSize: number | undefined;
}

export interface ValidationResult {
  ok: boolean;
  totalPlayers: number;
  errors: DataIssue[];
  warnings: DataIssue[];
  clubs: ClubSummary[];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_LISTED_DIFFS = 10;

const nameKey = (name: string) => name.toLocaleLowerCase('en');

export function validateDataset(dataset: Dataset, rules: DataRules = DATA_RULES): ValidationResult {
  const errors: DataIssue[] = [];
  const warnings: DataIssue[] = [];
  const { clubs, players } = dataset;

  // Clubs file.
  if (clubs.length !== rules.expectedClubCount) {
    warnings.push({
      code: 'club-count',
      message: `clubs.json has ${clubs.length} clubs, expected ${rules.expectedClubCount}`,
    });
  }
  const clubNames = new Set<string>();
  for (const club of clubs) {
    if (club.name === '') {
      errors.push({ code: 'missing-value', message: 'clubs.json has a club with an empty name' });
      continue;
    }
    if (clubNames.has(club.name)) {
      errors.push({
        code: 'duplicate-club',
        club: club.name,
        message: `clubs.json lists "${club.name}" more than once`,
      });
    }
    clubNames.add(club.name);
    for (const [field, value] of [
      ['primary_color', club.primary_color],
      ['secondary_color', club.secondary_color],
    ] as const) {
      if (!HEX_COLOR.test(value)) {
        warnings.push({
          code: 'invalid-color',
          club: club.name,
          message: `${club.name}: ${field} "${value}" is not a #RRGGBB colour`,
        });
      }
    }
  }

  // Total rows.
  if (players.length !== rules.expectedPlayerCount) {
    errors.push({
      code: 'player-count',
      message: `players.seed.json has ${players.length} players, expected ${rules.expectedPlayerCount}`,
    });
  }

  // Per-player rules.
  const unknownClubs = new Map<string, number>();
  const seenInClub = new Map<string, Set<string>>();
  for (const p of players) {
    const who = `${p.name || '(no name)'} (${p.club || 'no club'})`;

    if (p.name === '' || p.club === '' || p.nationality === '') {
      errors.push({
        code: 'missing-value',
        club: p.club,
        player: p.name,
        message: `${who}: name, club and nationality are all required`,
      });
    }

    if (!clubNames.has(p.club)) {
      unknownClubs.set(p.club, (unknownClubs.get(p.club) ?? 0) + 1);
    }

    const seen = seenInClub.get(p.club) ?? new Set<string>();
    seenInClub.set(p.club, seen);
    if (seen.has(nameKey(p.name))) {
      errors.push({
        code: 'duplicate-player',
        club: p.club,
        player: p.name,
        message: `${who}: listed more than once at the same club`,
      });
    }
    seen.add(nameKey(p.name));

    if (!isPosition(p.primary_position)) {
      errors.push({
        code: 'invalid-position',
        club: p.club,
        player: p.name,
        message: `${who}: primary_position "${p.primary_position}" is not a valid position`,
      });
    }
    for (const alt of p.alt_positions) {
      if (!isPosition(alt)) {
        errors.push({
          code: 'invalid-position',
          club: p.club,
          player: p.name,
          message: `${who}: alt position "${alt}" is not a valid position`,
        });
      }
    }
    const alts = new Set(p.alt_positions);
    if (alts.size !== p.alt_positions.length || alts.has(p.primary_position)) {
      warnings.push({
        code: 'redundant-alt-position',
        club: p.club,
        player: p.name,
        message: `${who}: alt_positions repeats a position or the primary position`,
      });
    }

    if (!Number.isInteger(p.overall) || p.overall < MIN_OVERALL || p.overall > MAX_OVERALL) {
      errors.push({
        code: 'rating-out-of-range',
        club: p.club,
        player: p.name,
        message: `${who}: overall ${p.overall} must be a whole number from ${MIN_OVERALL} to ${MAX_OVERALL}`,
      });
    }
  }

  for (const [club, count] of unknownClubs) {
    errors.push({
      code: 'unknown-club',
      club,
      message: `"${club}" is not in clubs.json (${count} player${count === 1 ? '' : 's'})`,
    });
  }

  // Per-club rules.
  const summaries: ClubSummary[] = clubs.map((club) => {
    const squad = players.filter((p) => p.club === club.name);
    const goalkeepers = squad.filter(
      (p) => p.primary_position === 'GK' || p.alt_positions.includes('GK'),
    ).length;
    return {
      name: club.name,
      players: squad.length,
      goalkeepers,
      declaredSquadSize: club.squad_size,
    };
  });
  for (const s of summaries) {
    if (s.players < rules.minSquadSize) {
      errors.push({
        code: 'squad-too-small',
        club: s.name,
        message: `${s.name} has ${s.players} players, needs at least ${rules.minSquadSize}`,
      });
    }
    if (s.goalkeepers < rules.minGoalkeepers) {
      errors.push({
        code: 'too-few-goalkeepers',
        club: s.name,
        message: `${s.name} has ${s.goalkeepers} goalkeeper${s.goalkeepers === 1 ? '' : 's'}, needs at least ${rules.minGoalkeepers}`,
      });
    }
    if (s.declaredSquadSize !== undefined && s.declaredSquadSize !== s.players) {
      warnings.push({
        code: 'squad-size-mismatch',
        club: s.name,
        message: `${s.name}: clubs.json says squad_size ${s.declaredSquadSize}, players.seed.json has ${s.players}`,
      });
    }
  }

  warnings.push(...compareCsvWithJson(dataset));

  return {
    ok: errors.length === 0,
    totalPlayers: players.length,
    errors,
    warnings,
    clubs: summaries,
  };
}

/** players.csv should describe exactly the same players as players.seed.json. */
function compareCsvWithJson(dataset: Dataset): DataIssue[] {
  const fromJson = dataset.players.map((p) =>
    [p.club, p.name, p.primary_position, p.overall, p.nationality].join(' | '),
  );
  const fromCsv = dataset.csvPlayers.map((p) =>
    [p.club, p.name, p.position, p.overall, p.nationality].join(' | '),
  );

  const counts = new Map<string, number>();
  for (const key of fromJson) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of fromCsv) counts.set(key, (counts.get(key) ?? 0) - 1);

  const onlyJson: string[] = [];
  const onlyCsv: string[] = [];
  for (const [key, n] of counts) {
    for (let i = 0; i < Math.abs(n); i++) (n > 0 ? onlyJson : onlyCsv).push(key);
  }

  const issues: DataIssue[] = [];
  const report = (rows: string[], where: string) => {
    if (rows.length === 0) return;
    const listed = rows.slice(0, MAX_LISTED_DIFFS).map((r) => `\n    ${r}`).join('');
    const more = rows.length > MAX_LISTED_DIFFS ? `\n    ...and ${rows.length - MAX_LISTED_DIFFS} more` : '';
    issues.push({
      code: 'csv-mismatch',
      message: `${rows.length} row(s) only in ${where}:${listed}${more}`,
    });
  };
  report(onlyJson, 'players.seed.json');
  report(onlyCsv, 'players.csv');
  return issues;
}
