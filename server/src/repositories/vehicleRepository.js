/**
 * All SQL for vehicles, scoped to the acting driver.
 */

const VEHICLE_COLUMNS = 'id, driver_id, name, registration_no, capacity, online, created_at';

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @returns {Promise<object | null>}
 */
export async function findVehicleForDriver(tx, driverId) {
  const { rows } = await tx.query(`SELECT ${VEHICLE_COLUMNS} FROM vehicles WHERE driver_id = $1`, [
    driverId,
  ]);
  return rows[0] ?? null;
}

/**
 * Locks the driver's vehicle row for update.
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @returns {Promise<object | null>}
 */
export async function lockVehicleForDriver(tx, driverId) {
  const { rows } = await tx.query(
    `SELECT ${VEHICLE_COLUMNS} FROM vehicles WHERE driver_id = $1 FOR UPDATE`,
    [driverId],
  );
  return rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} driverId
 * @param {boolean} online
 * @returns {Promise<object>} The updated row.
 */
export async function setOnlineForDriver(tx, driverId, online) {
  const { rows } = await tx.query(
    `UPDATE vehicles SET online = $2 WHERE driver_id = $1 RETURNING ${VEHICLE_COLUMNS}`,
    [driverId, online],
  );
  return rows[0];
}
