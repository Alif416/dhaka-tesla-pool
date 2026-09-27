import { canAnchor, canJoinPool } from '../domain/compatibility.js';
import {
  COMPATIBILITY_CODES,
  LEFT_REASONS,
  POOL_STATUSES,
  RIDE_EVENT_TYPES,
  RIDE_STATUSES,
} from '../domain/constants.js';
import { computeFare, nextQuote } from '../domain/fare.js';
import { canTransitionPool } from '../domain/stateMachine.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';
import { insertPayment } from '../repositories/paymentRepository.js';
import { insertRideEvent } from '../repositories/rideEventRepository.js';
import {
  findPoolForDriver,
  insertPool,
  insertPoolMember,
  isActiveMemberOfPool,
  listActiveMembers,
  listActiveMembersForDriverPool,
  lockActivePoolForVehicle,
  lockPoolForDriver,
  markAllActiveMembersLeft,
  markMemberLeft,
  sumOccupiedSeats,
  updateActiveMembersStatus,
  updatePoolStatus,
} from '../repositories/poolRepository.js';
import {
  lockRequestsByIds,
  markMatched,
  markRideCancelledByDriver,
  updateQuote,
} from '../repositories/rideRepository.js';
import { findVehicleForDriver, lockVehicleForDriver } from '../repositories/vehicleRepository.js';
import { toCandidateShape } from './zoneService.js';

/** Stale-discovery retries for the `pools_one_active_per_vehicle` backstop (see acceptRide). */
const MAX_STALE_POOL_ATTEMPTS = 3;

const COMPATIBILITY_MESSAGES = Object.freeze({
  [COMPATIBILITY_CODES.REQUEST_UNAVAILABLE]: 'That request is no longer available.',
  [COMPATIBILITY_CODES.POOL_CLOSED]: 'Joining closed once the driver arrives.',
  [COMPATIBILITY_CODES.POOL_FULL]: 'Not enough seats left.',
  [COMPATIBILITY_CODES.INCOMPATIBLE]: "This route doesn't fit the current pool.",
  [COMPATIBILITY_CODES.EXCEEDS_CAPACITY]: 'This booking needs more seats than the vehicle has.',
});

function throwCompatibilityError(code) {
  throw new AppError(code, 409, COMPATIBILITY_MESSAGES[code] ?? 'That is not allowed right now.');
}

function toRowShape(row) {
  return toCandidateShape({
    status: row.status,
    seats: row.seats,
    pickupZoneId: row.pickup_zone_id,
    destinationZoneId: row.destination_zone_id,
  });
}

/**
 * Builds { pool, vehicle, members, occupiedSeats } — the same shape driverService.getCurrentPool
 * returns — so the accept response and the pool-view response are serialized identically.
 */
async function buildDriverPoolResult(tx, driverId, pool) {
  const vehicle = await findVehicleForDriver(tx, driverId);
  const members = await listActiveMembersForDriverPool(tx, driverId, pool.id);
  const occupiedSeats = await sumOccupiedSeats(tx, pool.id);
  return { pool, vehicle, members, occupiedSeats };
}

/**
 * Builds the pool service (accept / add-to-pool) bound to one transaction runner.
 * @param {{ withTx: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }} deps
 * @returns {{ acceptRide: (actor: { id: string }, rideId: string) => Promise<object> }}
 */
export function createPoolService({ withTx }) {
  /**
   * One attempt at accept/add-to-pool. Lock order: vehicle, then pool, then ride_requests by
   * ascending id (lock set for this command). Sequence follows design.md section 7.1.
   */
  async function attemptAccept(actor, rideId) {
    return withTx(async (tx) => {
      // 1-2. Lock the driver's vehicle; must be online.
      const vehicle = await lockVehicleForDriver(tx, actor.id);
      if (!vehicle.online) {
        throw new AppError(ERROR_CODES.DRIVER_OFFLINE, 409, 'Go online first.');
      }

      // 3. Lock the driver's active pool, if any.
      const pool = await lockActivePoolForVehicle(tx, vehicle.id);

      // Discovery only: which member ids to lock alongside the candidate. Nothing in the
      // codebase can yet remove a matched member (unit 08 adds cancel-from-pool/no-show), so
      // this list cannot itself go stale before the lock below — but the lock is still taken,
      // both to protect the quote-recompute writes and to keep the fixed lock order in place
      // for when unit 08 does add a way to leave a pool.
      const discoveredMemberIds = pool
        ? (await listActiveMembers(tx, pool.id)).map((m) => m.id)
        : [];

      // 4. Lock the candidate and all active members' requests together, ascending id.
      const idsToLock = [...new Set([rideId, ...discoveredMemberIds])];
      const lockedRows = await lockRequestsByIds(tx, idsToLock);
      const candidate = lockedRows.find((row) => row.id === rideId);
      if (!candidate) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found.');
      }

      // 5. Idempotent retry: already an active member of this driver's pool.
      if (pool && (await isActiveMemberOfPool(tx, pool.id, rideId))) {
        return buildDriverPoolResult(tx, actor.id, pool);
      }

      // Authoritative member set, re-read via the locked rows (never the pre-lock discovery).
      const members = lockedRows.filter(
        (row) => row.id !== rideId && row.status === RIDE_STATUSES.MATCHED,
      );
      const occupiedSeats = members.reduce((sum, member) => sum + member.seats, 0);

      // 6. Shared compatibility check — the same function the driver's request list uses.
      const compatibility = pool
        ? canJoinPool({
            candidate: toRowShape(candidate),
            members: members.map(toRowShape),
            capacity: vehicle.capacity,
            poolStatus: pool.status,
            occupiedSeats,
          })
        : canAnchor({ candidate: toRowShape(candidate), capacity: vehicle.capacity });
      if (!compatibility.ok) {
        throwCompatibilityError(compatibility.code);
      }

      // 7-9. Create the pool if none, add the member, match the candidate.
      const activePool = pool ?? (await insertPool(tx, vehicle.id));
      await insertPoolMember(tx, activePool.id, candidate.id);
      await markMatched(tx, candidate.id);
      await insertRideEvent(tx, {
        rideRequestId: candidate.id,
        actorId: actor.id,
        poolId: activePool.id,
        eventType: RIDE_EVENT_TYPES.MATCHED,
      });

      // 10. Recompute quotes for every active member, including the new one. Never rises.
      const allMembers = [...members, { ...candidate, status: RIDE_STATUSES.MATCHED }];
      const passengerCount = allMembers.length;
      for (const member of allMembers) {
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
            poolId: activePool.id,
            eventType: RIDE_EVENT_TYPES.QUOTE_UPDATED,
            metadata: { fromPaisa: member.quoted_fare_paisa, toPaisa: quotedFarePaisa },
          });
        }
      }

      return buildDriverPoolResult(tx, actor.id, activePool);
    });
  }

  /**
   * Accepts a request (creating a pool) or adds it to the driver's existing one.
   * @param {{ id: string }} actor Driver.
   * @param {string} rideId Candidate ride request id.
   * @returns {Promise<object>} { pool, vehicle, members, occupiedSeats } — the driver pool shape.
   */
  async function acceptRide(actor, rideId) {
    for (let attempt = 1; attempt <= MAX_STALE_POOL_ATTEMPTS; attempt += 1) {
      try {
        return await attemptAccept(actor, rideId);
      } catch (error) {
        // A 23505 on pools_one_active_per_vehicle should be unreachable: the vehicle lock above
        // already serializes every accept for one vehicle. It is handled anyway as a defensive
        // backstop (code-standards.md section 9 rule 8): re-discover the pool and retry as a
        // join, in case that serialization is ever weakened by a future change.
        const isStalePoolRace =
          error?.code === '23505' && error?.constraint === 'pools_one_active_per_vehicle';
        if (isStalePoolRace && attempt < MAX_STALE_POOL_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
    throw new AppError(ERROR_CODES.BUSY, 503, 'Busy, please try again.', { retryAfter: 1 });
  }

  /**
   * Lock set: driver's pool only. Bulk-updates the pool and every active member together.
   * @param {{ id: string }} actor Driver.
   * @param {string} poolId
   * @returns {Promise<object>} The driver pool shape.
   */
  async function arriveAtPool(actor, poolId) {
    return withTx(async (tx) => {
      const pool = await lockPoolForDriver(tx, actor.id, poolId);
      if (!pool) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Pool not found.');
      }
      if (pool.status === POOL_STATUSES.DRIVER_ARRIVED) {
        return buildDriverPoolResult(tx, actor.id, pool);
      }
      if (!canTransitionPool(pool.status, POOL_STATUSES.DRIVER_ARRIVED)) {
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This pool cannot arrive now.');
      }

      const members = await updateActiveMembersStatus(tx, pool.id, RIDE_STATUSES.DRIVER_ARRIVED);
      for (const member of members) {
        await insertRideEvent(tx, {
          rideRequestId: member.id,
          actorId: actor.id,
          poolId: pool.id,
          eventType: RIDE_EVENT_TYPES.DRIVER_ARRIVED,
        });
      }
      const updatedPool = await updatePoolStatus(tx, pool.id, POOL_STATUSES.DRIVER_ARRIVED);
      return buildDriverPoolResult(tx, actor.id, updatedPool);
    });
  }

  /**
   * Lock set: driver's pool, then the member's request and the remaining active members
   * (ascending id) — the driver-initiated counterpart of `acceptRide`'s member lock.
   * @param {{ id: string }} actor Driver.
   * @param {string} poolId
   * @param {string} rideId
   * @returns {Promise<object>} The driver pool shape.
   */
  async function noShowMember(actor, poolId, rideId) {
    return withTx(async (tx) => {
      const pool = await lockPoolForDriver(tx, actor.id, poolId);
      if (!pool) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Pool not found.');
      }

      const discoveredMemberIds = (await listActiveMembers(tx, pool.id)).map((m) => m.id);
      const idsToLock = [...new Set([rideId, ...discoveredMemberIds])];
      const lockedRows = await lockRequestsByIds(tx, idsToLock);
      const target = lockedRows.find((row) => row.id === rideId);
      if (!target) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Ride not found in this pool.');
      }

      const isStillActiveMember = await isActiveMemberOfPool(tx, pool.id, rideId);
      if (!isStillActiveMember) {
        if (
          target.status === RIDE_STATUSES.CANCELLED &&
          target.cancel_reason === 'PASSENGER_NO_SHOW'
        ) {
          return buildDriverPoolResult(tx, actor.id, pool);
        }
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This member is not in the pool.');
      }
      if (pool.status !== POOL_STATUSES.DRIVER_ARRIVED) {
        throw new AppError(
          ERROR_CODES.INVALID_STATE,
          409,
          'No-show is only allowed after arrival.',
        );
      }

      await markMemberLeft(tx, pool.id, rideId, LEFT_REASONS.PASSENGER_NO_SHOW);
      await markRideCancelledByDriver(tx, rideId, 'PASSENGER_NO_SHOW');
      await insertRideEvent(tx, {
        rideRequestId: rideId,
        actorId: actor.id,
        poolId: pool.id,
        eventType: RIDE_EVENT_TYPES.PASSENGER_NO_SHOW,
      });

      // No payment: no-show happens before start. Recompute quotes for whoever remains — since
      // canJoinPool guarantees the pool never had members outside a 3-unit window, removing one
      // never changes who is compatible with whom, only the discount tier.
      const remainingMembers = lockedRows.filter(
        (row) => row.id !== rideId && row.status === RIDE_STATUSES.DRIVER_ARRIVED,
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
              eventType: RIDE_EVENT_TYPES.QUOTE_UPDATED,
              metadata: { fromPaisa: member.quoted_fare_paisa, toPaisa: quotedFarePaisa },
            });
          }
        }
      } else {
        await updatePoolStatus(tx, pool.id, POOL_STATUSES.CANCELLED);
      }

      const finalPool = (await findPoolForDriver(tx, actor.id, pool.id)) ?? pool;
      return buildDriverPoolResult(tx, actor.id, finalPool);
    });
  }

  /**
   * Lock set: driver's pool only. Members return to REQUESTED with their quote kept.
   * @param {{ id: string }} actor Driver.
   * @param {string} poolId
   * @returns {Promise<object>} The driver pool shape.
   */
  async function cancelPool(actor, poolId) {
    return withTx(async (tx) => {
      const pool = await lockPoolForDriver(tx, actor.id, poolId);
      if (!pool) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Pool not found.');
      }
      if (pool.status === POOL_STATUSES.CANCELLED) {
        return buildDriverPoolResult(tx, actor.id, pool);
      }
      if (!canTransitionPool(pool.status, POOL_STATUSES.CANCELLED)) {
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This pool cannot be cancelled now.');
      }

      // Flip status to REQUESTED first, while pool_members.left_at is still NULL (this query
      // finds active members by that column); close the memberships after.
      const requeuedMembers = await updateActiveMembersStatus(tx, pool.id, RIDE_STATUSES.REQUESTED);
      await markAllActiveMembersLeft(tx, pool.id, LEFT_REASONS.DRIVER_CANCELLED_POOL);
      for (const member of requeuedMembers) {
        await insertRideEvent(tx, {
          rideRequestId: member.id,
          actorId: actor.id,
          poolId: pool.id,
          eventType: RIDE_EVENT_TYPES.REQUEUED,
        });
      }

      const updatedPool = await updatePoolStatus(tx, pool.id, POOL_STATUSES.CANCELLED);
      return buildDriverPoolResult(tx, actor.id, updatedPool);
    });
  }

  /**
   * Lock set: driver's pool only. Freezes fares into one payment row per member.
   * @param {{ id: string }} actor Driver.
   * @param {string} poolId
   * @returns {Promise<object>} The driver pool shape.
   */
  async function startPool(actor, poolId) {
    return withTx(async (tx) => {
      const pool = await lockPoolForDriver(tx, actor.id, poolId);
      if (!pool) {
        throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Pool not found.');
      }
      if (pool.status === POOL_STATUSES.STARTED) {
        return buildDriverPoolResult(tx, actor.id, pool);
      }
      if (!canTransitionPool(pool.status, POOL_STATUSES.STARTED)) {
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'This pool cannot start now.');
      }

      const members = await updateActiveMembersStatus(tx, pool.id, RIDE_STATUSES.STARTED);
      if (members.length === 0) {
        throw new AppError(ERROR_CODES.INVALID_STATE, 409, 'No passengers remain in this pool.');
      }

      const passengerCount = members.length;
      for (const member of members) {
        const uncappedFarePaisa = computeFare({
          soloFarePaisa: member.solo_fare_paisa,
          passengerCount,
        });
        await insertPayment(tx, {
          rideRequestId: member.id,
          poolId: pool.id,
          uncappedFarePaisa,
          finalFarePaisa: member.quoted_fare_paisa,
        });
        await insertRideEvent(tx, {
          rideRequestId: member.id,
          actorId: actor.id,
          poolId: pool.id,
          eventType: RIDE_EVENT_TYPES.STARTED,
        });
      }

      const updatedPool = await updatePoolStatus(tx, pool.id, POOL_STATUSES.STARTED);
      return buildDriverPoolResult(tx, actor.id, updatedPool);
    });
  }

  return { acceptRide, arriveAtPool, noShowMember, cancelPool, startPool };
}
