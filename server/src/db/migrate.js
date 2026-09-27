import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createPool } from './client.js';
import { loadConfig } from '../lib/config.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_LOCK_KEY = 727001;

/**
 * Applies unapplied `NNN_name.sql` files in filename order, each in its own transaction,
 * under a session-level advisory lock so concurrent runners cannot interleave.
 * @param {import('pg').Pool} pool
 * @param {string} [directory]
 * @returns {Promise<string[]>} Filenames applied by this run.
 */
export async function runMigrations(pool, directory = MIGRATIONS_DIR) {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const applied = [];
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const done = new Set(rows.map((row) => row.filename));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(directory, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    const applied = await runMigrations(pool);
    process.stdout.write(`${JSON.stringify({ event: 'migrated', applied })}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: 'migrate_failed', message: error.message })}\n`,
    );
    process.exit(1);
  });
}
