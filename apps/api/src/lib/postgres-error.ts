export interface PostgresError {
  code?: string;
  constraint?: string;
  message?: string;
  detail?: string;
}

/**
 * Drizzle wraps driver errors in DrizzleQueryError, so the PostgreSQL code lives
 * on the cause chain rather than the thrown object itself.
 */
export function findPostgresError(error: unknown): PostgresError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as PostgresError & { cause?: unknown };
    if (typeof candidate.code === 'string' && candidate.code.length === 5) return candidate;
    current = candidate.cause;
  }
  return undefined;
}
