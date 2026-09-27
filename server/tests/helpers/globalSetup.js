import { createPool } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export async function setup() {
  const pool = createPool(process.env.TEST_DATABASE_URL);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
