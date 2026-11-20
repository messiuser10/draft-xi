import type { AppDb, Tables } from './db/database';

export interface AuditActor {
  id: number | null;
  name: string;
}

export const SYSTEM_ACTOR: AuditActor = { id: null, name: 'system' };

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  target?: string | null;
  gameId?: number | null;
  details?: Record<string, unknown> | null;
}

/** Appends to the audit log. Pass the transaction `db` when inside one. */
export async function writeAudit(db: AppDb, t: Tables, entry: AuditEntry): Promise<void> {
  await db.insert(t.auditLog).values({
    actorUserId: entry.actor.id,
    actor: entry.actor.name,
    action: entry.action,
    target: entry.target ?? null,
    gameId: entry.gameId ?? null,
    details: entry.details ?? null,
  });
}
