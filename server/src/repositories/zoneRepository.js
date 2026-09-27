/**
 * Zones and cross-corridor distances are immutable reference data, loaded once at startup by
 * services/zoneService.js. Nothing else queries these tables directly.
 */

/**
 * @param {import('pg').Pool | import('pg').PoolClient} tx
 * @returns {Promise<{ id: number, name: string, corridor: string, position: number }[]>}
 */
export async function listZones(tx) {
  const { rows } = await tx.query('SELECT id, name, corridor, position FROM zones ORDER BY id');
  return rows;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} tx
 * @returns {Promise<{ from_zone_id: number, to_zone_id: number, distance_units: number }[]>}
 */
export async function listZoneDistances(tx) {
  const { rows } = await tx.query(
    'SELECT from_zone_id, to_zone_id, distance_units FROM zone_distances',
  );
  return rows;
}
