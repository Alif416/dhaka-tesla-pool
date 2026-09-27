/**
 * Internal repository for ride_events. insertRideEvent is called only from services, never
 * from routes. ride_events is append-only (enforced by a trigger); nothing here updates or
 * deletes a row.
 */

/**
 * @param {import('pg').PoolClient} tx
 * @param {{ rideRequestId: string, actorId: string, eventType: string, poolId?: string | null,
 *   metadata?: object }} event
 * @returns {Promise<void>}
 */
export async function insertRideEvent(
  tx,
  { rideRequestId, actorId, eventType, poolId = null, metadata = {} },
) {
  await tx.query(
    `INSERT INTO ride_events (ride_request_id, pool_id, actor_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [rideRequestId, poolId, actorId, eventType, JSON.stringify(metadata)],
  );
}

/**
 * A ride's timeline, oldest first. Scoped by passenger so a ride that is not this passenger's
 * own returns no rows; callers still confirm ownership themselves via the ride lookup.
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {string} rideId
 * @returns {Promise<{ event_type: string, created_at: Date }[]>}
 */
export async function listEventsForPassenger(tx, passengerId, rideId) {
  const { rows } = await tx.query(
    `SELECT e.event_type, e.created_at
     FROM ride_events e
     JOIN ride_requests r ON r.id = e.ride_request_id
     WHERE r.id = $1 AND r.passenger_id = $2
     ORDER BY e.created_at, e.id`,
    [rideId, passengerId],
  );
  return rows;
}
