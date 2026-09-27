import {
  COMPATIBILITY_CODES,
  MAX_DESTINATION_GAP,
  POOL_STATUSES,
  RIDE_STATUSES,
} from './constants.js';
import { direction, isPoolable } from './geography.js';

/**
 * @typedef {object} PoolCandidate
 * @property {string} status Ride status of the candidate request.
 * @property {number} seats
 * @property {{ id: number, corridor: string, position: number }} pickupZone
 * @property {{ id: number, corridor: string, position: number }} destinationZone
 */

function fails(code) {
  return { ok: false, code };
}

const ok = Object.freeze({ ok: true });

/**
 * Whether a candidate request is compatible with every active member of an existing pool.
 * Checks every member, not just one, so no pool can grow outside a single 3-unit window.
 * @param {{ candidate: PoolCandidate, members: PoolCandidate[], capacity: number,
 *   poolStatus: string, occupiedSeats: number }} input
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function canJoinPool({ candidate, members, capacity, poolStatus, occupiedSeats }) {
  if (candidate.status !== RIDE_STATUSES.REQUESTED) {
    return fails(COMPATIBILITY_CODES.REQUEST_UNAVAILABLE);
  }
  if (poolStatus !== POOL_STATUSES.ACCEPTED) {
    return fails(COMPATIBILITY_CODES.POOL_CLOSED);
  }
  if (occupiedSeats + candidate.seats > capacity) {
    return fails(COMPATIBILITY_CODES.POOL_FULL);
  }
  if (!isPoolable(candidate.pickupZone, candidate.destinationZone)) {
    return fails(COMPATIBILITY_CODES.INCOMPATIBLE);
  }
  const candidateDirection = direction(candidate.pickupZone, candidate.destinationZone);
  for (const member of members) {
    const samePickup = member.pickupZone.id === candidate.pickupZone.id;
    const sameDirection =
      direction(member.pickupZone, member.destinationZone) === candidateDirection;
    const gap = Math.abs(candidate.destinationZone.position - member.destinationZone.position);
    if (!samePickup || !sameDirection || gap > MAX_DESTINATION_GAP) {
      return fails(COMPATIBILITY_CODES.INCOMPATIBLE);
    }
  }
  return ok;
}

/**
 * Whether a candidate request can anchor a brand new pool (no pool exists yet).
 * @param {{ candidate: PoolCandidate, capacity: number }} input
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
export function canAnchor({ candidate, capacity }) {
  if (candidate.status !== RIDE_STATUSES.REQUESTED) {
    return fails(COMPATIBILITY_CODES.REQUEST_UNAVAILABLE);
  }
  if (candidate.seats > capacity) {
    return fails(COMPATIBILITY_CODES.EXCEEDS_CAPACITY);
  }
  return ok;
}
