/**
 * Single source of truth for status literals, event types and fixed rules.
 * These values must match the enum labels in db/migrations/001_schema.sql exactly.
 */

export const ROLES = Object.freeze({
  PASSENGER: 'PASSENGER',
  DRIVER: 'DRIVER',
});

export const RIDE_STATUSES = Object.freeze({
  REQUESTED: 'REQUESTED',
  MATCHED: 'MATCHED',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

/** Ride statuses that count toward "one active ride per passenger". */
export const ACTIVE_RIDE_STATUSES = Object.freeze([
  RIDE_STATUSES.REQUESTED,
  RIDE_STATUSES.MATCHED,
  RIDE_STATUSES.DRIVER_ARRIVED,
  RIDE_STATUSES.STARTED,
]);

export const POOL_STATUSES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

/** Pool statuses that count toward "one active pool per vehicle". */
export const ACTIVE_POOL_STATUSES = Object.freeze([
  POOL_STATUSES.ACCEPTED,
  POOL_STATUSES.DRIVER_ARRIVED,
  POOL_STATUSES.STARTED,
]);

export const CANCEL_REASONS = Object.freeze({
  PASSENGER_CANCELLED: 'PASSENGER_CANCELLED',
  PASSENGER_NO_SHOW: 'PASSENGER_NO_SHOW',
});

export const LEFT_REASONS = Object.freeze({
  PASSENGER_CANCELLED: 'PASSENGER_CANCELLED',
  PASSENGER_NO_SHOW: 'PASSENGER_NO_SHOW',
  DRIVER_CANCELLED_POOL: 'DRIVER_CANCELLED_POOL',
  COMPLETED: 'COMPLETED',
  DRIVER_FORCE_ENDED: 'DRIVER_FORCE_ENDED',
});

export const PAYMENT_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  CASH_COLLECTED: 'CASH_COLLECTED',
});

export const RIDE_EVENT_TYPES = Object.freeze({
  REQUESTED: 'REQUESTED',
  MATCHED: 'MATCHED',
  QUOTE_UPDATED: 'QUOTE_UPDATED',
  REQUEUED: 'REQUEUED',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  PASSENGER_NO_SHOW: 'PASSENGER_NO_SHOW',
  PASSENGER_CANCELLED: 'PASSENGER_CANCELLED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  PASSENGER_SELF_COMPLETED: 'PASSENGER_SELF_COMPLETED',
  DRIVER_FORCE_ENDED: 'DRIVER_FORCE_ENDED',
  CASH_COLLECTED: 'CASH_COLLECTED',
});

/** Largest destination-position gap (in corridor units) allowed between pool members. */
export const MAX_DESTINATION_GAP = 3;

/** Fare formula constants, in integer paisa. See domain/fare.js. */
export const BASE_FARE_PAISA = 4000;
export const PER_UNIT_FARE_PAISA = 2000;

/** Failure codes returned by domain/compatibility.js. */
export const COMPATIBILITY_CODES = Object.freeze({
  REQUEST_UNAVAILABLE: 'REQUEST_UNAVAILABLE',
  POOL_CLOSED: 'POOL_CLOSED',
  POOL_FULL: 'POOL_FULL',
  INCOMPATIBLE: 'INCOMPATIBLE',
  EXCEEDS_CAPACITY: 'EXCEEDS_CAPACITY',
});
