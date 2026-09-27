import { canAnchor, canJoinPool } from '../domain/compatibility.js';
import { RIDE_STATUSES } from '../domain/constants.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';
import {
  findActivePoolForDriver,
  listActiveMembersForDriverPool,
  listAllMembersForDriverPool,
  listPoolHistoryForDriver,
  sumOccupiedSeats,
} from '../repositories/poolRepository.js';
import { listOpenRequestsForDriver } from '../repositories/rideRepository.js';
import {
  findVehicleForDriver,
  lockVehicleForDriver,
  setOnlineForDriver,
} from '../repositories/vehicleRepository.js';
import { toCandidateShape } from './zoneService.js';

function candidateRowToShape(row) {
  return toCandidateShape({
    status: RIDE_STATUSES.REQUESTED,
    seats: row.seats,
    pickupZoneId: row.pickup_zone_id,
    destinationZoneId: row.destination_zone_id,
  });
}

function memberRowToShape(member) {
  return toCandidateShape({
    status: member.ride_status,
    seats: member.seats,
    pickupZoneId: member.pickup_zone_id,
    destinationZoneId: member.destination_zone_id,
  });
}

/**
 * Builds the driver service bound to one transaction runner.
 * @param {{ withTx: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }} deps
 * @returns {object}
 */
export function createDriverService({ withTx }) {
  /**
   * Lock set: vehicle only.
   * @param {{ id: string }} actor
   * @returns {Promise<object>} The driver's vehicle.
   */
  async function goOnline(actor) {
    return withTx(async (tx) => {
      const vehicle = await lockVehicleForDriver(tx, actor.id);
      if (vehicle.online) {
        return vehicle;
      }
      return setOnlineForDriver(tx, actor.id, true);
    });
  }

  /**
   * Lock set: vehicle only.
   * @param {{ id: string }} actor
   * @returns {Promise<object>} The driver's vehicle.
   */
  async function goOffline(actor) {
    return withTx(async (tx) => {
      const vehicle = await lockVehicleForDriver(tx, actor.id);
      if (!vehicle.online) {
        return vehicle;
      }
      const activePool = await findActivePoolForDriver(tx, actor.id);
      if (activePool) {
        throw new AppError(
          ERROR_CODES.POOL_ACTIVE,
          409,
          'Finish or cancel your current pool first.',
        );
      }
      return setOnlineForDriver(tx, actor.id, false);
    });
  }

  /**
   * Advisory list of requests the driver could accept or add right now. Never reserves
   * anything; the list and accept (unit 07) share the same compatibility functions.
   * @param {{ id: string }} actor
   * @returns {Promise<object[]>} Raw candidate rows, for the serializer to shape.
   */
  async function listRequests(actor) {
    return withTx(async (tx) => {
      const vehicle = await findVehicleForDriver(tx, actor.id);
      if (!vehicle.online) {
        throw new AppError(ERROR_CODES.DRIVER_OFFLINE, 409, 'Go online first.');
      }

      const pool = await findActivePoolForDriver(tx, actor.id);

      if (!pool) {
        const candidates = await listOpenRequestsForDriver(tx, actor.id, {
          maxSeats: vehicle.capacity,
        });
        return candidates.filter(
          (candidate) =>
            canAnchor({
              candidate: candidateRowToShape(candidate),
              capacity: vehicle.capacity,
            }).ok,
        );
      }

      if (pool.status !== 'ACCEPTED') {
        return [];
      }

      const members = await listActiveMembersForDriverPool(tx, actor.id, pool.id);
      const occupiedSeats = await sumOccupiedSeats(tx, pool.id);
      const candidates = await listOpenRequestsForDriver(tx, actor.id, {
        pickupZoneId: members[0].pickup_zone_id,
        maxSeats: vehicle.capacity - occupiedSeats,
      });
      const memberCandidates = members.map(memberRowToShape);

      return candidates.filter(
        (candidate) =>
          canJoinPool({
            candidate: candidateRowToShape(candidate),
            members: memberCandidates,
            capacity: vehicle.capacity,
            poolStatus: pool.status,
            occupiedSeats,
          }).ok,
      );
    });
  }

  /**
   * @param {{ id: string }} actor
   * @returns {Promise<{ pool: object | null, vehicle: object, members: object[],
   *   occupiedSeats: number }>}
   */
  async function getCurrentPool(actor) {
    return withTx(async (tx) => {
      const vehicle = await findVehicleForDriver(tx, actor.id);
      const pool = await findActivePoolForDriver(tx, actor.id);
      if (!pool) {
        return { pool: null, vehicle, members: [], occupiedSeats: 0 };
      }
      const members = await listActiveMembersForDriverPool(tx, actor.id, pool.id);
      const occupiedSeats = await sumOccupiedSeats(tx, pool.id);
      return { pool, vehicle, members, occupiedSeats };
    });
  }

  /**
   * Past pools (COMPLETED or CANCELLED), newest first, each with every member it ever had and
   * their final fare and payment status.
   * @param {{ id: string }} actor
   * @returns {Promise<{ pool: object, vehicle: object, members: object[],
   *   occupiedSeats: number }[]>}
   */
  async function getHistory(actor) {
    return withTx(async (tx) => {
      const vehicle = await findVehicleForDriver(tx, actor.id);
      const pastPools = await listPoolHistoryForDriver(tx, actor.id);
      const result = [];
      for (const pastPool of pastPools) {
        const members = await listAllMembersForDriverPool(tx, actor.id, pastPool.id);
        const occupiedSeats = members.reduce((sum, member) => sum + member.seats, 0);
        result.push({ pool: pastPool, vehicle, members, occupiedSeats });
      }
      return result;
    });
  }

  return { goOnline, goOffline, listRequests, getCurrentPool, getHistory };
}
