import { pathToFileURL } from 'node:url';

import bcrypt from 'bcrypt';

import { createPool } from './client.js';
import { loadConfig } from '../lib/config.js';

const BCRYPT_COST = 12;
const BCRYPT_COST_TEST = 10;

const DRIVER = { email: 'jashim@example.com', name: 'Jashim' };
const VEHICLE = { name: 'Bullet', registrationNo: 'DHAKA-METRO-TE-1001', capacity: 3 };
const PASSENGERS = [
  { email: 'nusrat@example.com', name: 'Nusrat' },
  { email: 'rafiq@example.com', name: 'Rafiq' },
  { email: 'shirin@example.com', name: 'Shirin' },
];

/**
 * Inserts the demo driver, vehicle and passengers. Safe to run repeatedly.
 * @param {import('pg').Pool} pool
 * @param {{ password: string, cost?: number }} options
 * @returns {Promise<void>}
 */
export async function runSeed(pool, { password, cost = BCRYPT_COST }) {
  const passwordHash = await bcrypt.hash(password, cost);

  const insertUser = `INSERT INTO users (email, password_hash, role, name)
    VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`;
  await pool.query(insertUser, [DRIVER.email, passwordHash, 'DRIVER', DRIVER.name]);
  for (const passenger of PASSENGERS) {
    await pool.query(insertUser, [passenger.email, passwordHash, 'PASSENGER', passenger.name]);
  }

  await pool.query(
    `INSERT INTO vehicles (driver_id, name, registration_no, capacity, online)
     SELECT id, $2, $3, $4, false FROM users WHERE email = $1
     ON CONFLICT (registration_no) DO NOTHING`,
    [DRIVER.email, VEHICLE.name, VEHICLE.registrationNo, VEHICLE.capacity],
  );
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    const cost = config.NODE_ENV === 'test' ? BCRYPT_COST_TEST : BCRYPT_COST;
    await runSeed(pool, { password: config.SEED_PASSWORD, cost });
    process.stdout.write(`${JSON.stringify({ event: 'seeded' })}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: 'seed_failed', message: error.message })}\n`);
    process.exit(1);
  });
}
