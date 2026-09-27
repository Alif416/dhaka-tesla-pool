import { CANCEL_REASONS, LEFT_REASONS, POOL_STATUSES, RIDE_STATUSES } from '../domain/constants.js';
import { computeSoloFare, computeFare, nextQuote } from '../domain/fare.js';
import { PICKUP_EQUALS_DESTINATION, distanceUnits } from '../domain/geography.js';
import { canPassengerCancelRide } from '../domain/stateMachine.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';
import { findPaymentForPassengerRide } from '../repositories/paymentRepository.js';
import { insertRideEvent, listEventsForPassenger } from '../repositories/rideEventRepository.js';
import {
  findActivePoolMembershipForRide,
  findPoolInfoForPassengerRide,
  isActiveMemberOfPool,
  listActiveMembers,
  lockPoolById,
  markMemberLeft,
  updatePoolStatus,
} from '../repositories/poolRepository.js';
import {
  findActiveRideForPassenger,
  findRideForPassenger,
  insertRideForPassenger,
  listRidesForPassenger,
  lockRequestsByIds,
  lockRideForPassenger,
  markRideCancelledForPassenger,
  updateQuote,
} from '../repositories/rideRepository.js';
import { getCrossDistances, getZoneById } from './zoneService.js';

/** Bounded retries for the stale-discovery loop in cancelRide's pool-membership path. */
const MAX_STALE_DISCOVERY_ATTEMPTS = 3;

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
   * @returns {Promise<{ ride: object, timeline: object[], poolInfo: object | null,
   *   payment: object | null }>}
   */
  async function getRide(actor, rideId) {
    return withTx(async (tx) => {
      const ride = await findRideForPassenger(tx, actor.id, rideId);
      if (!ride) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found.');
      }
      const timeline = await listEventsForPassenger(tx, actor.id, rideId);
      const poolInfo = await findPoolInfoForPassengerRide(tx, actor.id, rideId);
      const payment = await findPaymentForPassengerRide(tx, actor.id, rideId);
      return { ride, timeline, poolInfo, payment };
    });
  }

  /**
   * @param {{ id: string }} actor
   * @returns {Promise<{ ride: object, timeline: object[], poolInfo: object | null,
   *   payment: object | null }[]>} Current and past rides.
   */
  async function listRides(actor) {
    return withTx(async (tx) => {
      const rides = await listRidesForPassenger(tx, actor.id);
      const result = [];
      for (const ride of rides) {
        const timeline = await listEventsForPassenger(tx, actor.id, ride.id);
        const poolInfo = await findPoolInfoForPassengerRide(tx, actor.id, ride.id);
        const payment = await findPaymentForPassengerRide(tx, actor.id, ride.id);
        result.push({ ride, timeline, poolInfo, payment });
      }
      return result;
    });
  }

  /**
   * Cancels the passenger's own ride, from `REQUESTED`, `MATCHED` or `DRIVER_ARRIVED`
   * (design.md section 7.2). Follows a bounded stale-discovery retry: membership is discovered
   * without a lock first (a plain read, its own committed `withTx` call), then re-checked once
   * the right lock is actually held. If that re-check finds discovery was stale — a concurrent
   * accept just matched this ride into a pool discovery missed — the whole attempt retries.
   * @param {{ id: string }} actor
   * @param {string} rideId
   * @returns {Promise<{ ride: object, timeline: object[], poolInfo: object | null,
   *   payment: object | null }>}
   */
  async function cancelRide(actor, rideId) {
    for (let attempt = 1; attempt <= MAX_STALE_DISCOVERY_ATTEMPTS; attempt += 1) {
      const membership = await withTx((tx) => findActivePoolMembershipForRide(tx, rideId));

      if (!membership) {
        const outcome = await withTx(async (tx) => {
          const ride = await lockRideForPassenger(tx, actor.id, rideId);
          if (!ride) {
            throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found.');
          }
          if (
            ride.status === RIDE_STATUSES.CANCELLED &&
            ride.cancel_reason === CANCEL_REASONS.PASSENGER_CANCELLED
          ) {
            const timeline = await listEventsForPassenger(tx, actor.id, rideId);
            return { stale: false, value: { ride, timeline, poolInfo: null, payment: null } };
          }
          if (ride.status === RIDE_STATUSES.REQUESTED) {
            const cancelled = await cancelUnpooledRide(tx, actor, rideId);
            return { stale: false, value: cancelled };
          }
          if (
            ride.status === RIDE_STATUSES.MATCHED ||
            ride.status === RIDE_STATUSES.DRIVER_ARRIVED
          ) {
            // A concurrent accept matched this ride after our unlocked discovery ran. Retry
            // from scratch so discovery finds the pool this time.
            return { stale: true };
          }
          throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This ride cannot be cancelled now.');
        });
        if (outcome.stale) {
          continue;
        }
        return outcome.value;
      }

      const outcome = await withTx(async (tx) => {
        const pool = await lockPoolById(tx, membership.pool_id);
        const discoveredMemberIds = (await listActiveMembers(tx, pool.id)).map((m) => m.id);
        const idsToLock = [...new Set([rideId, ...discoveredMemberIds])];
        const lockedRows = await lockRequestsByIds(tx, idsToLock);
        const candidate = lockedRows.find((row) => row.id === rideId);
        if (!candidate || candidate.passenger_id !== actor.id) {
          // Ownership is enforced here, not by markRideCancelledForPassenger's WHERE clause
          // alone: that would silently no-op for the wrong actor while this transaction's other
          // writes (quote recompute, membership close) still ran, mutating another passenger's
          // pool without ever actually cancelling their ride.
          throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found.');
        }

        const stillMember = await isActiveMemberOfPool(tx, pool.id, rideId);
        if (!stillMember) {
          // Stale discovery: cancel-pool or no-show already removed this membership between our
          // unlocked read and this lock. Resolve directly from the now-fresh candidate row
          // rather than looping back — we already hold everything needed.
          if (
            candidate.status === RIDE_STATUSES.CANCELLED &&
            candidate.cancel_reason === CANCEL_REASONS.PASSENGER_CANCELLED
          ) {
            const timeline = await listEventsForPassenger(tx, actor.id, rideId);
            return { ride: candidate, timeline, poolInfo: null, payment: null };
          }
          if (candidate.status === RIDE_STATUSES.REQUESTED) {
            return cancelUnpooledRide(tx, actor, rideId);
          }
          throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This ride cannot be cancelled now.');
        }

        if (!canPassengerCancelRide(candidate.status) || pool.status === POOL_STATUSES.STARTED) {
          throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This ride cannot be cancelled now.');
        }

        await markMemberLeft(tx, pool.id, rideId, LEFT_REASONS.PASSENGER_CANCELLED);
        const cancelled = await markRideCancelledForPassenger(tx, actor.id, rideId);
        await insertRideEvent(tx, {
          rideRequestId: rideId,
          actorId: actor.id,
          poolId: pool.id,
          eventType: 'PASSENGER_CANCELLED',
        });

        // Recompute quotes for whoever remains. Never rises: removing a member only ever raises
        // the *computed* fare (fewer passengers, less discount); nextQuote keeps the quote as is.
        const remainingMembers = lockedRows.filter(
          (row) => row.id !== rideId && row.status !== RIDE_STATUSES.CANCELLED,
        );
        if (remainingMembers.length > 0) {
          const passengerCount = remainingMembers.length;
          for (const member of remainingMembers) {
            const computedFarePaisa = computeFare({
              soloFarePaisa: member.solo_fare_paisa,
              passengerCount,
            });
            const quotedFarePaisa = nextQuote({
              quotedFarePaisa: member.quoted_fare_paisa,
              computedFarePaisa,
            });
            if (quotedFarePaisa !== member.quoted_fare_paisa) {
              await updateQuote(tx, member.id, quotedFarePaisa);
              await insertRideEvent(tx, {
                rideRequestId: member.id,
                actorId: actor.id,
                poolId: pool.id,
                eventType: 'QUOTE_UPDATED',
                metadata: { fromPaisa: member.quoted_fare_paisa, toPaisa: quotedFarePaisa },
              });
            }
          }
        } else {
          await updatePoolStatus(tx, pool.id, POOL_STATUSES.CANCELLED);
        }

        const timeline = await listEventsForPassenger(tx, actor.id, rideId);
        return { ride: cancelled, timeline, poolInfo: null, payment: null };
      });
      return outcome;
    }
    throw new AppError(ERROR_CODES.BUSY, 503, 'Busy, please try again.', { retryAfter: 1 });
  }

  return { estimateFare, createRide, getRide, listRides, cancelRide };
}

/**
 * Cancels a ride that is (or has just become) REQUESTED — the no-pool cancel path, shared by
 * both branches of cancelRide's stale-discovery handling.
 */
async function cancelUnpooledRide(tx, actor, rideId) {
  const cancelled = await markRideCancelledForPassenger(tx, actor.id, rideId);
  await insertRideEvent(tx, {
    rideRequestId: rideId,
    actorId: actor.id,
    eventType: 'PASSENGER_CANCELLED',
  });
  const timeline = await listEventsForPassenger(tx, actor.id, rideId);
  return { ride: cancelled, timeline, poolInfo: null, payment: null };
}
