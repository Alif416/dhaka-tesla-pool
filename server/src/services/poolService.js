import { canAnchor, canJoinPool } from '../domain/compatibility.js';
import { COMPATIBILITY_CODES, RIDE_EVENT_TYPES, RIDE_STATUSES } from '../domain/constants.js';
import { computeFare, nextQuote } from '../domain/fare.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';
import { insertRideEvent } from '../repositories/rideEventRepository.js';
import {
  insertPool,
  insertPoolMember,
  isActiveMemberOfPool,
  listActiveMembers,
  listActiveMembersForDriverPool,
  lockActivePoolForVehicle,
  sumOccupiedSeats,
} from '../repositories/poolRepository.js';
import { lockRequestsByIds, markMatched, updateQuote } from '../repositories/rideRepository.js';
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

  return { acceptRide };
}
