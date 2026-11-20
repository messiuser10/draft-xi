/**
 * Accounts, guest sessions and roles.
 *
 * Passwords are hashed with bcrypt. A session is a random 32-byte token sent as an httpOnly
 * cookie; the database stores only its SHA-256 hash, so a leaked database cannot be replayed.
 */
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { count, eq, lt } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit, type AuditActor } from '../audit';
import type { guestSchema, loginSchema, MeView, registerSchema } from '../contracts';
import type { Database } from '../db/database';
import type { UserRole } from '../db/schema/enums';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../errors';
import { getSetting } from '../settings/app-settings';

export const SESSION_COOKIE = 'dxl_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_BCRYPT_COST = 12;

export interface AuthUser {
  id: number;
  username: string | null;
  displayName: string;
  role: UserRole;
  isGuest: boolean;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export interface AuthOptions {
  adminUsername?: string | undefined;
  bcryptCost?: number;
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function toMeView(user: AuthUser): MeView {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, isGuest: user.isGuest };
}

export function actorOf(user: AuthUser): AuditActor {
  return { id: user.id, name: user.username ?? `guest:${user.displayName}` };
}

type UserRow = Database['t']['users']['$inferSelect'];

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, displayName: row.displayName, role: row.role, isGuest: row.isGuest };
}

export class AuthService {
  private readonly cost: number;
  private readonly adminUsername: string | undefined;
  /** Compared against when a username does not exist, so timing does not reveal which usernames exist. */
  private dummyHash: string | undefined;

  constructor(
    private readonly database: Database,
    options: AuthOptions = {},
  ) {
    this.cost = options.bcryptCost ?? DEFAULT_BCRYPT_COST;
    this.adminUsername = options.adminUsername?.trim().toLowerCase() || undefined;
  }

  async register(input: z.infer<typeof registerSchema>): Promise<AuthResult> {
    const { db, t } = this.database;
    const username = input.username.toLowerCase();
    const isAdmin = this.adminUsername !== undefined && username === this.adminUsername;
    if (!isAdmin && !(await getSetting(this.database, 'registrations.open'))) {
      throw forbidden('New registrations are closed. You can still play as a guest.');
    }
    const [taken] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.username, username)).limit(1);
    if (taken) throw conflict('username_taken', 'That username is taken');

    const passwordHash = await bcrypt.hash(input.password, this.cost);
    let row: UserRow | undefined;
    try {
      [row] = await db
        .insert(t.users)
        .values({
          username,
          passwordHash,
          displayName: input.displayName ?? input.username,
          role: isAdmin ? 'admin' : 'user',
        })
        .returning();
    } catch (err) {
      // Lost a race with another registration of the same name.
      if (isUniqueViolation(err)) throw conflict('username_taken', 'That username is taken');
      throw err;
    }
    if (!row) throw new Error('Insert returned no user');
    const user = toAuthUser(row);
    await writeAudit(db, t, { actor: actorOf(user), action: 'user.register', target: `user:${user.id}`, details: { role: user.role } });
    return { user, token: await this.createSession(user.id) };
  }

  async login(input: z.infer<typeof loginSchema>): Promise<AuthResult> {
    const { db, t } = this.database;
    const [row] = await db
      .select()
      .from(t.users)
      .where(eq(t.users.username, input.username.toLowerCase()))
      .limit(1);
    if (!row?.passwordHash) {
      this.dummyHash ??= await bcrypt.hash('not-a-real-password', this.cost);
      await bcrypt.compare(input.password, this.dummyHash);
      throw new AppError(401, 'bad_credentials', 'Wrong username or password');
    }
    if (!(await bcrypt.compare(input.password, row.passwordHash))) {
      throw new AppError(401, 'bad_credentials', 'Wrong username or password');
    }
    if (row.banned) throw forbidden('This account has been banned');
    return { user: toAuthUser(row), token: await this.createSession(row.id) };
  }

  async guest(input: z.infer<typeof guestSchema>): Promise<AuthResult> {
    const { db, t } = this.database;
    const [row] = await db.insert(t.users).values({ displayName: input.displayName, isGuest: true }).returning();
    if (!row) throw new Error('Insert returned no user');
    return { user: toAuthUser(row), token: await this.createSession(row.id) };
  }

  /** The signed-in user for a cookie token, or null if missing, expired or banned. */
  async resolve(token: string | undefined): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    const { db, t } = this.database;
    const [found] = await db
      .select({ session: t.sessions, user: t.users })
      .from(t.sessions)
      .innerJoin(t.users, eq(t.sessions.userId, t.users.id))
      .where(eq(t.sessions.id, hashToken(token)))
      .limit(1);
    if (!found) return null;
    if (found.session.expiresAt.getTime() <= Date.now()) {
      await db.delete(t.sessions).where(eq(t.sessions.id, found.session.id));
      return null;
    }
    if (found.user.banned) return null;
    return toAuthUser(found.user);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const { db, t } = this.database;
    await db.delete(t.sessions).where(eq(t.sessions.id, hashToken(token)));
  }

  /** Admins promote or demote other users. An admin cannot demote themself, so one admin always remains. */
  async setRole(actor: AuthUser, userId: number, role: UserRole): Promise<AuthUser> {
    requireAdmin(actor);
    if (actor.id === userId && role !== 'admin') throw badRequest('self_demote', 'You cannot remove your own admin role');
    const { db, t } = this.database;
    const [target] = await db.select().from(t.users).where(eq(t.users.id, userId)).limit(1);
    if (!target) throw notFound('User not found');
    if (target.isGuest && role === 'admin') throw badRequest('guest_admin', 'Guests cannot be admins');
    const [row] = await db.update(t.users).set({ role }).where(eq(t.users.id, userId)).returning();
    if (!row) throw notFound('User not found');
    await writeAudit(db, t, { actor: actorOf(actor), action: 'user.role', target: `user:${userId}`, details: { role } });
    return toAuthUser(row);
  }

  async listUsers(actor: AuthUser, limit = 100): Promise<AuthUser[]> {
    requireAdmin(actor);
    const { db, t } = this.database;
    const rows = await db.select().from(t.users).where(eq(t.users.isGuest, false)).orderBy(t.users.id).limit(limit);
    return rows.map(toAuthUser);
  }

  async countSessions(userId: number): Promise<number> {
    const { db, t } = this.database;
    const [row] = await db.select({ n: count() }).from(t.sessions).where(eq(t.sessions.userId, userId));
    return row?.n ?? 0;
  }

  async deleteExpiredSessions(): Promise<void> {
    const { db, t } = this.database;
    await db.delete(t.sessions).where(lt(t.sessions.expiresAt, new Date()));
  }

  private async createSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const { db, t } = this.database;
    await db.insert(t.sessions).values({ id: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    return token;
  }
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw unauthorized();
  return user;
}

export function requireAdmin(user: AuthUser | null): AuthUser {
  const u = requireUser(user);
  if (u.role !== 'admin') throw forbidden('Admins only');
  return u;
}

/** SQLite and Postgres report unique-constraint failures differently. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505') return true;
    if (typeof message === 'string' && /UNIQUE constraint failed|duplicate key value/i.test(message)) return true;
  }
  return false;
}
