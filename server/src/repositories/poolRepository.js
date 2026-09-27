/**
 * All SQL for pools and pool membership. Read functions scoped to the acting driver are above;
 * the accept/add-to-pool functions below take a vehicle or pool id directly because the caller
 * (poolService.acceptRide) has already locked that driver's vehicle, establishing ownership
 * before any of these run.
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

/**
 * Locks the vehicle's active pool, if any, for update. No join to `vehicles` is needed: the
 * caller already holds that row's lock and passes its id directly, so this only ever locks the
 * `pools` row itself.
 * @param {import('pg').PoolClient} tx
 * @param {string} vehicleId
 * @returns {Promise<object | null>}
 */
export async function lockActivePoolForVehicle(tx, vehicleId) {
  const { rows } = await tx.query(
    `SELECT id, vehicle_id, status, created_at, updated_at,
            arrived_at, started_at, completed_at, cancelled_at
     FROM pools
     WHERE vehicle_id = $1
       AND status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
     FOR UPDATE`,
    [vehicleId],
  );
  return rows[0] ?? null;
}

/**
 * Creates a new pool in ACCEPTED status for a vehicle that has none.
 * @param {import('pg').PoolClient} tx
 * @param {string} vehicleId
 * @returns {Promise<object>} The inserted row.
 */
export async function insertPool(tx, vehicleId) {
  const { rows } = await tx.query(
    `INSERT INTO pools (vehicle_id, status)
     VALUES ($1, 'ACCEPTED')
     RETURNING id, vehicle_id, status, created_at, updated_at,
               arrived_at, started_at, completed_at, cancelled_at`,
    [vehicleId],
  );
  return rows[0];
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} poolId
 * @param {string} rideId
 * @returns {Promise<object>} The inserted membership row.
 */
export async function insertPoolMember(tx, poolId, rideId) {
  const { rows } = await tx.query(
    `INSERT INTO pool_members (pool_id, ride_request_id) VALUES ($1, $2) RETURNING *`,
    [poolId, rideId],
  );
  return rows[0];
}

/**
 * Active members of a pool (ride id, status, seats, route, fare), used by the accept transaction
 * to build the compatibility check and recompute quotes. Not scoped by driver: the caller has
 * already established ownership by locking the vehicle and this pool.
 * @param {import('pg').PoolClient} tx
 * @param {string} poolId
 * @returns {Promise<object[]>} Ordered by ride id ascending, matching the lock order used to
 *   re-lock these same rows via `lockRequestsByIds`.
 */
export async function listActiveMembers(tx, poolId) {
  const { rows } = await tx.query(
    `SELECT r.id, r.status, r.seats, r.pickup_zone_id, r.destination_zone_id,
            r.solo_fare_paisa, r.quoted_fare_paisa
     FROM pool_members pm
     JOIN ride_requests r ON r.id = pm.ride_request_id
     WHERE pm.pool_id = $1 AND pm.left_at IS NULL
     ORDER BY r.id`,
    [poolId],
  );
  return rows;
}

/**
 * Whether a ride is currently an active member of this specific pool. Used only for the
 * idempotency check in accept (a repeated accept of an already-matched candidate); membership
 * itself is otherwise read via `listActiveMembers`.
 * @param {import('pg').PoolClient} tx
 * @param {string} poolId
 * @param {string} rideId
 * @returns {Promise<boolean>}
 */
export async function isActiveMemberOfPool(tx, poolId, rideId) {
  const { rows } = await tx.query(
    `SELECT 1 FROM pool_members WHERE pool_id = $1 AND ride_request_id = $2 AND left_at IS NULL`,
    [poolId, rideId],
  );
  return rows.length > 0;
}

/**
 * What a passenger may see about their own ride's pool: the driver's name, the vehicle, and how
 * many others share it. Scoped by passenger id; a ride that is not theirs or is not currently an
 * active member of a pool returns null. Never selects another member's name, destination or fare.
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {string} rideId
 * @returns {Promise<{ driver_name: string, vehicle_name: string, registration_no: string,
 *   active_member_count: number } | null>}
 */
export async function findPoolInfoForPassengerRide(tx, passengerId, rideId) {
  const { rows } = await tx.query(
    `SELECT dr.name AS driver_name, v.name AS vehicle_name, v.registration_no,
            (SELECT count(*)::int FROM pool_members pm2
             WHERE pm2.pool_id = p.id AND pm2.left_at IS NULL) AS active_member_count
     FROM pool_members pm
     JOIN pools p ON p.id = pm.pool_id
     JOIN vehicles v ON v.id = p.vehicle_id
     JOIN users dr ON dr.id = v.driver_id
     JOIN ride_requests r ON r.id = pm.ride_request_id
     WHERE pm.ride_request_id = $1 AND r.passenger_id = $2 AND pm.left_at IS NULL`,
    [rideId, passengerId],
  );
  return rows[0] ?? null;
}
