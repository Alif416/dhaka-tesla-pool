/**
 * Pure geography rules: distance, direction and poolability between two zones.
 * Zones and cross-corridor distances are passed in as data; nothing here reads the database.
 */

/** Domain failure code: no cross-corridor distance is on record for this pair. */
export const NO_DISTANCE = 'NO_DISTANCE';
/** Domain failure code: pickup and destination are the same zone. */
export const PICKUP_EQUALS_DESTINATION = 'PICKUP_EQUALS_DESTINATION';

function crossDistanceKey(zoneIdA, zoneIdB) {
  return `${Math.min(zoneIdA, zoneIdB)}:${Math.max(zoneIdA, zoneIdB)}`;
}

/**
 * Builds the lookup key `distanceUnits` uses for a cross-corridor pair, in `least, greatest`
 * order so callers can build the map once from the 15 seeded rows.
 * @param {number} zoneIdA
 * @param {number} zoneIdB
 * @returns {string}
 */
export function makeCrossDistanceKey(zoneIdA, zoneIdB) {
  return crossDistanceKey(zoneIdA, zoneIdB);
}

/**
 * Distance in corridor units between two zones.
 * @param {{ id: number, corridor: string, position: number }} pickup
 * @param {{ id: number, corridor: string, position: number }} destination
 * @param {Map<string, number>} crossDistances Keyed by `makeCrossDistanceKey(fromId, toId)`.
 * @returns {{ ok: true, distanceUnits: number } | { ok: false, code: string }}
 */
export function distanceUnits(pickup, destination, crossDistances) {
  if (pickup.id === destination.id) {
    return { ok: false, code: PICKUP_EQUALS_DESTINATION };
  }
  if (pickup.corridor === destination.corridor) {
    return { ok: true, distanceUnits: Math.abs(destination.position - pickup.position) };
  }
  const units = crossDistances.get(crossDistanceKey(pickup.id, destination.id));
  if (units === undefined) {
    return { ok: false, code: NO_DISTANCE };
  }
  return { ok: true, distanceUnits: units };
}

/**
 * A route can be pooled only when pickup and destination share a corridor.
 * @param {{ corridor: string }} pickup
 * @param {{ corridor: string }} destination
 * @returns {boolean}
 */
export function isPoolable(pickup, destination) {
  return pickup.corridor === destination.corridor;
}

/**
 * Direction of travel along a corridor: -1, 0 or 1.
 * @param {{ position: number }} pickup
 * @param {{ position: number }} destination
 * @returns {number}
 */
export function direction(pickup, destination) {
  return Math.sign(destination.position - pickup.position);
}
