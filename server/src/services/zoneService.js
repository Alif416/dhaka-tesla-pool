import { makeCrossDistanceKey } from '../domain/geography.js';
import { listZoneDistances, listZones } from '../repositories/zoneRepository.js';

/** Module-level cache: zones and distances are immutable reference data, loaded once. */
let cache = null;

/**
 * Loads the 8 zones and 15 cross-corridor distances into memory. Safe to call more than once;
 * later calls are a no-op once the cache is populated, so building a second app in the same
 * process does not reload it. Throws if the tables are empty (migrations not run).
 * @param {import('pg').Pool} pool
 * @returns {Promise<void>}
 */
export async function loadZones(pool) {
  if (cache) return;
  const zones = await listZones(pool);
  const distances = await listZoneDistances(pool);
  if (zones.length === 0) {
    throw new Error('No zones found. Run migrations (and the seed) before starting the app.');
  }
  cache = {
    zoneList: zones,
    zonesById: new Map(zones.map((zone) => [zone.id, zone])),
    crossDistances: new Map(
      distances.map((row) => [
        makeCrossDistanceKey(row.from_zone_id, row.to_zone_id),
        row.distance_units,
      ]),
    ),
  };
}

/** @returns {object[]} All zones, ascending by id. */
export function getZones() {
  return cache.zoneList;
}

/**
 * @param {number} id
 * @returns {{ id: number, name: string, corridor: string, position: number } | null}
 */
export function getZoneById(id) {
  return cache.zonesById.get(id) ?? null;
}

/** @returns {Map<string, number>} Cross-corridor distances keyed by makeCrossDistanceKey. */
export function getCrossDistances() {
  return cache.crossDistances;
}

/**
 * Builds the shape `domain/compatibility.js` expects (a candidate or a pool member) from plain
 * fields, looking up each zone by id. Shared by driverService's advisory list and poolService's
 * accept transaction, which read status, seats and zone ids from differently-shaped rows.
 * @param {{ status: string, seats: number, pickupZoneId: number, destinationZoneId: number }} input
 * @returns {{ status: string, seats: number, pickupZone: object | null,
 *   destinationZone: object | null }}
 */
export function toCandidateShape({ status, seats, pickupZoneId, destinationZoneId }) {
  return {
    status,
    seats,
    pickupZone: getZoneById(pickupZoneId),
    destinationZone: getZoneById(destinationZoneId),
  };
}
