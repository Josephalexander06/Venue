import type { DbExecutor } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

interface AuditEntry {
  actorId: string | null;
  action: string;
  entityName: string;
  entityId: string;
  oldState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function writeAudit(executor: DbExecutor, entry: AuditEntry) {
  return executor.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entityName: entry.entityName,
    entityId: entry.entityId,
    oldState: entry.oldState ?? null,
    newState: entry.newState ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
