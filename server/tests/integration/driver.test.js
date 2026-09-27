import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import {
  makeDriverWithVehicle,
  makePool,
  makePoolMember,
  makeRideRequest,
  resetDb,
} from '../helpers/db.js';

const { app, pool } = await buildTestApp();

afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

const BANANI = 1;
const GULSHAN_1 = 2;
const MOHAKHALI = 3;
const DHANMONDI = 6;

async function loginAs(email, password) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  return response.headers['set-cookie'][0];
}

async function registerAndLoginPassenger(email) {
  await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse', name: 'Passenger' });
  return loginAs(email, 'correct-horse');
}

describe('POST /api/driver/online and /offline', () => {
  it('goes online then offline, and each repeats idempotently with 200', async () => {
    const { driver } = await makeDriverWithVehicle(pool, { email: 'd1@test.example.com' });
    const cookie = await loginAs(driver.email, driver.password);

    const online = await request(app).post('/api/driver/online').set('Cookie', cookie);
    const onlineAgain = await request(app).post('/api/driver/online').set('Cookie', cookie);
    const offline = await request(app).post('/api/driver/offline').set('Cookie', cookie);
    const offlineAgain = await request(app).post('/api/driver/offline').set('Cookie', cookie);

    expect(online.status).toBe(200);
    expect(online.body.online).toBe(true);
    expect(onlineAgain.status).toBe(200);
    expect(offline.status).toBe(200);
    expect(offline.body.online).toBe(false);
    expect(offlineAgain.status).toBe(200);
  });

  it('rejects going offline while a pool is active', async () => {
    const { driver, vehicle } = await makeDriverWithVehicle(pool, {
      email: 'd2@test.example.com',
      online: true,
    });
    await makePool(pool, { vehicleId: vehicle.id, status: 'ACCEPTED' });
    const cookie = await loginAs(driver.email, driver.password);

    const response = await request(app).post('/api/driver/offline').set('Cookie', cookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('POOL_ACTIVE');
  });

  it('is forbidden for a passenger', async () => {
    const cookie = await registerAndLoginPassenger('passenger-online@test.example.com');

    const response = await request(app).post('/api/driver/online').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });
});

describe('GET /api/driver/requests', () => {
  it('returns 409 DRIVER_OFFLINE while offline', async () => {
    const { driver } = await makeDriverWithVehicle(pool, {
      email: 'd3@test.example.com',
      online: false,
    });
    const cookie = await loginAs(driver.email, driver.password);

    const response = await request(app).get('/api/driver/requests').set('Cookie', cookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DRIVER_OFFLINE');
  });

  it('with no pool: includes a cross-corridor request, excludes seats above capacity, oldest first', async () => {
    const { driver } = await makeDriverWithVehicle(pool, {
      email: 'd4@test.example.com',
      online: true,
      capacity: 3,
    });
    const cookie = await loginAs(driver.email, driver.password);

    const older = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 1,
    });
    const crossCorridor = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: DHANMONDI,
      seats: 1,
      distanceUnits: 8,
      soloFarePaisa: 20000,
      quotedFarePaisa: 20000,
    });
    const tooManySeats = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
      seats: 4,
      soloFarePaisa: 32000,
      quotedFarePaisa: 32000,
    });
    const response = await request(app).get('/api/driver/requests').set('Cookie', cookie);

    expect(response.status).toBe(200);
    const ids = response.body.map((row) => row.id);
    expect(ids).toContain(older.id);
    expect(ids).toContain(crossCorridor.id);
    expect(ids).not.toContain(tooManySeats.id);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(crossCorridor.id));
    expect(response.body[0]).toMatchObject({
      passenger: { name: 'Test User' },
      pickup: 'Banani',
      seats: 1,
    });
  });

  it('with an ACCEPTED pool: lists only requests that fit the remaining seats and compatibility', async () => {
    const { driver, vehicle } = await makeDriverWithVehicle(pool, {
      email: 'd5@test.example.com',
      online: true,
      capacity: 3,
    });
    const cookie = await loginAs(driver.email, driver.password);
    const memberRide = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 1,
      status: 'MATCHED',
    });
    const driverPool = await makePool(pool, { vehicleId: vehicle.id, status: 'ACCEPTED' });
    await makePoolMember(pool, { poolId: driverPool.id, rideRequestId: memberRide.id });

    const compatible = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
      seats: 1,
    });
    const wrongDirection = await makeRideRequest(pool, {
      pickupZoneId: MOHAKHALI,
      destinationZoneId: BANANI,
      seats: 1,
    });
    const tooManySeats = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
      seats: 3,
    });

    const response = await request(app).get('/api/driver/requests').set('Cookie', cookie);

    const ids = response.body.map((row) => row.id);
    expect(ids).toEqual([compatible.id]);
    expect(ids).not.toContain(wrongDirection.id);
    expect(ids).not.toContain(tooManySeats.id);
  });

  it('with a DRIVER_ARRIVED or STARTED pool: returns an empty list', async () => {
    const { driver, vehicle } = await makeDriverWithVehicle(pool, {
      email: 'd6@test.example.com',
      online: true,
    });
    const cookie = await loginAs(driver.email, driver.password);
    await makePool(pool, { vehicleId: vehicle.id, status: 'DRIVER_ARRIVED' });
    await makeRideRequest(pool, { pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 });

    const response = await request(app).get('/api/driver/requests').set('Cookie', cookie);

    expect(response.body).toEqual([]);
  });

  it('never writes: row counts and updated_at are unchanged after listing', async () => {
    const { driver } = await makeDriverWithVehicle(pool, {
      email: 'd7@test.example.com',
      online: true,
    });
    const cookie = await loginAs(driver.email, driver.password);
    const ride = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 1,
    });

    await request(app).get('/api/driver/requests').set('Cookie', cookie);

    const { rows } = await pool.query(
      'SELECT status, updated_at FROM ride_requests WHERE id = $1',
      [ride.id],
    );
    expect(rows[0].status).toBe('REQUESTED');
    expect(rows[0].updated_at).toEqual(ride.updated_at);
    const countAfter = await pool.query('SELECT count(*)::int AS n FROM pools');
    expect(countAfter.rows[0].n).toBe(0);
  });

  it('is forbidden for a passenger', async () => {
    const cookie = await registerAndLoginPassenger('passenger-requests@test.example.com');

    const response = await request(app).get('/api/driver/requests').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });
});

describe('GET /api/driver/pool', () => {
  it('returns null with no active pool', async () => {
    const { driver } = await makeDriverWithVehicle(pool, {
      email: 'd8@test.example.com',
      online: true,
    });
    const cookie = await loginAs(driver.email, driver.password);

    const response = await request(app).get('/api/driver/pool').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });

  it('returns the full pool shape with members when one exists', async () => {
    const { driver, vehicle } = await makeDriverWithVehicle(pool, {
      email: 'd9@test.example.com',
      online: true,
      capacity: 3,
    });
    const cookie = await loginAs(driver.email, driver.password);
    const memberRide = await makeRideRequest(pool, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 1,
      status: 'MATCHED',
    });
    const driverPool = await makePool(pool, { vehicleId: vehicle.id, status: 'ACCEPTED' });
    await makePoolMember(pool, { poolId: driverPool.id, rideRequestId: memberRide.id });

    const response = await request(app).get('/api/driver/pool').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: driverPool.id,
      status: 'ACCEPTED',
      occupiedSeats: 1,
      capacity: 3,
      vehicle: { name: 'Test Tesla' },
    });
    expect(response.body.members).toHaveLength(1);
    expect(response.body.members[0]).toMatchObject({
      rideId: memberRide.id,
      pickup: 'Banani',
      destination: 'Mohakhali',
      seats: 1,
      status: 'MATCHED',
      fare: { amountPaisa: 10000, kind: 'ESTIMATE' },
    });
  });

  it("never exposes another driver's pool", async () => {
    const { vehicle: otherVehicle } = await makeDriverWithVehicle(pool, {
      email: 'other-driver@test.example.com',
    });
    await makePool(pool, { vehicleId: otherVehicle.id, status: 'ACCEPTED' });
    const { driver } = await makeDriverWithVehicle(pool, {
      email: 'd10@test.example.com',
      online: true,
    });
    const cookie = await loginAs(driver.email, driver.password);

    const response = await request(app).get('/api/driver/pool').set('Cookie', cookie);

    expect(response.body).toBeNull();
  });

  it('is forbidden for a passenger', async () => {
    const cookie = await registerAndLoginPassenger('passenger-pool@test.example.com');

    const response = await request(app).get('/api/driver/pool').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });
});
