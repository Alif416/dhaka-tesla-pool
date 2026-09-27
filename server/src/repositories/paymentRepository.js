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
