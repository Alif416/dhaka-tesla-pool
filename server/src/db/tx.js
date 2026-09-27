import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';

const DEADLOCK_SQLSTATE = '40P01';
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_SECONDS = 1;

/**
 * Builds a `withTx(fn)` bound to one pool. Opens a transaction at READ COMMITTED (PostgreSQL's
 * default, set explicitly here for clarity), runs `fn(tx)`, commits, and rolls back on error.
 * Retries the whole function only on SQLSTATE 40P01 (deadlock), at most 3 attempts, then throws
 * AppError 503 BUSY with a Retry-After. No other database error is retried.
 * @param {import('pg').Pool} pool
 * @returns {(fn: (tx: import('pg').PoolClient) => Promise<unknown>) => Promise<unknown>}
 */
export function createWithTx(pool) {
  return async function withTx(fn) {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === DEADLOCK_SQLSTATE && attempt < MAX_ATTEMPTS) {
          continue;
        }
        if (error.code === DEADLOCK_SQLSTATE) {
          throw new AppError(ERROR_CODES.BUSY, 503, 'Busy, please try again.', {
            retryAfter: RETRY_AFTER_SECONDS,
          });
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
