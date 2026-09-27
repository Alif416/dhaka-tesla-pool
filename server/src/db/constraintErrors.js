/**
 * Maps a named PostgreSQL constraint (SQLSTATE 23505) to its 409 error code. Renaming a
 * constraint requires updating this map in the same change. `pools_one_active_per_vehicle` is
 * deliberately absent: that race is handled as stale discovery inside the accept service, not
 * mapped to an error here.
 */
const UNIQUE_VIOLATION_MAP = Object.freeze({
  ride_requests_one_active_per_passenger: {
    code: 'ACTIVE_RIDE_EXISTS',
    status: 409,
    message: 'You already have an active ride.',
  },
  pool_members_one_active_per_ride: {
    code: 'REQUEST_UNAVAILABLE',
    status: 409,
    message: 'That request is no longer available.',
  },
  users_email_key: {
    code: 'EMAIL_TAKEN',
    status: 409,
    message: 'That email is already registered.',
  },
});

/**
 * Maps a PostgreSQL error to a friendly `{ code, status, message }`, or `null` when it is not
 * one of the two SQLSTATEs this app maps (23505, 23514) or the constraint is not named above.
 * @param {import('pg').DatabaseError} error
 * @returns {{ code: string, status: number, message: string } | null}
 */
export function mapConstraintError(error) {
  if (error.code === '23505') {
    return UNIQUE_VIOLATION_MAP[error.constraint] ?? null;
  }
  if (error.code === '23514') {
    return {
      code: 'CONSTRAINT_VIOLATION',
      status: 409,
      message: 'That would violate a data rule.',
    };
  }
  return null;
}
