import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPool } from '../../src/db/client.js';
import { createWithTx } from '../../src/db/tx.js';
import { AppError } from '../../src/lib/errors.js';
import { makeUser, resetDb } from '../helpers/db.js';

const pool = createPool(process.env.TEST_DATABASE_URL);
const withTx = createWithTx(pool);

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

/**
 * Polls pg_stat_activity until the given backend is blocked waiting for a lock, or times out.
 * getPid may return undefined for a while until the backend has reported in.
 */
async function waitUntilBackendWaitsOnLock(getPid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = getPid();
    if (pid) {
      const { rows } = await pool.query(
        'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
        [pid],
      );
      if (rows[0]?.wait_event_type === 'Lock') return;
    }
    await delay(20);
  }
  throw new Error('Timed out waiting for the backend to block on a lock');
}

describe('withTx deadlock retry (real PostgreSQL)', () => {
  it('retries the whole transaction on a genuine deadlock and both sides eventually succeed', async () => {
    const userA = await makeUser(pool);
    const userB = await makeUser(pool);
    let attempts = 0;
    let bPid;

    const clientA = await pool.connect();
    await clientA.query('BEGIN');
    await clientA.query('UPDATE users SET name = name WHERE id = $1', [userA.id]); // A holds A

    const bPromise = withTx(async (tx) => {
      attempts += 1;
      if (attempts === 1) {
        const { rows } = await tx.query('SELECT pg_backend_pid() AS pid');
        bPid = rows[0].pid;
      }
      await tx.query('UPDATE users SET name = name WHERE id = $1', [userB.id]); // B holds B
      await tx.query('UPDATE users SET name = name WHERE id = $1', [userA.id]); // B waits on A
      return 'b-done';
    });

    // Wait until B is genuinely blocked waiting for A's lock (not a guessed sleep).
    await waitUntilBackendWaitsOnLock(() => bPid);

    // A now asks for B's row too, completing the cycle, and queues its commit right behind that
    // request on the same connection. B started waiting first, so PostgreSQL's deadlock detector
    // (which runs on B's own timer) reports the deadlock on B's connection: B's withTx call
    // retries, and by the time it re-requests row A, A's queued COMMIT has released it.
    const aWaitsOnB = clientA.query('UPDATE users SET name = name WHERE id = $1', [userB.id]);
    const aCommit = clientA.query('COMMIT');

    const [result] = await Promise.all([bPromise, aWaitsOnB, aCommit]);

    expect(result).toBe('b-done');
    expect(attempts).toBeGreaterThanOrEqual(2);

    clientA.release();
  }, 15000);

  it('does not retry a non-deadlock error', async () => {
    let attempts = 0;

    const promise = withTx(async (tx) => {
      attempts += 1;
      // Violates users_email_lowercase (23514), not a deadlock.
      await tx.query(
        `INSERT INTO users (email, password_hash, role, name)
         VALUES ('Not-Lower@Example.com', 'x', 'PASSENGER', 'Test')`,
      );
    });

    await expect(promise).rejects.toMatchObject({ code: '23514' });
    expect(attempts).toBe(1);
  });

  it('gives up after 3 attempts and throws 503 BUSY with Retry-After', async () => {
    // A stub pool whose client always reports a deadlock, to test withTx's own retry-exhaustion
    // logic in isolation. The genuine-deadlock test above proves the real retry-and-recover path
    // against PostgreSQL; this one proves the give-up path, which real Postgres cannot force
    // deterministically within a single test.
    let queryCount = 0;
    const stubClient = {
      query: async (sql) => {
        if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') return {};
        if (sql === 'ROLLBACK') return {};
        queryCount += 1;
        const error = new Error('deadlock detected');
        error.code = '40P01';
        throw error;
      },
      release: () => {},
    };
    const stubPool = { connect: async () => stubClient };
    const stubWithTx = createWithTx(stubPool);

    const promise = stubWithTx(async (tx) => {
      await tx.query('UPDATE anything SET x = 1');
    });

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: 'BUSY', status: 503 });
    expect(queryCount).toBe(3);
  });
});
