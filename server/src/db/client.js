import pg from 'pg';

const MAX_CONNECTIONS = 10;

/**
 * Creates the shared connection pool.
 * @param {string} connectionString
 * @returns {pg.Pool}
 */
export function createPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: MAX_CONNECTIONS });
  // An idle client error must not crash the process; the next query reports the failure.
  pool.on('error', (error) => {
    process.stderr.write(`${JSON.stringify({ event: 'pool_error', message: error.message })}\n`);
  });
  return pool;
}

/**
 * Runs SELECT 1 to prove the database is reachable.
 * @param {pg.Pool} pool
 * @returns {Promise<boolean>}
 */
export async function checkConnection(pool) {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
