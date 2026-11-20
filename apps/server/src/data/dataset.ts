/**
 * Reads the owner-supplied seed files in `data/`. This only parses structure; the game rules
 * for the data (counts, positions, ratings) live in `validate.ts`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { DATA_DIR } from '../paths';

export const DATA_FILES = {
  clubs: 'clubs.json',
  players: 'players.seed.json',
  playersCsv: 'players.csv',
} as const;

/** Trims and NFC-normalises text so "Mbappé" typed two different ways compares equal. */
const cleanText = z.string().transform((s) => s.normalize('NFC').trim());

export const clubRecordSchema = z.object({
  name: cleanText,
  short_name: cleanText,
  country: cleanText,
  league_name: cleanText,
  primary_color: cleanText,
  secondary_color: cleanText,
  squad_size: z.number().int().optional(),
  best_formation: z.string().optional(),
  best_xi_average: z.number().optional(),
  strength_rating: z.number().optional(),
  strength_rank: z.number().int().optional(),
});
export type ClubRecord = z.infer<typeof clubRecordSchema>;

export const playerRecordSchema = z.object({
  club: cleanText,
  name: cleanText,
  primary_position: cleanText,
  alt_positions: z.array(cleanText),
  overall: z.number(),
  nationality: cleanText,
});
export type PlayerRecord = z.infer<typeof playerRecordSchema>;

const playersFileSchema = z.object({
  source: z.string(),
  players: z.array(playerRecordSchema),
});

const csvRowSchema = z.object({
  club: cleanText,
  name: cleanText,
  position: cleanText,
  overall: z.coerce.number(),
  nationality: cleanText,
});
export type CsvPlayerRecord = z.infer<typeof csvRowSchema>;

export interface Dataset {
  /** Where the ratings came from, from players.seed.json. */
  source: string;
  clubs: ClubRecord[];
  /** players.seed.json is the source of truth for seeding (it carries alt_positions). */
  players: PlayerRecord[];
  /** players.csv, used to cross-check players.seed.json. */
  csvPlayers: CsvPlayerRecord[];
}

export class DatasetFileError extends Error {
  constructor(file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = 'DatasetFileError';
  }
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, file: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DatasetFileError(file, `\n${z.prettifyError(result.error)}`);
  return result.data;
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new DatasetFileError(file, `invalid JSON (${(err as Error).message})`);
  }
}

async function readDataFile(dir: string, file: string): Promise<string> {
  try {
    return await readFile(path.join(dir, file), 'utf8');
  } catch (err) {
    throw new DatasetFileError(file, `cannot read from ${dir} (${(err as Error).message})`);
  }
}

export function parseClubsJson(text: string): ClubRecord[] {
  return parseWith(z.array(clubRecordSchema), parseJson(text, DATA_FILES.clubs), DATA_FILES.clubs);
}

export function parsePlayersJson(text: string): { source: string; players: PlayerRecord[] } {
  return parseWith(playersFileSchema, parseJson(text, DATA_FILES.players), DATA_FILES.players);
}

export function parsePlayersCsv(text: string): CsvPlayerRecord[] {
  let rows: unknown;
  try {
    rows = parseCsv(text, { bom: true, columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw new DatasetFileError(DATA_FILES.playersCsv, `invalid CSV (${(err as Error).message})`);
  }
  return parseWith(z.array(csvRowSchema), rows, DATA_FILES.playersCsv);
}

export async function loadDataset(dir: string = DATA_DIR): Promise<Dataset> {
  const [clubsText, playersText, csvText] = await Promise.all([
    readDataFile(dir, DATA_FILES.clubs),
    readDataFile(dir, DATA_FILES.players),
    readDataFile(dir, DATA_FILES.playersCsv),
  ]);
  const { source, players } = parsePlayersJson(playersText);
  return {
    source,
    clubs: parseClubsJson(clubsText),
    players,
    csvPlayers: parsePlayersCsv(csvText),
  };
}
