/**
 * Maps an API error `code` to a user-facing message (design.md section 11.5). Components never
 * write their own messages for these codes.
 */
export const ERROR_MESSAGES = Object.freeze({
  REQUEST_UNAVAILABLE: 'That request is no longer available.',
  POOL_FULL: 'Not enough seats left.',
  POOL_CLOSED: "Joining closed once you've arrived.",
  INCOMPATIBLE: "This route doesn't fit the current pool.",
  EXCEEDS_CAPACITY: 'This booking needs more seats than the vehicle has.',
  ACTIVE_RIDE_EXISTS: 'You already have an active ride.',
  DRIVER_OFFLINE: 'Go online first.',
  POOL_ACTIVE: 'Finish or cancel your current pool first.',
  BUSY: 'Busy, please try again.',
  INVALID_STATE: 'That is not allowed right now.',
  VALIDATION_FAILED: 'Please check your input.',
  NOT_FOUND: 'Not found.',
  FORBIDDEN: 'Not allowed.',
  UNAUTHENTICATED: 'Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  EMAIL_TAKEN: 'That email is already registered.',
  NO_DISTANCE: 'No distance is on record for that route.',
});

/**
 * @param {string} code
 * @returns {string}
 */
export function messageForErrorCode(code) {
  return ERROR_MESSAGES[code] ?? 'Something went wrong.';
}
