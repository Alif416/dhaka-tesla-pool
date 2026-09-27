import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPool } from '../../src/db/client.js';
import {
  captureError,
  makePayment,
  makePool,
  makePoolMember,
  makeRideEvent,
  makeRideRequest,
  makeUser,
  makeVehicle,
  resetDb,
} from '../helpers/db.js';

const pool = createPool(process.env.TEST_DATABASE_URL);

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

describe('ride_requests constraints', () => {
  it.each(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'])(
    'rejects a second active ride for the same passenger while the first is %s',
    async (status) => {
      const passenger = await makeUser(pool);
      await makeRideRequest(pool, { passengerId: passenger.id, status });

      const error = await captureError(makeRideRequest(pool, { passengerId: passenger.id }));

      expect(error.code).toBe('23505');
      expect(error.constraint).toBe('ride_requests_one_active_per_passenger');
    },
  );

  it('allows a new ride after the previous one is COMPLETED or CANCELLED', async () => {
    const passenger = await makeUser(pool);
    await makeRideRequest(pool, { passengerId: passenger.id, status: 'COMPLETED' });
    await makeRideRequest(pool, {
      passengerId: passenger.id,
      status: 'CANCELLED',
      cancelReason: 'PASSENGER_CANCELLED',
    });

    const ride = await makeRideRequest(pool, { passengerId: passenger.id });

    expect(ride.status).toBe('REQUESTED');
  });

  it('rejects quoted_fare_paisa above solo_fare_paisa', async () => {
    const error = await captureError(makeRideRequest(pool, { quotedFarePaisa: 10001 }));

    expect(error.constraint).toBe('ride_requests_quoted_lte_solo');
  });

  it('rejects a CANCELLED ride without a cancel_reason', async () => {
    const error = await captureError(makeRideRequest(pool, { status: 'CANCELLED' }));

    expect(error.constraint).toBe('ride_requests_cancel_reason_matches_status');
  });

  it('rejects a cancel_reason on a ride that is not CANCELLED', async () => {
    const error = await captureError(
      makeRideRequest(pool, { cancelReason: 'PASSENGER_NO_SHOW', status: 'REQUESTED' }),
    );

    expect(error.constraint).toBe('ride_requests_cancel_reason_matches_status');
  });

  it('rejects pickup equal to destination', async () => {
    const error = await captureError(makeRideRequest(pool, { destinationZoneId: 1 }));

    expect(error.constraint).toBe('ride_requests_pickup_ne_destination');
  });
});

describe('pools constraints', () => {
  it('rejects a second active pool for one vehicle', async () => {
    const vehicle = await makeVehicle(pool);
    await makePool(pool, { vehicleId: vehicle.id });

    const error = await captureError(makePool(pool, { vehicleId: vehicle.id }));

    expect(error.code).toBe('23505');
    expect(error.constraint).toBe('pools_one_active_per_vehicle');
  });

  it('allows a new pool once the previous one is CANCELLED or COMPLETED', async () => {
    const vehicle = await makeVehicle(pool);
    await makePool(pool, { vehicleId: vehicle.id, status: 'CANCELLED' });
    await makePool(pool, { vehicleId: vehicle.id, status: 'COMPLETED' });

    const active = await makePool(pool, { vehicleId: vehicle.id });

    expect(active.status).toBe('ACCEPTED');
  });
});

describe('pool_members constraints', () => {
  it('rejects a duplicate active membership for one ride', async () => {
    const ride = await makeRideRequest(pool);
    const first = await makePool(pool);
    const second = await makePool(pool);
    await makePoolMember(pool, { poolId: first.id, rideRequestId: ride.id });

    const error = await captureError(
      makePoolMember(pool, { poolId: second.id, rideRequestId: ride.id }),
    );

    expect(error.code).toBe('23505');
    expect(error.constraint).toBe('pool_members_one_active_per_ride');
  });

  it('allows joining another pool after leaving the first', async () => {
    const ride = await makeRideRequest(pool);
    const first = await makePool(pool);
    const second = await makePool(pool);
    await makePoolMember(pool, { poolId: first.id, rideRequestId: ride.id, left: true });

    const member = await makePoolMember(pool, { poolId: second.id, rideRequestId: ride.id });

    expect(member.left_at).toBeNull();
  });

  it('rejects left_at without left_reason', async () => {
    const ride = await makeRideRequest(pool);
    const target = await makePool(pool);

    const error = await captureError(
      pool.query(
        'INSERT INTO pool_members (pool_id, ride_request_id, left_at) VALUES ($1, $2, now())',
        [target.id, ride.id],
      ),
    );

    expect(error.constraint).toBe('pool_members_left_pair');
  });
});

describe('payments constraints', () => {
  async function setUpRideAndPool() {
    const ride = await makeRideRequest(pool);
    const target = await makePool(pool);
    return { rideRequestId: ride.id, poolId: target.id };
  }

  it('rejects final_fare_paisa above uncapped_fare_paisa', async () => {
    const ids = await setUpRideAndPool();

    const error = await captureError(makePayment(pool, { ...ids, uncapped: 8500, final: 9000 }));

    expect(error.constraint).toBe('payments_final_lte_uncapped');
  });

  it('generates subsidy_paisa as uncapped minus final', async () => {
    const ids = await setUpRideAndPool();

    const payment = await makePayment(pool, { ...ids, uncapped: 9000, final: 8500 });

    expect(payment.subsidy_paisa).toBe(500);
  });

  it('rejects a direct write to subsidy_paisa', async () => {
    const ids = await setUpRideAndPool();
    const payment = await makePayment(pool, ids);

    const insertError = await captureError(
      pool.query(
        `INSERT INTO payments (ride_request_id, pool_id, uncapped_fare_paisa, final_fare_paisa, subsidy_paisa)
         VALUES ($1, $2, 100, 100, 5)`,
        [(await makeRideRequest(pool)).id, ids.poolId],
      ),
    );
    const updateError = await captureError(
      pool.query('UPDATE payments SET subsidy_paisa = 1 WHERE id = $1', [payment.id]),
    );

    expect(insertError.code).toBe('428C9');
    expect(updateError.code).toBe('428C9');
  });

  it('rejects a second payment for the same ride', async () => {
    const ids = await setUpRideAndPool();
    await makePayment(pool, ids);

    const error = await captureError(makePayment(pool, ids));

    expect(error.constraint).toBe('payments_ride_request_id_key');
  });
});

describe('ride_events append-only trigger', () => {
  async function makeEvent() {
    const actor = await makeUser(pool);
    const ride = await makeRideRequest(pool, { passengerId: actor.id });
    return makeRideEvent(pool, { rideRequestId: ride.id, actorId: actor.id });
  }

  it('rejects UPDATE on ride_events', async () => {
    const event = await makeEvent();

    const error = await captureError(
      pool.query("UPDATE ride_events SET event_type = 'MATCHED' WHERE id = $1", [event.id]),
    );

    expect(error.message).toMatch(/append-only/);
  });

  it('rejects DELETE on ride_events', async () => {
    const event = await makeEvent();

    const error = await captureError(
      pool.query('DELETE FROM ride_events WHERE id = $1', [event.id]),
    );

    expect(error.message).toMatch(/append-only/);
  });
});

describe('users, vehicles and zone_distances constraints', () => {
  it('rejects an email that is not lowercase', async () => {
    const error = await captureError(makeUser(pool, { email: 'Nusrat@Example.com' }));

    expect(error.constraint).toBe('users_email_lowercase');
  });

  it('rejects a vehicle with zero capacity', async () => {
    const error = await captureError(makeVehicle(pool, { capacity: 0 }));

    expect(error.constraint).toBe('vehicles_capacity_positive');
  });

  it('rejects a distance pair where from_zone_id is not below to_zone_id', async () => {
    const error = await captureError(
      pool.query(
        'INSERT INTO zone_distances (from_zone_id, to_zone_id, distance_units) VALUES (7, 3, 4)',
      ),
    );

    expect(error.constraint).toBe('zone_distances_pair_order');
  });
});
