import { randomUUID } from 'node:crypto';

const MUTABLE_TABLES = 'ride_events, payments, pool_members, pools, ride_requests, vehicles, users';

/**
 * Empties every mutable table. zones and zone_distances are reference data and stay.
 * @param {import('pg').Pool} pool
 */
export async function resetDb(pool) {
  await pool.query(`TRUNCATE ${MUTABLE_TABLES} RESTART IDENTITY CASCADE`);
}

/**
 * Runs a query that must fail and returns the PostgreSQL error.
 * @param {Promise<unknown>} promise
 * @returns {Promise<import('pg').DatabaseError>}
 */
export async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the query to be rejected');
}

export async function makeUser(pool, { role = 'PASSENGER', name = 'Test User', email } = {}) {
  const address = email ?? `${randomUUID()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, name) VALUES ($1, 'hash', $2, $3) RETURNING *`,
    [address, role, name],
  );
  return rows[0];
}

export async function makeVehicle(pool, { driverId, capacity = 3 } = {}) {
  const driver = driverId ? { id: driverId } : await makeUser(pool, { role: 'DRIVER' });
  const { rows } = await pool.query(
    `INSERT INTO vehicles (driver_id, name, registration_no, capacity)
     VALUES ($1, 'Test Tesla', $2, $3) RETURNING *`,
    [driver.id, randomUUID(), capacity],
  );
  return rows[0];
}

export async function makeRideRequest(pool, overrides = {}) {
  const ride = {
    passengerId: overrides.passengerId ?? (await makeUser(pool)).id,
    pickupZoneId: 1,
    destinationZoneId: 3,
    seats: 1,
    distanceUnits: 3,
    soloFarePaisa: 10000,
    quotedFarePaisa: 10000,
    status: 'REQUESTED',
    cancelReason: null,
    ...overrides,
  };
  const { rows } = await pool.query(
    `INSERT INTO ride_requests (passenger_id, pickup_zone_id, destination_zone_id, seats,
       distance_units, solo_fare_paisa, quoted_fare_paisa, status, cancel_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      ride.passengerId,
      ride.pickupZoneId,
      ride.destinationZoneId,
      ride.seats,
      ride.distanceUnits,
      ride.soloFarePaisa,
      ride.quotedFarePaisa,
      ride.status,
      ride.cancelReason,
    ],
  );
  return rows[0];
}

export async function makePool(pool, { vehicleId, status = 'ACCEPTED' } = {}) {
  const vehicle = vehicleId ? { id: vehicleId } : await makeVehicle(pool);
  const { rows } = await pool.query(
    `INSERT INTO pools (vehicle_id, status, cancelled_at, completed_at)
     VALUES ($1, $2::pool_status, CASE WHEN $2::text = 'CANCELLED' THEN now() END,
             CASE WHEN $2::text = 'COMPLETED' THEN now() END) RETURNING *`,
    [vehicle.id, status],
  );
  return rows[0];
}

export async function makePoolMember(pool, { poolId, rideRequestId, left = false }) {
  const { rows } = await pool.query(
    `INSERT INTO pool_members (pool_id, ride_request_id, left_at, left_reason)
     VALUES ($1, $2, CASE WHEN $3::boolean THEN now() END, CASE WHEN $3::boolean THEN 'PASSENGER_CANCELLED'::left_reason END)
     RETURNING *`,
    [poolId, rideRequestId, left],
  );
  return rows[0];
}

export async function makePayment(pool, { rideRequestId, poolId, uncapped = 9000, final = 8500 }) {
  const { rows } = await pool.query(
    `INSERT INTO payments (ride_request_id, pool_id, uncapped_fare_paisa, final_fare_paisa)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [rideRequestId, poolId, uncapped, final],
  );
  return rows[0];
}

export async function makeRideEvent(pool, { rideRequestId, actorId, eventType = 'REQUESTED' }) {
  const { rows } = await pool.query(
    `INSERT INTO ride_events (ride_request_id, actor_id, event_type) VALUES ($1, $2, $3) RETURNING *`,
    [rideRequestId, actorId, eventType],
  );
  return rows[0];
}
