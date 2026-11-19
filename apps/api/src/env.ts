import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: booleanFromString,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  TRUST_PROXY: booleanFromString,
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
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
