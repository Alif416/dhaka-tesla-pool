import { createApp } from '../../src/app.js';
import { createPool } from '../../src/db/client.js';
import { parseConfig } from '../../src/lib/config.js';

const TEST_JWT_SECRET = 'test-only-secret-not-for-production-use-0123456789';

/**
 * Builds the app against the real test database, with a deterministic test config.
 * @param {object} [overrides] Env-shaped overrides merged into the test config.
 * @returns {{ app: import('express').Express, pool: import('pg').Pool, config: object }}
 */
export function buildTestApp(overrides = {}) {
  const pool = createPool(overrides.DATABASE_URL ?? process.env.TEST_DATABASE_URL);
  const config = parseConfig({
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: TEST_JWT_SECRET,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  return { app: createApp({ pool, config }), pool, config };
}
