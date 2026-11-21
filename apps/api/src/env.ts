import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

// Compose files commonly pass optional variables as empty strings.
const optionalString = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: booleanFromString,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  SESSION_CLEANUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(24 * 7).default(24),
  TRUST_PROXY: booleanFromString,
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NOTIFICATION_MODE: z.enum(['log', 'webhook']).default('log'),
  NOTIFICATION_WEBHOOK_URL: optionalString(z.string().url()),
  NOTIFICATION_WEBHOOK_TOKEN: optionalString(z.string().min(1)),
  NOTIFICATION_POLL_MS: z.coerce.number().int().min(1000).max(300_000).default(15_000),
  NOTIFICATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  SEED_ADMIN_EMAIL: optionalString(z.string().email()),
  SEED_ADMIN_PASSWORD: optionalString(z.string().min(12)),
  SEED_ADMIN_FIRST_NAME: z.string().min(1).default('System'),
  SEED_ADMIN_LAST_NAME: z.string().min(1).default('Administrator'),
}).superRefine((config, ctx) => {
  if (config.COOKIE_SAME_SITE === 'none' && !config.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'COOKIE_SECURE must be true when COOKIE_SAME_SITE is none.',
    });
  }
  if (config.NODE_ENV === 'production') {
    if (!config.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production.',
      });
    }
    if (!config.FRONTEND_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: 'FRONTEND_URL must use HTTPS in production.',
      });
    }
  }
  if (config.NOTIFICATION_MODE === 'webhook' && !config.NOTIFICATION_WEBHOOK_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['NOTIFICATION_WEBHOOK_URL'],
      message: 'Set NOTIFICATION_WEBHOOK_URL when NOTIFICATION_MODE is webhook.',
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export const env = parseEnv(process.env);
