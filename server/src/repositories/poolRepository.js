/**
 * All SQL for pools and pool membership, scoped to the acting driver via vehicles.driver_id.
 * Locking functions used by the accept/lifecycle commands (`lockPoolForDriver`, using
 * `FOR UPDATE OF pools`) are added in unit 07, where they are first used.
 */

const POOL_COLUMNS = `
  p.id, p.vehicle_id, p.status, p.created_at, p.updated_at,
  p.arrived_at, p.started_at, p.completed_at, p.cancelled_at
`;

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @returns {Promise<object | null>} The driver's one active pool (ACCEPTED, DRIVER_ARRIVED or
 *   STARTED), if any.
 */
export async function findActivePoolForDriver(tx, driverId) {
  const { rows } = await tx.query(
    `SELECT ${POOL_COLUMNS}
     FROM pools p
     JOIN vehicles v ON v.id = p.vehicle_id
     WHERE v.driver_id = $1
       AND p.status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')`,
    [driverId],
  );
  return rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @param {string} poolId
 * @returns {Promise<object | null>} No row means not found or not this driver's pool.
 */
export async function findPoolForDriver(tx, driverId, poolId) {
  const { rows } = await tx.query(
    `SELECT ${POOL_COLUMNS}
     FROM pools p
     JOIN vehicles v ON v.id = p.vehicle_id
     WHERE p.id = $1 AND v.driver_id = $2`,
    [poolId, driverId],
  );
  return rows[0] ?? null;
}

/**
 * Active members of a driver's pool, with the passenger's name and route, for the driver's own
 * pool view. `uncapped_fare_paisa`/`final_fare_paisa`/`payment_status` are null until the trip
 * starts (unit 08 creates the payment row).
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @param {string} poolId
 * @returns {Promise<object[]>} Ordered by join time.
 */
export async function listActiveMembersForDriverPool(tx, driverId, poolId) {
  const { rows } = await tx.query(
    `SELECT
       r.id AS ride_request_id, r.status AS ride_status, r.seats,
       r.pickup_zone_id, r.destination_zone_id, r.quoted_fare_paisa,
       u.name AS passenger_name,
       pay.uncapped_fare_paisa, pay.final_fare_paisa, pay.status AS payment_status
     FROM pool_members pm
     JOIN pools p ON p.id = pm.pool_id
     JOIN vehicles v ON v.id = p.vehicle_id
     JOIN ride_requests r ON r.id = pm.ride_request_id
     JOIN users u ON u.id = r.passenger_id
     LEFT JOIN payments pay ON pay.ride_request_id = r.id
     WHERE pm.pool_id = $1 AND v.driver_id = $2 AND pm.left_at IS NULL
     ORDER BY pm.joined_at`,
    [poolId, driverId],
  );
  return rows;
}

/**
 * Occupied seats for a pool, computed from its active members. There is no stored counter.
 * @param {import('pg').PoolClient} tx
 * @param {string} poolId
 * @returns {Promise<number>}
 */
export async function sumOccupiedSeats(tx, poolId) {
  const { rows } = await tx.query(
    `SELECT COALESCE(SUM(r.seats), 0)::int AS occupied
     FROM pool_members pm
     JOIN ride_requests r ON r.id = pm.ride_request_id
     WHERE pm.pool_id = $1 AND pm.left_at IS NULL`,
    [poolId],
  );
  return rows[0].occupied;
}
