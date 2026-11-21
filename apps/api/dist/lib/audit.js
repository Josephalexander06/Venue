import { auditLogs } from '../db/schema.js';
export function writeAudit(executor, entry) {
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
//# sourceMappingURL=audit.js.map