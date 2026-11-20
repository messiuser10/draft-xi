import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from './paths';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default('file:var/draft-xi.db'),
});

export type AppConfig = z.infer<typeof envSchema>;

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
  return parsed.data;
}
