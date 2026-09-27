/**
 * All SQL for payments. Created once at start (unique on ride_request_id is the backstop);
 * never updated except the cash-collected fields (unit 09).
 */

const PAYMENT_COLUMNS =
  'id, ride_request_id, pool_id, uncapped_fare_paisa, final_fare_paisa, subsidy_paisa, status, cash_collected_at, created_at';

/**
 * @param {import('pg').PoolClient} tx
 * @param {{ rideRequestId: string, poolId: string, uncappedFarePaisa: number,
 *   finalFarePaisa: number }} input
 * @returns {Promise<object>} The inserted row, including the generated `subsidy_paisa`.
 */
export async function insertPayment(
  tx,
  { rideRequestId, poolId, uncappedFarePaisa, finalFarePaisa },
) {
  const { rows } = await tx.query(
    `INSERT INTO payments (ride_request_id, pool_id, uncapped_fare_paisa, final_fare_paisa)
     VALUES ($1, $2, $3, $4)
     RETURNING ${PAYMENT_COLUMNS}`,
    [rideRequestId, poolId, uncappedFarePaisa, finalFarePaisa],
  );
  return rows[0];
}

/**
 * What a passenger may see of their own payment. Scoped by passenger id.
 * @param {import('pg').PoolClient} tx
 * @param {string} passengerId
 * @param {string} rideId
 * @returns {Promise<object | null>}
 */
export async function findPaymentForPassengerRide(tx, passengerId, rideId) {
  const { rows } = await tx.query(
    `SELECT p.uncapped_fare_paisa, p.final_fare_paisa, p.subsidy_paisa, p.status, p.cash_collected_at
     FROM payments p
     JOIN ride_requests r ON r.id = p.ride_request_id
     WHERE p.ride_request_id = $1 AND r.passenger_id = $2`,
    [rideId, passengerId],
  );
  return rows[0] ?? null;
}

/**
 * A payment scoped through the driver's own pools (pool -> vehicle -> driver), with the ride's
 * current status alongside so the caller can check it is COMPLETED before collecting cash.
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @param {string} paymentId
 * @returns {Promise<object | null>}
 */
export async function findPaymentForDriver(tx, driverId, paymentId) {
  const { rows } = await tx.query(
    `SELECT pay.id, pay.ride_request_id, pay.pool_id, pay.uncapped_fare_paisa,
            pay.final_fare_paisa, pay.subsidy_paisa, pay.status, pay.cash_collected_at,
            pay.created_at, r.status AS ride_status
     FROM payments pay
     JOIN pools p ON p.id = pay.pool_id
     JOIN vehicles v ON v.id = p.vehicle_id
     JOIN ride_requests r ON r.id = pay.ride_request_id
     WHERE pay.id = $1 AND v.driver_id = $2`,
    [paymentId, driverId],
  );
  return rows[0] ?? null;
}

/**
 * Marks a payment cash-collected. The only field this repository ever updates on a payment
 * after creation, matching the "never updated except cash fields" rule.
 * @param {import('pg').PoolClient} tx
 * @param {string} paymentId
 * @returns {Promise<object>} The updated row.
 */
export async function markCashCollected(tx, paymentId) {
  const { rows } = await tx.query(
    `UPDATE payments SET status = 'CASH_COLLECTED', cash_collected_at = now()
     WHERE id = $1
     RETURNING ${PAYMENT_COLUMNS}`,
    [paymentId],
  );
  return rows[0];
}
