import { describe, expect, it } from 'vitest';

import { COMPATIBILITY_CODES, POOL_STATUSES, RIDE_STATUSES } from '../../src/domain/constants.js';
import { canAnchor, canJoinPool } from '../../src/domain/compatibility.js';

const BANANI = { id: 1, corridor: 'NORTH', position: 10 };
const GULSHAN_1 = { id: 2, corridor: 'NORTH', position: 12 };
const MOHAKHALI = { id: 3, corridor: 'NORTH', position: 13 };
const DHANMONDI = { id: 6, corridor: 'WEST', position: 10 };

function request({
  pickupZone = BANANI,
  destinationZone,
  seats = 1,
  status = RIDE_STATUSES.REQUESTED,
}) {
  return { status, seats, pickupZone, destinationZone };
}

const nusrat = request({ destinationZone: MOHAKHALI }); // Banani -> Mohakhali, gap-from-Rafiq 1
const rafiq = request({ destinationZone: GULSHAN_1 }); // Banani -> Gulshan 1

describe('canJoinPool', () => {
  it('accepts Nusrat and Rafiq together (same pickup, same direction, gap 1)', () => {
    const result = canJoinPool({
      candidate: rafiq,
      members: [nusrat],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects the opposite direction', () => {
    const oppositeDirection = request({ pickupZone: MOHAKHALI, destinationZone: BANANI });

    const result = canJoinPool({
      candidate: oppositeDirection,
      members: [nusrat],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 1,
    });

    expect(result).toEqual({ ok: false, code: COMPATIBILITY_CODES.INCOMPATIBLE });
  });

  it('rejects a destination gap greater than 3', () => {
    const tooFar = request({ destinationZone: { id: 9, corridor: 'NORTH', position: 17 } }); // gap 4 from Mohakhali (13)

    const result = canJoinPool({
      candidate: tooFar,
      members: [nusrat],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 1,
    });

    expect(result).toEqual({ ok: false, code: COMPATIBILITY_CODES.INCOMPATIBLE });
  });

  it('rejects the chain case: A fits B, B fits C, but A does not fit C', () => {
    const a = request({ destinationZone: { id: 10, corridor: 'NORTH', position: 11 } });
    const b = request({ destinationZone: { id: 11, corridor: 'NORTH', position: 13 } }); // gap 2 from a
    const c = request({ destinationZone: { id: 12, corridor: 'NORTH', position: 15 } }); // gap 2 from b, gap 4 from a

    const bJoinsA = canJoinPool({
      candidate: b,
      members: [a],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 1,
    });
    const cJoinsAAndB = canJoinPool({
      candidate: c,
      members: [a, b],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 2,
    });

    expect(bJoinsA).toEqual({ ok: true });
    expect(cJoinsAAndB).toEqual({ ok: false, code: COMPATIBILITY_CODES.INCOMPATIBLE });
  });

  it('rejects a cross-corridor candidate even if seats and status are fine', () => {
    const crossCorridor = request({ destinationZone: DHANMONDI });

    const result = canJoinPool({
      candidate: crossCorridor,
      members: [],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 0,
    });

    expect(result).toEqual({ ok: false, code: COMPATIBILITY_CODES.INCOMPATIBLE });
  });

  it('rejects when the pool is not ACCEPTED', () => {
    const result = canJoinPool({
      candidate: rafiq,
      members: [nusrat],
      capacity: 3,
      poolStatus: POOL_STATUSES.DRIVER_ARRIVED,
      occupiedSeats: 1,
    });

    expect(result).toEqual({ ok: false, code: COMPATIBILITY_CODES.POOL_CLOSED });
  });

  it('rejects when there is not enough capacity, including a 2-seat booking against 1 free seat', () => {
    const twoSeats = request({ destinationZone: GULSHAN_1, seats: 2 });

    const result = canJoinPool({
      candidate: twoSeats,
      members: [nusrat],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 2,
    });

    expect(result).toEqual({ ok: false, code: COMPATIBILITY_CODES.POOL_FULL });
  });

  it('rejects a candidate that is not REQUESTED', () => {
    const alreadyMatched = { ...rafiq, status: RIDE_STATUSES.MATCHED };

    const result = canJoinPool({
      candidate: alreadyMatched,
      members: [nusrat],
      capacity: 3,
      poolStatus: POOL_STATUSES.ACCEPTED,
      occupiedSeats: 1,
    });

    expect(result).toEqual({ ok: false, code: COMPATIBILITY_CODES.REQUEST_UNAVAILABLE });
  });
});

describe('canAnchor', () => {
  it('accepts a REQUESTED candidate that fits within capacity', () => {
    expect(canAnchor({ candidate: nusrat, capacity: 3 })).toEqual({ ok: true });
  });

  it('accepts a cross-corridor candidate (solo-only, but can anchor)', () => {
    const crossCorridor = request({ destinationZone: DHANMONDI });

    expect(canAnchor({ candidate: crossCorridor, capacity: 3 })).toEqual({ ok: true });
  });

  it('rejects seats above capacity', () => {
    const tooManySeats = request({ destinationZone: MOHAKHALI, seats: 4 });

    expect(canAnchor({ candidate: tooManySeats, capacity: 3 })).toEqual({
      ok: false,
      code: COMPATIBILITY_CODES.EXCEEDS_CAPACITY,
    });
  });

  it('rejects a candidate that is not REQUESTED', () => {
    const cancelled = { ...nusrat, status: RIDE_STATUSES.CANCELLED };

    expect(canAnchor({ candidate: cancelled, capacity: 3 })).toEqual({
      ok: false,
      code: COMPATIBILITY_CODES.REQUEST_UNAVAILABLE,
    });
  });
});
