import bcrypt from 'bcrypt';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed.js';
import { resetDb } from '../helpers/db.js';

const pool = createPool(process.env.TEST_DATABASE_URL);
const options = { password: 'password123', cost: 4 };

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

describe('runSeed', () => {
  it('creates one driver with the Bullet vehicle and three passengers', async () => {
    await runSeed(pool, options);

    const { rows: users } = await pool.query('SELECT email, role FROM users ORDER BY email');
    const { rows: vehicles } = await pool.query(
      `SELECT v.name, v.registration_no, v.capacity, v.online, u.email
       FROM vehicles v JOIN users u ON u.id = v.driver_id`,
    );

    expect(users).toEqual([
      { email: 'jashim@example.com', role: 'DRIVER' },
      { email: 'nusrat@example.com', role: 'PASSENGER' },
      { email: 'rafiq@example.com', role: 'PASSENGER' },
      { email: 'shirin@example.com', role: 'PASSENGER' },
    ]);
    expect(vehicles).toEqual([
      {
        name: 'Bullet',
        registration_no: 'DHAKA-METRO-TE-1001',
        capacity: 3,
        online: false,
        email: 'jashim@example.com',
      },
    ]);
  });

  it('creates no duplicates when run twice', async () => {
    await runSeed(pool, options);
    await runSeed(pool, options);

    const users = await pool.query('SELECT count(*)::int AS n FROM users');
    const vehicles = await pool.query('SELECT count(*)::int AS n FROM vehicles');

    expect(users.rows[0].n).toBe(4);
    expect(vehicles.rows[0].n).toBe(1);
  });

  it('stores a bcrypt hash that verifies against the seed password', async () => {
    await runSeed(pool, options);

    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE email = 'nusrat@example.com'",
    );

    expect(rows[0].password_hash).not.toBe(options.password);
    expect(await bcrypt.compare(options.password, rows[0].password_hash)).toBe(true);
  });
});
