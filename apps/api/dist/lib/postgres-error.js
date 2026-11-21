/**
 * Drizzle wraps driver errors in DrizzleQueryError, so the PostgreSQL code lives
 * on the cause chain rather than the thrown object itself.
 */
export function findPostgresError(error) {
    let current = error;
    for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
        const candidate = current;
        if (typeof candidate.code === 'string' && candidate.code.length === 5)
            return candidate;
        current = candidate.cause;
    }
    return undefined;
}
//# sourceMappingURL=postgres-error.js.map