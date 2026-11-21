/**
 * Admin panel (spec section 11). Every method takes the acting user and re-checks the admin
 * role, so a route that forgot its guard would still refuse. Every change is audited.
 */
import { randomInt } from 'node:crypto';
import {
  type EnginePlayer,
  buildLeagueTeams,
  computeClubStrengths,
  isPosition,
  LEAGUE_SIZE,
  monteCarlo,
  type Position,
  rateTeams,
  resolveParams,
  type SeasonTeamInput,
  simulateSeason,
} from '@draft-xi/engine';
import { parse as parseCsv } from 'csv-parse/sync';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { actorOf, type AuthUser, requireAdmin } from '../auth/service';
import { writeAudit } from '../audit';
import type {
  adminAuditQuerySchema,
  adminBulkPlayersSchema,
  adminClubInputSchema,
  adminClubPatchSchema,
  adminPlayerInputSchema,
  adminPlayerPatchSchema,
  adminPlayerQuerySchema,
  AdminClubView,
  AdminGameView,
  AdminOverview,
  AdminPlayerView,
  AdminSettingView,
  AdminUserView,
  AuditEntryView,
  ClubRankingView,
  GameStatus,
  ImportPreview,
  ImportRowChange,
  LabResultView,
  labRunSchema,
  testDraftSchema,
} from '../contracts';
import type { Database } from '../db/database';
import { badRequest, conflict, notFound } from '../errors';
import { aiSelection, chooseAiClubs, strengthsWithOverrides } from '../games/ai-clubs';
import type { DraftService } from '../games/draft';
import { loadPool } from '../games/pool';
import type { SeasonService } from '../games/season';
import type { GameHub, GameService } from '../games/service';
import { toGameView } from '../games/views';
import { getSetting, SETTING_KEYS, type SettingKey, settingDefault, setSetting } from '../settings/app-settings';

type PlayerRow = Database['t']['players']['$inferSelect'];
type ClubRow = Database['t']['clubs']['$inferSelect'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const MIN_SQUAD = 22;
const MIN_KEEPERS = 2;

/** Lower case, accents and punctuation removed: "Vinícius Júnior" and "Vinicius Junior" match. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function csvCell(v: unknown): string {
  const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `${[header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')}\n`;
}

/** One row of an import, normalised from JSON or CSV. */
interface ImportRow {
  row: number;
  id: number | null;
  club: string;
  fullName: string;
  displayName: string | null;
  primaryPosition: string;
  altPositions: string[];
  overall: number;
  nationality: string;
  isActive: boolean | null;
  isInjured: boolean | null;
  sourceNote: string | null;
}

const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string' || v.trim() === '') return null;
  return ['true', '1', 'yes', 'y'].includes(v.trim().toLowerCase());
};
const str = (v: unknown): string => (typeof v === 'string' ? v.normalize('NFC').trim() : typeof v === 'number' ? String(v) : '');

export class AdminService {
  constructor(
    private readonly database: Database,
    private readonly games: GameService,
    private readonly draft: DraftService,
    private readonly seasons: SeasonService,
    private hub: GameHub,
  ) {}

  setHub(hub: GameHub): void {
    this.hub = hub;
  }

  private audit(actor: AuthUser, action: string, target: string | null, details: Record<string, unknown> | null = null, gameId: number | null = null) {
    return writeAudit(this.database.db, this.database.t, { actor: actorOf(actor), action, target, details, gameId });
  }

  // ---------- Overview ----------

  async overview(actorIn: AuthUser | null): Promise<AdminOverview> {
    requireAdmin(actorIn);
    const { db, t } = this.database;
    const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
    const counts = {
      users: await n(db.select({ n: count() }).from(t.users).where(eq(t.users.isGuest, false))),
      guests: await n(db.select({ n: count() }).from(t.users).where(eq(t.users.isGuest, true))),
      activeLobbies: await n(db.select({ n: count() }).from(t.games).where(eq(t.games.status, 'lobby'))),
      draftsInProgress: await n(db.select({ n: count() }).from(t.games).where(or(eq(t.games.status, 'drafting'), eq(t.games.status, 'paused')))),
      seasonsSimulated: await n(db.select({ n: count() }).from(t.seasons)),
      players: await n(db.select({ n: count() }).from(t.players)),
      activePlayers: await n(db.select({ n: count() }).from(t.players).where(eq(t.players.isActive, true))),
      clubs: await n(db.select({ n: count() }).from(t.clubs)),
    };
    return { counts, recent: (await this.auditRows({ limit: 15 })).map(toAuditView), health: await this.dataHealth() };
  }

  /** Warnings an admin should fix: thin squads, missing keepers, flagged rows, duplicates. */
  async dataHealth(): Promise<AdminOverview['health']> {
    const clubs = await this.clubViews();
    const out: AdminOverview['health'] = [];
    for (const c of clubs.filter((x) => x.inPool)) {
      if (c.activePlayers < MIN_SQUAD) out.push({ level: 'warning', message: `${c.name} has ${c.activePlayers} active players (needs ${MIN_SQUAD})` });
      if (c.goalkeepers < MIN_KEEPERS) out.push({ level: 'warning', message: `${c.name} has ${c.goalkeepers} active goalkeepers (needs ${MIN_KEEPERS})` });
    }
    const inPool = clubs.filter((c) => c.inPool).length;
    if (inPool < LEAGUE_SIZE) out.push({ level: 'info', message: `${inPool} clubs are in the pool; games need at least 20 minus the number of humans` });
    const { db, t } = this.database;
    const [flagged] = await db.select({ n: count() }).from(t.players).where(and(isNotNull(t.players.sourceNote), ne(t.players.sourceNote, '')));
    if (Number(flagged?.n ?? 0) > 0) out.push({ level: 'info', message: `${flagged?.n} players carry a source note to review` });
    const dupes = await this.duplicates(null);
    if (dupes.length > 0) out.push({ level: 'warning', message: `${dupes.length} possible duplicate player names` });
    return out;
  }

  // ---------- Players ----------

  async listPlayers(actorIn: AuthUser | null, q: z.infer<typeof adminPlayerQuerySchema>): Promise<{ players: AdminPlayerView[]; total: number }> {
    requireAdmin(actorIn);
    const { db, t } = this.database;
    const where: SQL[] = [];
    if (q.search) {
      const like = `%${q.search.toLowerCase()}%`;
      where.push(or(sql`lower(${t.players.fullName}) like ${like}`, sql`lower(${t.players.displayName}) like ${like}`, sql`lower(${t.players.nationality}) like ${like}`)!);
    }
    if (q.clubId) where.push(eq(t.players.clubId, q.clubId));
    if (q.position) where.push(eq(t.players.primaryPosition, q.position));
    if (q.status === 'active') where.push(eq(t.players.isActive, true));
    if (q.status === 'inactive') where.push(eq(t.players.isActive, false));
    if (q.status === 'injured') where.push(eq(t.players.isInjured, true));
    if (q.status === 'flagged') where.push(and(isNotNull(t.players.sourceNote), ne(t.players.sourceNote, ''))!);
    const cond = where.length ? and(...where) : undefined;
    const [total] = await db.select({ n: count() }).from(t.players).where(cond);
    const rows = await db
      .select({ p: t.players, club: t.clubs.name })
      .from(t.players)
      .innerJoin(t.clubs, eq(t.players.clubId, t.clubs.id))
      .where(cond)
      .orderBy(desc(t.players.overall), asc(t.players.fullName))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { players: rows.map((r) => toPlayerView(r.p, r.club)), total: Number(total?.n ?? 0) };
  }

  async createPlayer(actorIn: AuthUser | null, input: z.infer<typeof adminPlayerInputSchema>): Promise<AdminPlayerView> {
    const actor = requireAdmin(actorIn);
    const club = await this.club(input.clubId);
    const { db, t } = this.database;
    const [row] = await db
      .insert(t.players)
      .values({ ...input, displayName: input.displayName ?? input.fullName, altPositions: input.altPositions.filter((p) => p !== input.primaryPosition) })
      .returning()
      .catch((err: unknown) => {
        throw uniqueOr(err, 'That club already has a player with this name');
      });
    await this.audit(actor, 'player.create', `player:${row!.id}`, { name: input.fullName, club: club.name });
    await this.recomputeStrengths();
    return toPlayerView(row!, club.name);
  }

  async updatePlayer(actorIn: AuthUser | null, id: number, patch: z.infer<typeof adminPlayerPatchSchema>): Promise<AdminPlayerView> {
    const actor = requireAdmin(actorIn);
    const before = await this.player(id);
    if (patch.clubId !== undefined) await this.club(patch.clubId);
    const primary = patch.primaryPosition ?? before.primaryPosition;
    const set = { ...patch, ...(patch.altPositions ? { altPositions: patch.altPositions.filter((p) => p !== primary) } : {}) };
    const { db, t } = this.database;
    const [row] = await db
      .update(t.players)
      .set(set)
      .where(eq(t.players.id, id))
      .returning()
      .catch((err: unknown) => {
        throw uniqueOr(err, 'That club already has a player with this name');
      });
    await this.audit(actor, 'player.update', `player:${id}`, { changes: diff(before, row!) });
    await this.recomputeStrengths();
    return toPlayerView(row!, (await this.club(row!.clubId)).name);
  }

  /** Hard delete for players nobody drafted or played; others must be deactivated instead. */
  async deletePlayer(actorIn: AuthUser | null, id: number): Promise<void> {
    const actor = requireAdmin(actorIn);
    const p = await this.player(id);
    const { db, t } = this.database;
    const [picked] = await db.select({ n: count() }).from(t.draftPicks).where(eq(t.draftPicks.playerId, id));
    const [played] = await db.select({ n: count() }).from(t.playerSeasonStats).where(eq(t.playerSeasonStats.playerId, id));
    if (Number(picked?.n ?? 0) + Number(played?.n ?? 0) > 0) {
      throw conflict('in_use', `${p.displayName} has been drafted or played in a season. Deactivate him instead.`);
    }
    await db.delete(t.players).where(eq(t.players.id, id));
    await this.audit(actor, 'player.delete', `player:${id}`, { name: p.fullName });
    await this.recomputeStrengths();
  }

  async bulkPlayers(actorIn: AuthUser | null, input: z.infer<typeof adminBulkPlayersSchema>): Promise<{ updated: number }> {
    const actor = requireAdmin(actorIn);
    const { db, t } = this.database;
    if (input.patch.clubId !== undefined) await this.club(input.patch.clubId);
    const rows = await db.select().from(t.players).where(inArray(t.players.id, input.ids));
    let updated = 0;
    for (const p of rows) {
      const set: Partial<PlayerRow> = {};
      if (input.patch.clubId !== undefined) set.clubId = input.patch.clubId;
      if (input.patch.isActive !== undefined) set.isActive = input.patch.isActive;
      if (input.patch.isInjured !== undefined) set.isInjured = input.patch.isInjured;
      if (input.patch.overallDelta) set.overall = Math.max(40, Math.min(99, p.overall + input.patch.overallDelta));
      await db.update(t.players).set(set).where(eq(t.players.id, p.id)).catch((err: unknown) => {
        throw uniqueOr(err, `${p.fullName} already exists at the target club`);
      });
      updated++;
    }
    await this.audit(actor, 'player.bulk', `players:${updated}`, { ids: input.ids.slice(0, 50), patch: input.patch });
    await this.recomputeStrengths();
    return { updated };
  }

  /** Rebalance Club: add or subtract N overall for every player at a club (clamped to 40 to 99). */
  async rebalance(actorIn: AuthUser | null, clubId: number, delta: number): Promise<{ updated: number }> {
    const actor = requireAdmin(actorIn);
    const club = await this.club(clubId);
    const { db, t } = this.database;
    const rows = await db.select().from(t.players).where(eq(t.players.clubId, clubId));
    for (const p of rows) {
      await db.update(t.players).set({ overall: Math.max(40, Math.min(99, p.overall + delta)) }).where(eq(t.players.id, p.id));
    }
    await this.audit(actor, 'club.rebalance', `club:${clubId}`, { club: club.name, delta, players: rows.length });
    await this.recomputeStrengths();
    return { updated: rows.length };
  }

  async exportPlayers(actorIn: AuthUser | null, format: 'json' | 'csv'): Promise<{ body: string; contentType: string; filename: string }> {
    const actor = requireAdmin(actorIn);
    const { db, t } = this.database;
    const rows = await db.select({ p: t.players, club: t.clubs.name }).from(t.players).innerJoin(t.clubs, eq(t.players.clubId, t.clubs.id)).orderBy(asc(t.clubs.name), desc(t.players.overall));
    await this.audit(actor, 'player.export', null, { format, count: rows.length });
    if (format === 'json') {
      const players = rows.map(({ p, club }) => ({
        id: p.id,
        club,
        name: p.fullName,
        display_name: p.displayName,
        primary_position: p.primaryPosition,
        alt_positions: p.altPositions,
        overall: p.overall,
        nationality: p.nationality,
        active: p.isActive,
        injured: p.isInjured,
        source_note: p.sourceNote,
      }));
      return { body: JSON.stringify({ source: 'Draft XI League admin export', players }, null, 2), contentType: 'application/json', filename: 'players.json' };
    }
    const header = ['id', 'club', 'name', 'display_name', 'position', 'alt_positions', 'overall', 'nationality', 'active', 'injured', 'source_note'];
    const body = toCsv(
      header,
      rows.map(({ p, club }) => [p.id, club, p.fullName, p.displayName, p.primaryPosition, p.altPositions.join('|'), p.overall, p.nationality, p.isActive, p.isInjured, p.sourceNote ?? '']),
    );
    return { body, contentType: 'text/csv', filename: 'players.csv' };
  }

  /** Parses an import and compares it with the database. Nothing is written. */
  async importPreview(actorIn: AuthUser | null, format: 'json' | 'csv', content: string): Promise<ImportPreview> {
    requireAdmin(actorIn);
    return (await this.planImport(format, content)).preview;
  }

  /** Applies an import: adds new players and updates changed ones. Refused if any row has an error. */
  async importApply(actorIn: AuthUser | null, format: 'json' | 'csv', content: string): Promise<ImportPreview> {
    const actor = requireAdmin(actorIn);
    const plan = await this.planImport(format, content);
    if (plan.preview.errors.length > 0) throw badRequest('import_errors', `Fix the ${plan.preview.errors.length} errors in the file first`);
    const { t } = this.database;
    await this.database.transaction(async (tx) => {
      for (const ins of plan.inserts) await tx.insert(t.players).values(ins);
      for (const up of plan.updates) await tx.update(t.players).set(up.set).where(eq(t.players.id, up.id));
    });
    await this.audit(actor, 'player.import', null, { format, added: plan.preview.added.length, updated: plan.preview.updated.length });
    await this.recomputeStrengths();
    return plan.preview;
  }

  private async planImport(format: 'json' | 'csv', content: string) {
    const rows = parseImport(format, content);
    const { db, t } = this.database;
    const clubs = await db.select().from(t.clubs);
    const clubByName = new Map(clubs.flatMap((c) => [[normalizeName(c.name), c] as const, [normalizeName(c.shortName), c] as const]));
    const existing = await db.select().from(t.players);
    const byId = new Map(existing.map((p) => [p.id, p]));
    const byKey = new Map(existing.map((p) => [`${p.clubId}:${normalizeName(p.fullName)}`, p]));
    const clubName = new Map(clubs.map((c) => [c.id, c.name]));

    const preview: ImportPreview = { added: [], updated: [], unchanged: 0, errors: [] };
    const inserts: (typeof t.players.$inferInsert)[] = [];
    const updates: { id: number; set: Partial<PlayerRow> }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const err = (message: string) => preview.errors.push({ row: r.row, message });
      const club = clubByName.get(normalizeName(r.club));
      if (!club) {
        err(`Unknown club "${r.club}"`);
        continue;
      }
      if (r.fullName.length < 2) {
        err('Name is missing');
        continue;
      }
      if (!isPosition(r.primaryPosition)) {
        err(`Unknown position "${r.primaryPosition}"`);
        continue;
      }
      const badAlt = r.altPositions.find((p) => !isPosition(p));
      if (badAlt) {
        err(`Unknown alternative position "${badAlt}"`);
        continue;
      }
      if (!Number.isInteger(r.overall) || r.overall < 40 || r.overall > 99) {
        err(`Overall must be a whole number from 40 to 99, got "${r.overall}"`);
        continue;
      }
      if (!r.nationality) {
        err('Nationality is missing');
        continue;
      }
      const key = `${club.id}:${normalizeName(r.fullName)}`;
      if (seen.has(key)) {
        err(`${r.fullName} appears twice for ${club.name}`);
        continue;
      }
      seen.add(key);
      const values = {
        clubId: club.id,
        fullName: r.fullName,
        displayName: r.displayName ?? r.fullName,
        primaryPosition: r.primaryPosition,
        altPositions: r.altPositions.filter((p) => p !== r.primaryPosition) as Position[],
        overall: r.overall,
        nationality: r.nationality,
      };
      const match = (r.id !== null ? byId.get(r.id) : undefined) ?? byKey.get(key);
      if (!match) {
        inserts.push({ ...values, isActive: r.isActive ?? true, isInjured: r.isInjured ?? false, sourceNote: r.sourceNote });
        preview.added.push({ id: null, club: club.name, name: r.fullName, changes: {} });
        continue;
      }
      const set: Partial<PlayerRow> = {};
      const changes: ImportRowChange['changes'] = {};
      const compare = <K extends keyof PlayerRow>(k: K, next: PlayerRow[K] | null | undefined, keepDisplay = false) => {
        if (next === null || next === undefined) return;
        if (keepDisplay && k === 'displayName' && r.displayName === null) return;
        if (JSON.stringify(match[k]) !== JSON.stringify(next)) {
          set[k] = next;
          changes[k] = [match[k], next];
        }
      };
      compare('clubId', values.clubId);
      compare('fullName', values.fullName);
      compare('displayName', values.displayName, true);
      compare('primaryPosition', values.primaryPosition);
      compare('altPositions', values.altPositions);
      compare('overall', values.overall);
      compare('nationality', values.nationality);
      compare('isActive', r.isActive);
      compare('isInjured', r.isInjured);
      if (r.sourceNote !== null) compare('sourceNote', r.sourceNote);
      if ('clubId' in changes) changes.clubId = [clubName.get(match.clubId), club.name];
      if (Object.keys(set).length === 0) preview.unchanged++;
      else {
        updates.push({ id: match.id, set });
        preview.updated.push({ id: match.id, club: club.name, name: r.fullName, changes });
      }
    }
    return { preview, inserts, updates };
  }

  /** Players whose normalised names match (same or different clubs). */
  async duplicates(actorIn: AuthUser | null): Promise<AdminPlayerView[][]> {
    if (actorIn !== null) requireAdmin(actorIn);
    const { db, t } = this.database;
    const rows = await db.select({ p: t.players, club: t.clubs.name }).from(t.players).innerJoin(t.clubs, eq(t.players.clubId, t.clubs.id));
    const groups = new Map<string, AdminPlayerView[]>();
    for (const r of rows) {
      const key = normalizeName(r.p.fullName);
      groups.set(key, [...(groups.get(key) ?? []), toPlayerView(r.p, r.club)]);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  }

  /** Refreshes the cached `clubs.strength_rating` from active players. */
  async recomputeStrengths(): Promise<void> {
    const { db, t } = this.database;
    const clubs = await db.select().from(t.clubs);
    const players = await db.select().from(t.players).where(eq(t.players.isActive, true));
    const engine: EnginePlayer[] = players.flatMap((p) =>
      isPosition(p.primaryPosition)
        ? [{ id: p.id, clubId: p.clubId, name: p.displayName, primaryPosition: p.primaryPosition, altPositions: p.altPositions.filter(isPosition), overall: p.overall, nationality: p.nationality }]
        : [],
    );
    const withPlayers = clubs.filter((c) => engine.some((p) => p.clubId === c.id));
    const strengths = computeClubStrengths(withPlayers.map((c) => ({ id: c.id, name: c.name })), engine);
    for (const c of clubs) {
      const s = strengths.find((x) => x.clubId === c.id);
      const rating = s ? s.rating : null;
      if (c.strengthRating !== rating) await db.update(t.clubs).set({ strengthRating: rating }).where(eq(t.clubs.id, c.id));
    }
  }

  // ---------- Clubs ----------

  async listClubs(actorIn: AuthUser | null): Promise<AdminClubView[]> {
    requireAdmin(actorIn);
    return this.clubViews();
  }

  private async clubViews(): Promise<AdminClubView[]> {
    const { db, t } = this.database;
    const clubs = await db.select().from(t.clubs).orderBy(asc(t.clubs.name));
    const players = await db.select({ clubId: t.players.clubId, pos: t.players.primaryPosition }).from(t.players).where(eq(t.players.isActive, true));
    return clubs.map((c) => {
      const squad = players.filter((p) => p.clubId === c.id);
      return {
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        country: c.country,
        leagueName: c.leagueName,
        primaryColor: c.primaryColor,
        secondaryColor: c.secondaryColor,
        inPool: c.inPool,
        strengthRating: c.strengthRating,
        strengthOverride: c.strengthOverride,
        notes: c.notes,
        activePlayers: squad.length,
        goalkeepers: squad.filter((p) => p.pos === 'GK').length,
      };
    });
  }

  async createClub(actorIn: AuthUser | null, input: z.infer<typeof adminClubInputSchema>): Promise<AdminClubView> {
    const actor = requireAdmin(actorIn);
    const { db, t } = this.database;
    const [row] = await db
      .insert(t.clubs)
      .values(input)
      .returning()
      .catch((err: unknown) => {
        throw uniqueOr(err, 'A club with that name already exists');
      });
    await this.audit(actor, 'club.create', `club:${row!.id}`, { name: input.name });
    return (await this.clubViews()).find((c) => c.id === row!.id)!;
  }

  async updateClub(actorIn: AuthUser | null, id: number, patch: z.infer<typeof adminClubPatchSchema>): Promise<AdminClubView> {
    const actor = requireAdmin(actorIn);
    const before = await this.club(id);
    const { db, t } = this.database;
    const [row] = await db
      .update(t.clubs)
      .set(patch)
      .where(eq(t.clubs.id, id))
      .returning()
      .catch((err: unknown) => {
        throw uniqueOr(err, 'A club with that name already exists');
      });
    await this.audit(actor, 'club.update', `club:${id}`, { changes: diff(before, row!) });
    return (await this.clubViews()).find((c) => c.id === id)!;
  }

  /** Live strength ranking and which clubs would be AI teams for N humans. */
  async ranking(actorIn: AuthUser | null, humans: number): Promise<ClubRankingView> {
    requireAdmin(actorIn);
    const pool = await loadPool(this.database);
    const computed = new Map(computeClubStrengths(pool.engineClubs, pool.players).map((s) => [s.clubId, s.rating]));
    const strengths = strengthsWithOverrides(pool);
    const selection = await aiSelection(this.database);
    const ai = new Set(strengths.length >= LEAGUE_SIZE - humans ? chooseAiClubs(strengths, humans, selection, 1) : []);
    return {
      humans,
      method: selection.method,
      rows: strengths.map((s) => ({
        clubId: s.clubId,
        clubName: s.clubName,
        rating: s.rating,
        computed: computed.get(s.clubId) ?? s.rating,
        overridden: pool.clubs.find((c) => c.id === s.clubId)?.strengthOverride !== null,
        rank: s.rank,
        isAi: ai.has(s.clubId),
      })),
    };
  }

  // ---------- Games ----------

  async listGames(actorIn: AuthUser | null, status: GameStatus | 'all'): Promise<AdminGameView[]> {
    requireAdmin(actorIn);
    const { db, t } = this.database;
    const games = await db
      .select({ g: t.games, host: t.users.displayName })
      .from(t.games)
      .leftJoin(t.users, eq(t.games.hostUserId, t.users.id))
      .where(status === 'all' ? undefined : eq(t.games.status, status))
      .orderBy(desc(t.games.createdAt))
      .limit(300);
    if (games.length === 0) return [];
    const ids = games.map((g) => g.g.id);
    const parts = await db.select({ gameId: t.participants.gameId, isBot: t.participants.isBot }).from(t.participants).where(and(inArray(t.participants.gameId, ids), isNotNull(t.participants.teamName)));
    const seasons = await db.select({ gameId: t.seasons.gameId }).from(t.seasons).where(inArray(t.seasons.gameId, ids));
    return games.map(({ g, host }) => ({
      id: g.id,
      code: g.joinCode,
      name: g.name,
      status: g.status,
      hostName: host,
      humans: parts.filter((p) => p.gameId === g.id && !p.isBot).length,
      bots: parts.filter((p) => p.gameId === g.id && p.isBot).length,
      seasons: seasons.filter((s) => s.gameId === g.id).length,
      seed: g.seed,
      createdAt: g.createdAt.toISOString(),
    }));
  }

  /** Reset Draft: removes every pick and starts the draft again from pick 1. */
  async resetDraft(actorIn: AuthUser | null, code: string): Promise<void> {
    const actor = requireAdmin(actorIn);
    const game = await this.games.getByCode(code);
    if (!['drafting', 'paused', 'draft_complete'].includes(game.status)) throw conflict('bad_status', 'Only a draft in progress or just completed can be reset');
    const { t } = this.database;
    this.draft.forget(game.id);
    const settings = game.settings as { pickTimerSeconds: number | null };
    await this.database.transaction(async (tx) => {
      const parts = await tx.select().from(t.participants).where(and(eq(t.participants.gameId, game.id), isNotNull(t.participants.teamName))).orderBy(asc(t.participants.pickOrder));
      await tx.delete(t.rosterMoves).where(eq(t.rosterMoves.gameId, game.id));
      await tx.delete(t.trades).where(eq(t.trades.gameId, game.id));
      await tx.delete(t.draftPicks).where(eq(t.draftPicks.gameId, game.id));
      for (const p of parts) {
        await tx.update(t.participants).set({ rerollsUsed: 0, autoDraft: null, respinPick: null, captainPlayerId: null }).where(eq(t.participants.id, p.id));
      }
      await tx
        .update(t.games)
        .set({
          status: 'drafting',
          windowState: null,
          currentPickNumber: 1,
          currentParticipantId: parts[0]?.id ?? null,
          pausedRemainingMs: null,
          pickDeadline: settings.pickTimerSeconds ? new Date(Date.now() + settings.pickTimerSeconds * 1000) : null,
        })
        .where(eq(t.games.id, game.id));
    });
    await this.audit(actor, 'admin.game.reset_draft', `game:${game.joinCode}`, null, game.id);
    this.seasons.forget(game.id);
    await this.draft.schedule(game.id);
    this.hub.resync(game.id);
  }

  /**
   * Re-run Simulation: deletes every season and starts the round again from the draft (transfers
   * and trades are undone), simulating the first half of season 1 from the game seed.
   */
  async rerun(actorIn: AuthUser | null, code: string): Promise<void> {
    const actor = requireAdmin(actorIn);
    const game = await this.games.getByCode(code);
    if (game.status !== 'completed') throw conflict('bad_status', 'Only a completed game can be re-simulated');
    const { db, t } = this.database;
    await db.delete(t.seasons).where(eq(t.seasons.gameId, game.id));
    await db.delete(t.rosterMoves).where(eq(t.rosterMoves.gameId, game.id));
    await db.delete(t.trades).where(eq(t.trades.gameId, game.id));
    const [row] = await db.update(t.games).set({ status: 'draft_complete', playbackState: null, windowState: null }).where(eq(t.games.id, game.id)).returning();
    if (row) this.hub.emit(game.id, { type: 'game:updated', game: toGameView(row) });
    this.seasons.forget(game.id);
    await this.audit(actor, 'admin.game.rerun', `game:${game.joinCode}`, { seed: game.seed }, game.id);
    await this.seasons.start(code, actor);
  }

  async setSeed(actorIn: AuthUser | null, code: string, seed: number): Promise<void> {
    const actor = requireAdmin(actorIn);
    const game = await this.games.getByCode(code);
    if (game.status === 'simulating') throw conflict('busy', 'Wait for the simulation to finish');
    const { db, t } = this.database;
    await db.update(t.games).set({ seed }).where(eq(t.games.id, game.id));
    this.seasons.forget(game.id);
    await this.audit(actor, 'admin.game.seed', `game:${game.joinCode}`, { from: game.seed, to: seed }, game.id);
  }

  async deleteGame(actorIn: AuthUser | null, code: string): Promise<void> {
    const actor = requireAdmin(actorIn);
    const game = await this.games.getByCode(code);
    this.draft.forget(game.id);
    this.seasons.forget(game.id);
    const { db, t } = this.database;
    await this.audit(actor, 'admin.game.delete', `game:${game.joinCode}`, { name: game.name, status: game.status });
    await db.delete(t.games).where(eq(t.games.id, game.id));
  }

  // ---------- Settings ----------

  async listSettings(actorIn: AuthUser | null): Promise<AdminSettingView[]> {
    requireAdmin(actorIn);
    const out: AdminSettingView[] = [];
    for (const key of SETTING_KEYS) out.push({ key, value: await getSetting(this.database, key), defaultValue: settingDefault(key) });
    return out;
  }

  async updateSetting(actorIn: AuthUser | null, key: string, value: unknown): Promise<AdminSettingView> {
    const actor = requireAdmin(actorIn);
    if (!(SETTING_KEYS as string[]).includes(key)) throw notFound(`No setting called ${key}`);
    const k = key as SettingKey;
    const before = await getSetting(this.database, k);
    await setSetting(this.database, k, value as never);
    const after = await getSetting(this.database, k);
    await this.audit(actor, 'setting.update', `setting:${key}`, { from: before, to: after });
    return { key, value: after, defaultValue: settingDefault(k) };
  }

  // ---------- Simulation Lab ----------

  async labRun(actorIn: AuthUser | null, input: z.infer<typeof labRunSchema>): Promise<LabResultView> {
    const actor = requireAdmin(actorIn);
    const stored = await getSetting(this.database, 'simulation.parameters');
    const params = resolveParams({ ...stored, ...input.params });
    let inputs: SeasonTeamInput[];
    let names: Map<string, string>;
    let seed = input.seed;
    if ('gameCode' in input.source) {
      const got = await this.seasons.teamsForGame(input.source.gameCode);
      inputs = got.inputs;
      names = got.names;
      seed ??= got.seed ?? undefined;
    } else {
      const pool = await loadPool(this.database);
      const ids = [...new Set(input.source.clubIds)];
      if (ids.length % 2 !== 0) throw badRequest('odd_teams', 'Choose an even number of clubs');
      const missing = ids.filter((id) => !pool.clubs.some((c) => c.id === id));
      if (missing.length) throw badRequest('unknown_club', `Clubs ${missing.join(', ')} are not in the pool`);
      const formations = await getSetting(this.database, 'formations.enabled');
      const compatibility = await getSetting(this.database, 'positions.compatibility');
      inputs = buildLeagueTeams({
        clubs: pool.engineClubs,
        players: pool.players,
        humans: [],
        aiClubIds: ids,
        removeDraftedFromAi: false,
        lineup: { formations, compatibility, outOfPositionPenalty: params.outOfPositionPenalty, reserveRating: params.reserveRating, strict: false },
      });
      names = new Map(inputs.map((i) => [i.id, i.name]));
    }
    seed ??= randomInt(1, 2 ** 31);
    const rated = rateTeams(inputs, params);
    const teams = rated.map((r) => ({ id: r.id, name: names.get(r.id) ?? r.id, strength: r.rating.strength })).sort((a, b) => b.strength - a.strength);
    await this.audit(actor, 'lab.run', null, { mode: input.mode, seed, teams: inputs.length, runs: input.mode === 'montecarlo' ? input.runs : 1 });

    if (input.mode === 'season') {
      const result = simulateSeason(inputs, { seed, params });
      const s = result.summary;
      const table = result.table;
      return {
        mode: 'season',
        seed,
        teams,
        table,
        monteCarlo: null,
        summary: {
          goalsPerMatch: round2(s.goals / s.matches),
          homeWinRate: round2(s.homeWins / s.matches),
          drawRate: round2(s.draws / s.matches),
          championPoints: table[0]?.points ?? 0,
          bottomPoints: table.at(-1)?.points ?? 0,
          pointsSpread: (table[0]?.points ?? 0) - (table.at(-1)?.points ?? 0),
        },
      };
    }
    const mc = monteCarlo(inputs, { seed, runs: input.runs, params });
    return {
      mode: 'montecarlo',
      seed,
      teams,
      table: null,
      monteCarlo: {
        runs: mc.runs,
        rows: mc.rows.map((r) => ({ ...r, name: names.get(r.teamId) ?? r.teamId, kind: inputs.find((i) => i.id === r.teamId)?.kind ?? 'ai' })),
        goalsPerMatch: mc.goalsPerMatch,
        homeWinRate: mc.homeWinRate,
        drawRate: mc.drawRate,
        awayWinRate: mc.awayWinRate,
        pointsByPosition: mc.pointsByPosition,
        goalsHistogram: mc.goalsHistogram,
      },
      summary: {
        goalsPerMatch: mc.goalsPerMatch,
        homeWinRate: mc.homeWinRate,
        drawRate: mc.drawRate,
        championPoints: round2(mc.pointsByPosition[0] ?? 0),
        bottomPoints: round2(mc.pointsByPosition.at(-1) ?? 0),
        pointsSpread: round2((mc.pointsByPosition[0] ?? 0) - (mc.pointsByPosition.at(-1) ?? 0)),
      },
    };
  }

  /** Test Draft: a game drafted entirely by bots (the admin's own team is auto-drafted), then simulated. */
  async testDraft(actorIn: AuthUser | null, input: z.infer<typeof testDraftSchema>): Promise<{ code: string }> {
    const actor = requireAdmin(actorIn);
    const game = await this.games.create(actor, {
      name: `Test Draft ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      settings: { visibility: 'private', maxHumans: input.teams, pickTimerSeconds: null, botsAllowed: true, draftMode: 'snake' },
      team: { teamName: 'Admin Test XI', color: '#22C55E', monogram: 'AT', formation: '4-3-3' },
    });
    const { db, t } = this.database;
    await db.update(t.participants).set({ isReady: true }).where(eq(t.participants.gameId, game.id));
    for (let i = 1; i < input.teams; i++) await this.games.addBot(game.joinCode, actor, input.level);
    await this.games.performStart(game.id, actor, true);
    await this.draft.endEarly(game.joinCode, actor);
    await this.seasons.start(game.joinCode, actor);
    await this.audit(actor, 'lab.test_draft', `game:${game.joinCode}`, { teams: input.teams, level: input.level }, game.id);
    return { code: game.joinCode };
  }

  // ---------- Users ----------

  async listUsers(actorIn: AuthUser | null, search: string | undefined, includeGuests: boolean): Promise<AdminUserView[]> {
    requireAdmin(actorIn);
    const { db, t } = this.database;
    const where: SQL[] = [];
    if (!includeGuests) where.push(eq(t.users.isGuest, false));
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      where.push(or(sql`lower(${t.users.displayName}) like ${like}`, sql`lower(coalesce(${t.users.username}, '')) like ${like}`)!);
    }
    const users = await db.select().from(t.users).where(where.length ? and(...where) : undefined).orderBy(desc(t.users.createdAt)).limit(300);
    if (users.length === 0) return [];
    const parts = await db
      .select({ userId: t.participants.userId })
      .from(t.participants)
      .where(and(inArray(t.participants.userId, users.map((u) => u.id)), isNotNull(t.participants.teamName)));
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      isGuest: u.isGuest,
      banned: u.banned,
      games: parts.filter((p) => p.userId === u.id).length,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async userGames(actorIn: AuthUser | null, userId: number): Promise<AdminGameView[]> {
    requireAdmin(actorIn);
    const { db, t } = this.database;
    const ids = (await db.select({ gameId: t.participants.gameId }).from(t.participants).where(eq(t.participants.userId, userId))).map((r) => r.gameId);
    const all = await this.listGames(actorIn, 'all');
    return all.filter((g) => ids.includes(g.id));
  }

  async setBanned(actorIn: AuthUser | null, userId: number, banned: boolean): Promise<void> {
    const actor = requireAdmin(actorIn);
    if (actor.id === userId) throw badRequest('self_ban', 'You cannot ban yourself');
    const { db, t } = this.database;
    const [row] = await db.update(t.users).set({ banned }).where(eq(t.users.id, userId)).returning();
    if (!row) throw notFound('User not found');
    // A ban signs the user out everywhere.
    if (banned) await db.delete(t.sessions).where(eq(t.sessions.userId, userId));
    await this.audit(actor, banned ? 'user.ban' : 'user.unban', `user:${userId}`, { name: row.displayName });
  }

  /** Deletes a user and their personal data: sessions, chat messages and the account itself. Finished games keep their teams. */
  async deleteUser(actorIn: AuthUser | null, userId: number): Promise<void> {
    const actor = requireAdmin(actorIn);
    if (actor.id === userId) throw badRequest('self_delete', 'You cannot delete your own account');
    const { db, t } = this.database;
    const [user] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
    if (!user) throw notFound('User not found');
    await db.delete(t.chatMessages).where(eq(t.chatMessages.userId, userId));
    await db.delete(t.users).where(eq(t.users.id, userId));
    await this.audit(actor, 'user.delete', `user:${userId}`, { name: user.displayName });
  }

  // ---------- Audit log ----------

  async auditLog(actorIn: AuthUser | null, q: z.infer<typeof adminAuditQuerySchema>): Promise<AuditEntryView[]> {
    requireAdmin(actorIn);
    return (await this.auditRows(q)).map(toAuditView);
  }

  auditCsv(rows: readonly AuditEntryView[]): string {
    return toCsv(
      ['id', 'created_at', 'actor', 'action', 'target', 'game', 'details'],
      rows.map((r) => [r.id, r.createdAt, r.actor, r.action, r.target ?? '', r.gameCode ?? '', r.details ? JSON.stringify(r.details) : '']),
    );
  }

  private async auditRows(q: Partial<z.infer<typeof adminAuditQuerySchema>>) {
    const { db, t } = this.database;
    const where: SQL[] = [];
    if (q.actor) where.push(sql`lower(${t.auditLog.actor}) like ${`%${q.actor.toLowerCase()}%`}`);
    if (q.action) where.push(sql`lower(${t.auditLog.action}) like ${`%${q.action.toLowerCase()}%`}`);
    if (q.game) where.push(eq(t.games.joinCode, q.game.toUpperCase()));
    if (q.from) where.push(gte(t.auditLog.createdAt, q.from));
    if (q.to) where.push(lte(t.auditLog.createdAt, q.to));
    return db
      .select({ a: t.auditLog, code: t.games.joinCode })
      .from(t.auditLog)
      .leftJoin(t.games, eq(t.auditLog.gameId, t.games.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(t.auditLog.id))
      .limit(q.limit ?? 200);
  }

  // ---------- Announcements ----------

  async announce(actorIn: AuthUser | null, text: string): Promise<void> {
    const actor = requireAdmin(actorIn);
    await setSetting(this.database, 'site.banner', text);
    await this.audit(actor, text ? 'announcement.set' : 'announcement.clear', null, text ? { text } : null);
  }

  // ---------- Helpers ----------

  private async player(id: number): Promise<PlayerRow> {
    const { db, t } = this.database;
    const [p] = await db.select().from(t.players).where(eq(t.players.id, id)).limit(1);
    if (!p) throw notFound('Player not found');
    return p;
  }

  private async club(id: number): Promise<ClubRow> {
    const { db, t } = this.database;
    const [c] = await db.select().from(t.clubs).where(eq(t.clubs.id, id)).limit(1);
    if (!c) throw notFound('Club not found');
    return c;
  }
}

function toPlayerView(p: PlayerRow, clubName: string): AdminPlayerView {
  return {
    id: p.id,
    clubId: p.clubId,
    clubName,
    fullName: p.fullName,
    displayName: p.displayName,
    primaryPosition: p.primaryPosition,
    altPositions: p.altPositions,
    overall: p.overall,
    nationality: p.nationality,
    isActive: p.isActive,
    isInjured: p.isInjured,
    sourceNote: p.sourceNote,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toAuditView({ a, code }: { a: Database['t']['auditLog']['$inferSelect']; code: string | null }): AuditEntryView {
  return { id: a.id, actor: a.actor, action: a.action, target: a.target, gameId: a.gameId, gameCode: code, details: a.details, createdAt: a.createdAt.toISOString() };
}

function diff<T extends object>(before: T, after: T): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[String(k)] = [before[k], after[k]];
  }
  return out;
}

function uniqueOr(err: unknown, message: string): unknown {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const { code, message: m } = e as { code?: unknown; message?: unknown };
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505' || (typeof m === 'string' && /UNIQUE constraint failed|duplicate key value/i.test(m))) {
      return conflict('duplicate', message);
    }
  }
  return err;
}

/** Reads a JSON ({ players: [...] } or [...]) or CSV import into rows. */
export function parseImport(format: 'json' | 'csv', content: string): ImportRow[] {
  let records: Record<string, unknown>[];
  if (format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(content) as unknown;
    } catch (err) {
      throw badRequest('bad_json', `That is not valid JSON (${(err as Error).message})`);
    }
    const list = Array.isArray(data) ? data : (data as { players?: unknown } | null)?.players;
    if (!Array.isArray(list)) throw badRequest('bad_json', 'Expected an array of players or { "players": [...] }');
    records = list.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  } else {
    try {
      records = parseCsv(content, { bom: true, columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true });
    } catch (err) {
      throw badRequest('bad_csv', `That is not valid CSV (${(err as Error).message})`);
    }
  }
  if (records.length === 0) throw badRequest('empty', 'The file has no players');
  if (records.length > 5000) throw badRequest('too_many', 'Import at most 5,000 players at a time');
  return records.map((r, i) => {
    const alt = r.alt_positions;
    const altPositions = Array.isArray(alt) ? alt.map(str) : str(alt).split(/[|;/ ]+/).filter(Boolean);
    const idNum = Number(r.id);
    return {
      row: i + (format === 'csv' ? 2 : 1),
      id: Number.isInteger(idNum) && idNum > 0 ? idNum : null,
      club: str(r.club),
      fullName: str(r.name ?? r.full_name),
      displayName: str(r.display_name) || null,
      primaryPosition: str(r.primary_position ?? r.position).toUpperCase(),
      altPositions: altPositions.map((p) => p.toUpperCase()),
      overall: Number(r.overall),
      nationality: str(r.nationality),
      isActive: bool(r.active ?? r.is_active),
      isInjured: bool(r.injured ?? r.is_injured),
      sourceNote: str(r.source_note) || null,
    };
  });
}
