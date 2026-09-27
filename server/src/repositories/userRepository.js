/**
 * Identity lookups keyed by credentials or a verified token subject. Unlike every other
 * repository, these are legitimately unscoped: there is no "owning actor" for a user's own
 * account row, only the credential or id supplied in the request itself.
 */

/**
 * Inserts a new passenger. `ON CONFLICT` is not used here: a duplicate email raises the unique
 * violation, which `errorHandler` maps to 409 `EMAIL_TAKEN` by constraint name.
 * @param {import('pg').PoolClient} tx
 * @param {{ email: string, passwordHash: string, name: string }} input
 * @returns {Promise<object>} The inserted row.
 */
export async function insertPassenger(tx, { email, passwordHash, name }) {
  const { rows } = await tx.query(
    `INSERT INTO users (email, password_hash, role, name)
     VALUES ($1, $2, 'PASSENGER', $3) RETURNING *`,
    [email, passwordHash, name],
  );
  return rows[0];
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} email Already lowercased.
 * @returns {Promise<object | null>}
 */
export async function findUserByEmail(tx, email) {
  const { rows } = await tx.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} tx
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function findUserById(tx, id) {
  const { rows } = await tx.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}
