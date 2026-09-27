import { afterAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/db/client.js';

const pool = createPool(process.env.TEST_DATABASE_URL);

afterAll(() => pool.end());

describe('zone reference data', () => {
  it('seeds 8 zones and 15 cross-corridor distances', async () => {
    const zones = await pool.query('SELECT count(*)::int AS n FROM zones');
    const distances = await pool.query('SELECT count(*)::int AS n FROM zone_distances');

    expect(zones.rows[0].n).toBe(8);
    expect(distances.rows[0].n).toBe(15);
  });

  it('resolves every cross-corridor pair through least and greatest', async () => {
    const { rows } = await pool.query(
      `SELECT a.id AS a, b.id AS b, d.distance_units
       FROM zones a
       JOIN zones b ON a.id < b.id AND a.corridor <> b.corridor
       LEFT JOIN zone_distances d
         ON d.from_zone_id = least(a.id, b.id) AND d.to_zone_id = greatest(a.id, b.id)`,
    );

    expect(rows).toHaveLength(15);
    expect(rows.filter((row) => row.distance_units === null)).toEqual([]);
  });

  it('has no same-corridor pair in zone_distances', async () => {
    const { rows } = await pool.query(
      `SELECT d.from_zone_id, d.to_zone_id
       FROM zone_distances d
       JOIN zones a ON a.id = d.from_zone_id
       JOIN zones b ON b.id = d.to_zone_id
       WHERE a.corridor = b.corridor`,
    );

    expect(rows).toEqual([]);
  });
});
