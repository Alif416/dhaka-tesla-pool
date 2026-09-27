import { RIDE_STATUSES } from '../domain/constants.js';
import { computeSoloFare } from '../domain/fare.js';
import { PICKUP_EQUALS_DESTINATION, distanceUnits } from '../domain/geography.js';
import { canPassengerCancelRide } from '../domain/stateMachine.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';
import { insertRideEvent, listEventsForPassenger } from '../repositories/rideEventRepository.js';
import { findPoolInfoForPassengerRide } from '../repositories/poolRepository.js';
import {
  findActiveRideForPassenger,
  findRideForPassenger,
  insertRideForPassenger,
  listRidesForPassenger,
  lockRideForPassenger,
  markRideCancelledForPassenger,
} from '../repositories/rideRepository.js';
import { getCrossDistances, getZoneById } from './zoneService.js';

function resolveRoute({ pickupZoneId, destinationZoneId }) {
  const pickupZone = getZoneById(pickupZoneId);
  const destinationZone = getZoneById(destinationZoneId);
  if (!pickupZone || !destinationZone) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 422, 'Unknown zone.');
  }
  const result = distanceUnits(pickupZone, destinationZone, getCrossDistances());
  if (!result.ok) {
    if (result.code === PICKUP_EQUALS_DESTINATION) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 422, 'Pickup and destination must differ.');
    }
    throw new AppError(ERROR_CODES.NO_DISTANCE, 422, 'No distance is on record for that route.');
  }
  return { pickupZone, destinationZone, distanceUnits: result.distanceUnits };
}

function isIdenticalRequestedRide(ride, { pickupZoneId, destinationZoneId, seats }) {
  return (
    ride.status === RIDE_STATUSES.REQUESTED &&
    ride.pickup_zone_id === pickupZoneId &&
    ride.destination_zone_id === destinationZoneId &&
    ride.seats === seats
  );
}

/**
 * Builds the passenger ride service bound to one transaction runner.
 * @param {{ withTx: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }} deps
 * @returns {object}
 */
export function createRideService({ withTx }) {
  /**
   * Fare estimate for a route and seat count. Read-only; nothing is written.
   * @param {{ id: string }} actor
   * @param {{ pickupZoneId: number, destinationZoneId: number, seats: number }} input
   * @returns {Promise<{ amountPaisa: number, distanceUnits: number }>}
   */
  async function estimateFare(actor, input) {
    const { distanceUnits: units } = resolveRoute(input);
    const amountPaisa = computeSoloFare({ seats: input.seats, distanceUnits: units });
    return { amountPaisa, distanceUnits: units };
  }

  /**
   * Creates a ride, or returns the passenger's existing identical REQUESTED ride with
   * `created: false`. Any other active ride is a 409 `ACTIVE_RIDE_EXISTS`.
   * @param {{ id: string }} actor
   * @param {{ pickupZoneId: number, destinationZoneId: number, seats: number }} input
   * @returns {Promise<{ ride: object, timeline: object[], created: boolean }>}
   */
  async function createRide(actor, input) {
    const { distanceUnits: units } = resolveRoute(input);
    const soloFarePaisa = computeSoloFare({ seats: input.seats, distanceUnits: units });

    return withTx(async (tx) => {
      const active = await findActiveRideForPassenger(tx, actor.id);
      if (active) {
        if (isIdenticalRequestedRide(active, input)) {
          const timeline = await listEventsForPassenger(tx, actor.id, active.id);
          return { ride: active, timeline, created: false };
        }
        throw new AppError(
          ERROR_CODES.ACTIVE_RIDE_EXISTS,
          409,
          'You already have an active ride.',
          { rideId: active.id },
        );
      }

      const ride = await insertRideForPassenger(tx, actor.id, {
        pickupZoneId: input.pickupZoneId,
        destinationZoneId: input.destinationZoneId,
        seats: input.seats,
        distanceUnits: units,
        soloFarePaisa,
        quotedFarePaisa: soloFarePaisa,
      });
      await insertRideEvent(tx, {
        rideRequestId: ride.id,
        actorId: actor.id,
        eventType: 'REQUESTED',
      });
      const timeline = await listEventsForPassenger(tx, actor.id, ride.id);
      return { ride, timeline, created: true };
    });
  }

  /**
   * @param {{ id: string }} actor
   * @param {string} rideId
   * @returns {Promise<{ ride: object, timeline: object[], poolInfo: object | null }>}
   */
  async function getRide(actor, rideId) {
    return withTx(async (tx) => {
      const ride = await findRideForPassenger(tx, actor.id, rideId);
      if (!ride) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found.');
      }
      const timeline = await listEventsForPassenger(tx, actor.id, rideId);
      const poolInfo = await findPoolInfoForPassengerRide(tx, actor.id, rideId);
      return { ride, timeline, poolInfo };
    });
  }

  /**
   * @param {{ id: string }} actor
   * @returns {Promise<{ ride: object, timeline: object[], poolInfo: object | null }[]>} Current
   *   and past rides.
   */
  async function listRides(actor) {
    return withTx(async (tx) => {
      const rides = await listRidesForPassenger(tx, actor.id);
      const result = [];
      for (const ride of rides) {
        const timeline = await listEventsForPassenger(tx, actor.id, ride.id);
        const poolInfo = await findPoolInfoForPassengerRide(tx, actor.id, ride.id);
        result.push({ ride, timeline, poolInfo });
      }
      return result;
    });
  }

  /**
   * Cancels a ride while it is `REQUESTED`. Cancelling from `MATCHED` or `DRIVER_ARRIVED` is a
   * legal transition in the state machine, but changes pool membership too, which is not
   * implemented until unit 08 — until then it returns 409 `INVALID_STATE` like any other
   * disallowed state. Remove this restriction (the second `if` below) in unit 08.
   * @param {{ id: string }} actor
   * @param {string} rideId
   * @returns {Promise<{ ride: object, timeline: object[] }>}
   */
  async function cancelRide(actor, rideId) {
    return withTx(async (tx) => {
      const ride = await lockRideForPassenger(tx, actor.id, rideId);
      if (!ride) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found.');
      }
      if (ride.status === RIDE_STATUSES.CANCELLED && ride.cancel_reason === 'PASSENGER_CANCELLED') {
        const timeline = await listEventsForPassenger(tx, actor.id, rideId);
        return { ride, timeline };
      }
      if (!canPassengerCancelRide(ride.status)) {
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This ride cannot be cancelled now.');
      }
      if (ride.status !== RIDE_STATUSES.REQUESTED) {
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This ride cannot be cancelled now.');
      }

      const cancelled = await markRideCancelledForPassenger(tx, actor.id, rideId);
      await insertRideEvent(tx, {
        rideRequestId: rideId,
        actorId: actor.id,
        eventType: 'PASSENGER_CANCELLED',
      });
      const timeline = await listEventsForPassenger(tx, actor.id, rideId);
      return { ride: cancelled, timeline };
    });
  }

  return { estimateFare, createRide, getRide, listRides, cancelRide };
}
