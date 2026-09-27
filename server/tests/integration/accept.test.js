import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import { makeDriverWithVehicle, makePool, resetDb } from '../helpers/db.js';

const { app, pool } = await buildTestApp();

afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

const BANANI = 1;
const GULSHAN_1 = 2;
const MOHAKHALI = 3;

async function loginAs(email, password) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  return response.headers['set-cookie'][0];
}

async function registerAndLoginPassenger(email) {
  await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse', name: email.split('@')[0] });
  return loginAs(email, 'correct-horse');
}

async function onlineDriver(email, { capacity = 3, name } = {}) {
  await makeDriverWithVehicle(pool, { email, capacity, online: true, name });
  return loginAs(email, 'driver-test-password');
}

async function requestRide(cookie, { pickupZoneId, destinationZoneId, seats = 1 }) {
  const response = await request(app)
    .post('/api/rides')
    .send({ pickupZoneId, destinationZoneId, seats })
    .set('Cookie', cookie);
  return response.body;
}

function accept(rideId, driverCookie) {
  return request(app).post(`/api/rides/${rideId}/accept`).set('Cookie', driverCookie);
}

describe('POST /api/rides/:id/accept — happy path (demo steps 2 to 4)', () => {
  it('creates a pool on the first accept, then adds a compatible request with recomputed quotes', async () => {
    const driverCookie = await onlineDriver('jashim@test.example.com', { name: 'Jashim' });
    const nusratCookie = await registerAndLoginPassenger('nusrat@test.example.com');
    const rafiqCookie = await registerAndLoginPassenger('rafiq@test.example.com');

    const nusratRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    expect(nusratRide.fare.amountPaisa).toBe(10000);

    const firstAccept = await accept(nusratRide.id, driverCookie);
    expect(firstAccept.status).toBe(200);
    expect(firstAccept.body.status).toBe('ACCEPTED');
    expect(firstAccept.body.occupiedSeats).toBe(1);
    expect(firstAccept.body.members).toHaveLength(1);
    expect(firstAccept.body.members[0].fare).toEqual({ amountPaisa: 10000, kind: 'ESTIMATE' });

    const nusratAfterAccept = await request(app)
      .get(`/api/rides/${nusratRide.id}`)
      .set('Cookie', nusratCookie);
    expect(nusratAfterAccept.body.status).toBe('MATCHED');
    expect(nusratAfterAccept.body.driver).toEqual({ name: 'Jashim' });
    expect(nusratAfterAccept.body.vehicle).toEqual({
      name: 'Test Tesla',
      registrationNo: expect.any(String),
    });
    expect(nusratAfterAccept.body.sharedPassengerCount).toBe(0);
    expect(nusratAfterAccept.body.fare).toEqual({ amountPaisa: 10000, kind: 'ESTIMATE' });

    const rafiqRide = await requestRide(rafiqCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    expect(rafiqRide.fare.amountPaisa).toBe(8000);

    const secondAccept = await accept(rafiqRide.id, driverCookie);
    expect(secondAccept.status).toBe(200);
    expect(secondAccept.body.occupiedSeats).toBe(2);
    const amounts = secondAccept.body.members.map((m) => m.fare.amountPaisa).sort((a, b) => a - b);
    expect(amounts).toEqual([7200, 9000]);

    const nusratAfterAdd = await request(app)
      .get(`/api/rides/${nusratRide.id}`)
      .set('Cookie', nusratCookie);
    expect(nusratAfterAdd.body.fare.amountPaisa).toBe(9000);
    expect(nusratAfterAdd.body.sharedPassengerCount).toBe(1);
    expect(nusratAfterAdd.body.timeline.map((event) => event.type)).toEqual([
      'REQUESTED',
      'MATCHED',
      'QUOTE_UPDATED',
    ]);
    // Leak check: Nusrat's own JSON never mentions the other passenger.
    expect(JSON.stringify(nusratAfterAdd.body)).not.toMatch(/rafiq/i);

    const rafiqAfterAdd = await request(app)
      .get(`/api/rides/${rafiqRide.id}`)
      .set('Cookie', rafiqCookie);
    expect(rafiqAfterAdd.body.fare.amountPaisa).toBe(7200);
    expect(rafiqAfterAdd.body.sharedPassengerCount).toBe(1);
    expect(JSON.stringify(rafiqAfterAdd.body)).not.toMatch(/nusrat/i);
  });

  it('repeats idempotently: accepting the same ride twice returns 200 both times with one membership', async () => {
    const driverCookie = await onlineDriver('idem-driver@test.example.com');
    const candidateCookie = await registerAndLoginPassenger('idem-candidate@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });

    const first = await accept(candidate.id, driverCookie);
    const second = await accept(candidate.id, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM pool_members WHERE ride_request_id = $1',
      [candidate.id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('POST /api/rides/:id/accept — every 409 code', () => {
  it('DRIVER_OFFLINE: driver is offline', async () => {
    await makeDriverWithVehicle(pool, { email: 'offline@test.example.com', online: false });
    const driverCookie = await loginAs('offline@test.example.com', 'driver-test-password');
    const candidateCookie = await registerAndLoginPassenger('offline-candidate@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });

    const response = await accept(candidate.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DRIVER_OFFLINE');
  });

  it("REQUEST_UNAVAILABLE: the request is already matched into another driver's pool", async () => {
    const driverACookie = await onlineDriver('driver-a@test.example.com');
    const driverBCookie = await onlineDriver('driver-b@test.example.com');
    const candidateCookie = await registerAndLoginPassenger('contested-candidate@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await accept(candidate.id, driverACookie);

    const response = await accept(candidate.id, driverBCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REQUEST_UNAVAILABLE');
  });

  it('POOL_CLOSED: the pool has already arrived (built directly; no arrive endpoint yet)', async () => {
    const { vehicle } = await makeDriverWithVehicle(pool, {
      email: 'closed-driver@test.example.com',
      online: true,
    });
    const driverCookie = await loginAs('closed-driver@test.example.com', 'driver-test-password');
    await makePool(pool, { vehicleId: vehicle.id, status: 'DRIVER_ARRIVED' });
    const candidateCookie = await registerAndLoginPassenger('closed-candidate@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });

    const response = await accept(candidate.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('POOL_CLOSED');
  });

  it('POOL_FULL: not enough seats remain', async () => {
    const driverCookie = await onlineDriver('full-driver@test.example.com', { capacity: 2 });
    const firstCookie = await registerAndLoginPassenger('full-first@test.example.com');
    const firstRide = await requestRide(firstCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 2,
    });
    await accept(firstRide.id, driverCookie);
    const secondCookie = await registerAndLoginPassenger('full-second@test.example.com');
    const secondRide = await requestRide(secondCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
      seats: 1,
    });

    const response = await accept(secondRide.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('POOL_FULL');
  });

  it('INCOMPATIBLE: opposite direction from the existing member', async () => {
    const driverCookie = await onlineDriver('incompat-driver@test.example.com');
    const memberCookie = await registerAndLoginPassenger('incompat-member@test.example.com');
    const memberRide = await requestRide(memberCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await accept(memberRide.id, driverCookie);
    const candidateCookie = await registerAndLoginPassenger('incompat-candidate@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: MOHAKHALI,
      destinationZoneId: BANANI,
    });

    const response = await accept(candidate.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INCOMPATIBLE');
  });

  it('EXCEEDS_CAPACITY: no pool yet, seats above the vehicle capacity', async () => {
    const driverCookie = await onlineDriver('exceeds-driver@test.example.com', { capacity: 1 });
    const candidateCookie = await registerAndLoginPassenger('exceeds-candidate@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 2,
    });

    const response = await accept(candidate.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EXCEEDS_CAPACITY');
  });
});

describe('POST /api/rides/:id/accept — authorization', () => {
  it('returns 404 for an unknown ride', async () => {
    const driverCookie = await onlineDriver('driver404@test.example.com');

    const response = await accept('00000000-0000-0000-0000-000000000000', driverCookie);

    expect(response.status).toBe(404);
  });

  it('returns 403 for a passenger', async () => {
    const passengerCookie = await registerAndLoginPassenger('passenger-accept@test.example.com');
    const ride = await requestRide(passengerCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });

    const response = await accept(ride.id, passengerCookie);

    expect(response.status).toBe(403);
  });
});
