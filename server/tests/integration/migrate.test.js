import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

const pool = createPool(process.env.TEST_DATABASE_URL);
let directory;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'migrations-'));
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS migrate_probe');
  await pool.query("DELETE FROM schema_migrations WHERE filename = '999_probe.sql'");
  await rm(directory, { recursive: true, force: true });
  await pool.end();
});

describe('runMigrations', () => {
  it('applies nothing and succeeds when there are no migration files', async () => {
    const applied = await runMigrations(pool, directory);

    expect(applied).toEqual([]);
  });

  it('applies a new file once and applies nothing on the second run', async () => {
    await writeFile(path.join(directory, '999_probe.sql'), 'CREATE TABLE migrate_probe (id INT);');

    const first = await runMigrations(pool, directory);
    const second = await runMigrations(pool, directory);

    expect(first).toEqual(['999_probe.sql']);
    expect(second).toEqual([]);
  });
});
