import { POOL_STATUSES, RIDE_STATUSES } from './constants.js';

const R = RIDE_STATUSES;
const P = POOL_STATUSES;

/** Every ride status this status may legally move to. Terminal statuses map to []. */
const RIDE_TRANSITIONS = Object.freeze({
  [R.REQUESTED]: [R.MATCHED, R.CANCELLED],
  [R.MATCHED]: [R.DRIVER_ARRIVED, R.CANCELLED, R.REQUESTED],
  [R.DRIVER_ARRIVED]: [R.STARTED, R.CANCELLED, R.REQUESTED],
  [R.STARTED]: [R.COMPLETED],
  [R.COMPLETED]: [],
  [R.CANCELLED]: [],
});

/** Every pool status this status may legally move to. Terminal statuses map to []. */
const POOL_TRANSITIONS = Object.freeze({
  [P.ACCEPTED]: [P.DRIVER_ARRIVED, P.CANCELLED],
  [P.DRIVER_ARRIVED]: [P.STARTED, P.CANCELLED],
  [P.STARTED]: [P.COMPLETED],
  [P.COMPLETED]: [],
  [P.CANCELLED]: [],
});

/**
 * Whether a ride may move from one status to another. `MATCHED`/`DRIVER_ARRIVED` back to
 * `REQUESTED` is the driver-cancels-pool requeue; there is no general `CANCELLED -> REQUESTED`.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransitionRide(from, to) {
  return RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Whether a pool may move from one status to another.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransitionPool(from, to) {
  return POOL_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Section 4.3: can a passenger cancel their own ride in this status?
 * @param {string} rideStatus
 * @returns {boolean}
 */
export function canPassengerCancelRide(rideStatus) {
  return [R.REQUESTED, R.MATCHED, R.DRIVER_ARRIVED].includes(rideStatus);
}

/**
 * Section 4.3: can the driver no-show a member while the pool is in this status?
 * @param {string} poolStatus
 * @returns {boolean}
 */
export function canNoShowMember(poolStatus) {
  return poolStatus === P.DRIVER_ARRIVED;
}

/**
 * Section 4.3: can this ride be completed now (by its own passenger, or by the driver)?
 * @param {string} rideStatus
 * @returns {boolean}
 */
export function canCompleteRide(rideStatus) {
  return rideStatus === R.STARTED;
}

/**
 * Section 4.3: can the driver End Trip while the pool is in this status?
 * @param {string} poolStatus
 * @returns {boolean}
 */
export function canEndTrip(poolStatus) {
  return poolStatus === P.STARTED;
}

/**
 * Section 4.3: can the driver cancel the pool while it is in this status?
 * @param {string} poolStatus
 * @returns {boolean}
 */
export function canCancelPool(poolStatus) {
  return [P.ACCEPTED, P.DRIVER_ARRIVED].includes(poolStatus);
}

/**
 * Section 4.3: can the driver go offline, given whether they currently have an active pool?
 * @param {boolean} hasActivePool
 * @returns {boolean}
 */
export function canGoOffline(hasActivePool) {
  return !hasActivePool;
}
