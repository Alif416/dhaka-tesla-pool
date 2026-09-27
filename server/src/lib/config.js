import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1).default('8h'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SEED_PASSWORD: z.string().min(1).default('password123'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/**
 * Parses and validates environment variables. Throws a ZodError on invalid config.
 * @param {Record<string, string | undefined>} env
 * @returns {{ DATABASE_URL: string, JWT_SECRET: string, JWT_EXPIRES_IN: string,
 *   COOKIE_SECURE: boolean, SEED_PASSWORD: string, PORT: number, LOG_LEVEL: string,
 *   NODE_ENV: string }}
 */
export function parseConfig(env) {
  return configSchema.parse(env);
}

/**
 * Loads config from process.env once at startup.
 * @returns {ReturnType<typeof parseConfig>}
 */
export function loadConfig() {
  return parseConfig(process.env);
}
