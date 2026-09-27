import { createApp } from '../../src/app.js';
import { createPool } from '../../src/db/client.js';

/**
 * Builds the app against the real test database.
 * @returns {{ app: import('express').Express, pool: import('pg').Pool }}
 */
export function buildTestApp() {
  const pool = createPool(process.env.TEST_DATABASE_URL);
  return { app: createApp({ pool }), pool };
}
