import { BASE_FARE_PAISA, PER_UNIT_FARE_PAISA } from './constants.js';

/** Discount percent by number of active passengers in the pool. Bullet has 3 seats. */
const DISCOUNT_PERCENT_BY_PASSENGER_COUNT = Object.freeze({ 1: 0, 2: 10, 3: 15 });

function assertInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer, got ${value}`);
  }
}

/**
 * Fare for the booking with no pool discount.
 * @param {{ seats: number, distanceUnits: number }} input
 * @returns {number} Solo fare in integer paisa.
 */
export function computeSoloFare({ seats, distanceUnits }) {
  assertInteger(seats, 'seats');
  assertInteger(distanceUnits, 'distanceUnits');
  return seats * (BASE_FARE_PAISA + PER_UNIT_FARE_PAISA * distanceUnits);
}

/**
 * Pool discount percent for a given number of active passengers.
 * @param {number} passengerCount
 * @returns {number} 0, 10 or 15.
 */
export function discountPercent(passengerCount) {
  assertInteger(passengerCount, 'passengerCount');
  const percent = DISCOUNT_PERCENT_BY_PASSENGER_COUNT[passengerCount];
  if (percent === undefined) {
    throw new RangeError(`No discount tier defined for ${passengerCount} passengers`);
  }
  return percent;
}

/**
 * Current fare for a passenger given the pool's current size. Never stored.
 * @param {{ soloFarePaisa: number, passengerCount: number }} input
 * @returns {number} Computed fare in integer paisa, rounded half up.
 */
export function computeFare({ soloFarePaisa, passengerCount }) {
  assertInteger(soloFarePaisa, 'soloFarePaisa');
  const percent = discountPercent(passengerCount);
  return Math.floor((soloFarePaisa * (100 - percent) + 50) / 100);
}

/**
 * The quote update rule: quoted fare only ever decreases.
 * @param {{ quotedFarePaisa: number, computedFarePaisa: number }} input
 * @returns {number} The lower of the two.
 */
export function nextQuote({ quotedFarePaisa, computedFarePaisa }) {
  assertInteger(quotedFarePaisa, 'quotedFarePaisa');
  assertInteger(computedFarePaisa, 'computedFarePaisa');
  return Math.min(quotedFarePaisa, computedFarePaisa);
}
