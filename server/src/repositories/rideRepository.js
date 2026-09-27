/**
 * All SQL for ride_requests. Every function that returns user-visible data requires the
 * passenger id as a parameter and scopes the query by it, so an unscoped fetch cannot be
 * written against this file.
 */

const RIDE_COLUMNS = `
  id, passenger_id, pickup_zone_id, destination_zone_id, seats, distance_units,
  solo_fare_paisa, quoted_fare_paisa, status, cancel_reason, created_at, updated_at
`;

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {{ pickupZoneId: number, destinationZoneId: number, seats: number,
 *   distanceUnits: number, soloFarePaisa: number, quotedFarePaisa: number }} ride
 * @returns {Promise<object>} The inserted row.
 */
export async function insertRideForPassenger(tx, passengerId, ride) {
  const { rows } = await tx.query(
    `INSERT INTO ride_requests (
       passenger_id, pickup_zone_id, destination_zone_id, seats, distance_units,
       solo_fare_paisa, quoted_fare_paisa
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${RIDE_COLUMNS}`,
    [
      passengerId,
      ride.pickupZoneId,
      ride.destinationZoneId,
      ride.seats,
      ride.distanceUnits,
      ride.soloFarePaisa,
      ride.quotedFarePaisa,
    ],
  );
  return rows[0];
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {string} rideId
 * @returns {Promise<object | null>}
 */
export async function findRideForPassenger(tx, passengerId, rideId) {
  const { rows } = await tx.query(
    `SELECT ${RIDE_COLUMNS} FROM ride_requests WHERE id = $1 AND passenger_id = $2`,
    [rideId, passengerId],
  );
  return rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @returns {Promise<object | null>} The passenger's one active ride, if any.
 */
export async function findActiveRideForPassenger(tx, passengerId) {
  const { rows } = await tx.query(
    `SELECT ${RIDE_COLUMNS} FROM ride_requests
     WHERE passenger_id = $1
       AND status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED')`,
    [passengerId],
  );
  return rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @returns {Promise<object[]>} Current and past rides, newest first.
 */
export async function listRidesForPassenger(tx, passengerId) {
  const { rows } = await tx.query(
    `SELECT ${RIDE_COLUMNS} FROM ride_requests WHERE passenger_id = $1 ORDER BY created_at DESC`,
    [passengerId],
  );
  return rows;
}

/**
 * Locks the ride row for update. Returns null (no lock held) when it does not belong to this
 * passenger.
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {string} rideId
 * @returns {Promise<object | null>}
 */
export async function lockRideForPassenger(tx, passengerId, rideId) {
  const { rows } = await tx.query(
    `SELECT ${RIDE_COLUMNS} FROM ride_requests WHERE id = $1 AND passenger_id = $2 FOR UPDATE`,
    [rideId, passengerId],
  );
  return rows[0] ?? null;
}

/**
 * Cancels a ride with reason PASSENGER_CANCELLED. Caller must already hold the row lock and
 * have checked that the transition is legal.
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {string} rideId
 * @returns {Promise<object | null>}
 */
export async function markRideCancelledForPassenger(tx, passengerId, rideId) {
  const { rows } = await tx.query(
    `UPDATE ride_requests
     SET status = 'CANCELLED', cancel_reason = 'PASSENGER_CANCELLED', updated_at = now()
     WHERE id = $1 AND passenger_id = $2
     RETURNING ${RIDE_COLUMNS}`,
    [rideId, passengerId],
  );
  return rows[0] ?? null;
}

/**
 * Advisory list of open requests a driver could accept or add right now. Scoped by requiring
 * the driver's own vehicle to exist (the join below), so it cannot be called without a driver
 * context; `maxSeats` is supplied by the caller (full capacity with no pool, or the pool's
 * remaining seats with one) since only the caller knows which case applies. Never reserves
 * anything — accept re-checks everything under lock.
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @param {{ pickupZoneId?: number | null, maxSeats: number }} filter
 * @returns {Promise<object[]>} REQUESTED rides, oldest first, limited to 50.
 */
export async function listOpenRequestsForDriver(tx, driverId, { pickupZoneId = null, maxSeats }) {
  const { rows } = await tx.query(
    `SELECT r.id, r.passenger_id, r.pickup_zone_id, r.destination_zone_id, r.seats,
            r.quoted_fare_paisa, r.created_at, u.name AS passenger_name
     FROM ride_requests r
     JOIN users u ON u.id = r.passenger_id
     JOIN vehicles v ON v.driver_id = $1
     WHERE r.status = 'REQUESTED'
       AND r.seats <= $2
       AND ($3::smallint IS NULL OR r.pickup_zone_id = $3)
     ORDER BY r.created_at
     LIMIT 50`,
    [driverId, maxSeats, pickupZoneId],
  );
  return rows;
}

/**
 * Locks a set of ride requests together, in ascending id order — the fixed lock order for any
 * command that touches more than one `ride_requests` row (design.md section 7; `code-standards.md`
 * section 9). Internal helper: used only after ownership of the surrounding pool/vehicle is
 * already established (by `poolService.acceptRide`), never called directly from a route.
 * @param {import('pg').PoolClient} tx
 * @param {string[]} ids
 * @returns {Promise<object[]>} The locked rows, in ascending id order. Missing ids are simply
 *   absent from the result — the caller checks for that.
 */
export async function lockRequestsByIds(tx, ids) {
  if (ids.length === 0) {
    return [];
  }
  const { rows } = await tx.query(
    `SELECT ${RIDE_COLUMNS} FROM ride_requests WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return rows;
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} rideId
 * @returns {Promise<object>} The updated row.
 */
export async function markMatched(tx, rideId) {
  const { rows } = await tx.query(
    `UPDATE ride_requests SET status = 'MATCHED', updated_at = now()
     WHERE id = $1
     RETURNING ${RIDE_COLUMNS}`,
    [rideId],
  );
  return rows[0];
}

/**
 * Writes a recomputed quote. Callers must already have applied the `min(quoted, computed)` rule
 * (`domain/fare.js` `nextQuote`) before calling this; it does not enforce that itself.
 * @param {import('pg').PoolClient} tx
 * @param {string} rideId
 * @param {number} quotedFarePaisa
 * @returns {Promise<void>}
 */
export async function updateQuote(tx, rideId, quotedFarePaisa) {
  await tx.query(
    `UPDATE ride_requests SET quoted_fare_paisa = $2, updated_at = now() WHERE id = $1`,
    [rideId, quotedFarePaisa],
  );
}

/**
 * Cancels a ride with a driver-chosen reason (no-show). Unlike
 * `markRideCancelledForPassenger`, this is not passenger-scoped: the caller (poolService) has
 * already established ownership by locking the driver's pool and this ride within it.
 * @param {import('pg').PoolClient} tx
 * @param {string} rideId
 * @param {string} cancelReason One of `CANCEL_REASONS`.
 * @returns {Promise<object>} The updated row.
 */
export async function markRideCancelledByDriver(tx, rideId, cancelReason) {
  const { rows } = await tx.query(
    `UPDATE ride_requests
     SET status = 'CANCELLED', cancel_reason = $2, updated_at = now()
     WHERE id = $1
     RETURNING ${RIDE_COLUMNS}`,
    [rideId, cancelReason],
  );
  return rows[0];
}

/**
 * Completes a single ride. Used by the driver-complete, passenger self-complete and End Trip
 * paths alike; which one is recorded by the caller's `ride_events` entry and the membership's
 * `left_reason`, not by this function.
 * @param {import('pg').PoolClient} tx
 * @param {string} rideId
 * @returns {Promise<object>} The updated row.
 */
export async function markRideCompleted(tx, rideId) {
  const { rows } = await tx.query(
    `UPDATE ride_requests SET status = 'COMPLETED', updated_at = now()
     WHERE id = $1
     RETURNING ${RIDE_COLUMNS}`,
    [rideId],
  );
  return rows[0];
}
