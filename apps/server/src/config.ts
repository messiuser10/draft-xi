import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from './paths';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:var/draft-xi.db'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  /** A user registering with this username becomes an admin. */
  ADMIN_USERNAME: z.string().trim().toLowerCase().optional(),
  /** Send cookies with the Secure flag. Defaults to true in production. */
  COOKIE_SECURE: booleanish.optional(),
  /** Seconds between the host pressing Start and the draft starting. */
  START_COUNTDOWN_SECONDS: z.coerce.number().min(0).max(60).default(5),
  /** Milliseconds a bot waits before picking. */
  BOT_PICK_DELAY_MS: z.coerce.number().int().min(0).max(30_000).default(1500),
  /** Seconds a human may be disconnected during a draft before the host's policy applies. */
  DISCONNECT_GRACE_SECONDS: z.coerce.number().min(0).max(3600).default(60),
  /** Directory of the built web app to serve (production). */
  WEB_DIST: z.string().optional(),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

let envFileLoaded = false;

/** Loads `.env` from the repo root once, if it exists. Real environment variables win. */
function loadEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const file = path.join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) loadEnvFile();
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const { COOKIE_SECURE, ...rest } = parsed.data;
  return { ...rest, COOKIE_SECURE: COOKIE_SECURE ?? rest.NODE_ENV === 'production' };
}
