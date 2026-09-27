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
