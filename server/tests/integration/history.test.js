import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import { makeDriverWithVehicle, resetDb } from '../helpers/db.js';

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

async function onlineDriver(email, capacity = 3) {
  await makeDriverWithVehicle(pool, { email, capacity, online: true, name: 'Jashim' });
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

function arrive(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/arrive`).set('Cookie', driverCookie);
}

function start(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/start`).set('Cookie', driverCookie);
}

function cancelPool(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/cancel`).set('Cookie', driverCookie);
}

function completeAsPassenger(rideId, cookie) {
  return request(app).post(`/api/rides/${rideId}/complete`).set('Cookie', cookie);
}

function getDriverHistory(driverCookie) {
  return request(app).get('/api/driver/history').set('Cookie', driverCookie);
}

function getRide(rideId, cookie) {
  return request(app).get(`/api/rides/${rideId}`).set('Cookie', cookie);
}

function listRides(cookie) {
  return request(app).get('/api/rides').set('Cookie', cookie);
}

describe('GET /api/driver/history', () => {
  it('lists a completed pool with members, final fares and payment status', async () => {
    const driverEmail = 'history-completed@test.example.com';
    const driverCookie = await onlineDriver(driverEmail);
    const nusratCookie = await registerAndLoginPassenger('history-nusrat@test.example.com');
    const nusratRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const acceptResponse = await accept(nusratRide.id, driverCookie);
    const poolId = acceptResponse.body.id;
    await arrive(poolId, driverCookie);
    await start(poolId, driverCookie);
    await completeAsPassenger(nusratRide.id, nusratCookie);

    const response = await getDriverHistory(driverCookie);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: poolId, status: 'COMPLETED' });
    expect(response.body[0].members).toHaveLength(1);
    expect(response.body[0].members[0]).toMatchObject({
      rideId: nusratRide.id,
      passenger: { name: 'history-nusrat' },
      status: 'COMPLETED',
      fare: { amountPaisa: 10000, kind: 'FINAL' },
    });
  });

  it('lists a cancelled pool too, newest first', async () => {
    const driverEmail = 'history-order@test.example.com';
    const driverCookie = await onlineDriver(driverEmail);

    const firstCookie = await registerAndLoginPassenger('history-order-first@test.example.com');
    const firstRide = await requestRide(firstCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const firstAccept = await accept(firstRide.id, driverCookie);
    await cancelPool(firstAccept.body.id, driverCookie);

    const secondCookie = await registerAndLoginPassenger('history-order-second@test.example.com');
    const secondRide = await requestRide(secondCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    const secondAccept = await accept(secondRide.id, driverCookie);
    await cancelPool(secondAccept.body.id, driverCookie);

    const response = await getDriverHistory(driverCookie);

    expect(response.body).toHaveLength(2);
    expect(response.body.map((p) => p.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(response.body[0].id).toBe(secondAccept.body.id); // newest first
    expect(response.body[1].id).toBe(firstAccept.body.id);
  });

  it("never shows another driver's pools", async () => {
    const driverAEmail = 'history-a@test.example.com';
    const driverACookie = await onlineDriver(driverAEmail);
    const passengerCookie = await registerAndLoginPassenger('history-a-passenger@test.example.com');
    const ride = await requestRide(passengerCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const acceptResponse = await accept(ride.id, driverACookie);
    await cancelPool(acceptResponse.body.id, driverACookie);

    const driverBCookie = await onlineDriver('history-b@test.example.com');
    const response = await getDriverHistory(driverBCookie);

    expect(response.body).toEqual([]);
  });

  it('is forbidden for a passenger', async () => {
    const cookie = await registerAndLoginPassenger('history-403@test.example.com');

    const response = await getDriverHistory(cookie);

    expect(response.status).toBe(403);
  });
});

describe('GET /api/rides (passenger history)', () => {
  it('lists current and past rides, each with its own timeline', async () => {
    const driverCookie = await onlineDriver('phistory-driver@test.example.com');
    const nusratCookie = await registerAndLoginPassenger('phistory-nusrat@test.example.com');

    const firstRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await request(app).post(`/api/rides/${firstRide.id}/cancel`).set('Cookie', nusratCookie);
    const secondRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    await accept(secondRide.id, driverCookie);

    const response = await listRides(nusratCookie);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    const byId = Object.fromEntries(response.body.map((r) => [r.id, r]));
    expect(byId[firstRide.id].status).toBe('CANCELLED');
    expect(byId[firstRide.id].timeline.map((e) => e.type)).toEqual([
      'REQUESTED',
      'PASSENGER_CANCELLED',
    ]);
    expect(byId[secondRide.id].status).toBe('MATCHED');
    expect(byId[secondRide.id].timeline.map((e) => e.type)).toEqual(['REQUESTED', 'MATCHED']);
  });
});

describe('leak safety: no passenger endpoint reveals another passenger', () => {
  /**
   * Every request from `actorCookie`'s own passenger endpoints must never mention `others`'
   * identifying details, at whatever pool state the pool is currently in. The destination check
   * is skipped when an `other` shares `ownDestination`: with only 5 seeded NORTH-corridor zones,
   * a compatible pool of 3 structurally requires at least two members going to the same zone
   * (design.md's own demo has Rafiq and Shirin both going to Gulshan 1) — that shared zone name
   * legitimately appears in the actor's own response and is not itself a leak.
   */
  async function assertNoLeak(actorCookie, ownRideId, ownDestination, others) {
    const responses = await Promise.all([
      listRides(actorCookie),
      getRide(ownRideId, actorCookie),
      request(app)
        .get('/api/fare-estimate')
        .query({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
        .set('Cookie', actorCookie),
    ]);
    const combined = JSON.stringify(responses.map((r) => r.body));
    for (const other of others) {
      expect(combined).not.toMatch(new RegExp(other.name, 'i'));
      expect(combined).not.toContain(other.email);
      expect(combined).not.toContain(other.rideId);
      if (other.destination !== ownDestination) {
        expect(combined).not.toMatch(new RegExp(other.destination, 'i'));
      }
    }
  }

  it('holds at MATCHED, DRIVER_ARRIVED and STARTED, for every passenger in the pool', async () => {
    const driverCookie = await onlineDriver('leak-driver@test.example.com');

    const nusrat = {
      email: 'leak-nusrat@test.example.com',
      name: 'Nusrat',
      destination: 'Mohakhali',
    };
    const rafiq = { email: 'leak-rafiq@test.example.com', name: 'Rafiq', destination: 'Gulshan 1' };
    const shirin = {
      email: 'leak-shirin@test.example.com',
      name: 'Shirin',
      destination: 'Gulshan 1',
    };

    const nusratCookie = await request(app)
      .post('/api/auth/register')
      .send({ email: nusrat.email, password: 'correct-horse', name: nusrat.name })
      .then(() => loginAs(nusrat.email, 'correct-horse'));
    const rafiqCookie = await request(app)
      .post('/api/auth/register')
      .send({ email: rafiq.email, password: 'correct-horse', name: rafiq.name })
      .then(() => loginAs(rafiq.email, 'correct-horse'));
    const shirinCookie = await request(app)
      .post('/api/auth/register')
      .send({ email: shirin.email, password: 'correct-horse', name: shirin.name })
      .then(() => loginAs(shirin.email, 'correct-horse'));

    nusrat.ride = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const acceptResponse = await accept(nusrat.ride.id, driverCookie);
    const poolId = acceptResponse.body.id;
    rafiq.ride = await requestRide(rafiqCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    await accept(rafiq.ride.id, driverCookie);
    shirin.ride = await requestRide(shirinCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    await accept(shirin.ride.id, driverCookie);

    nusrat.rideId = nusrat.ride.id;
    rafiq.rideId = rafiq.ride.id;
    shirin.rideId = shirin.ride.id;
    const passengers = [
      { cookie: nusratCookie, self: nusrat, others: [rafiq, shirin] },
      { cookie: rafiqCookie, self: rafiq, others: [nusrat, shirin] },
      { cookie: shirinCookie, self: shirin, others: [nusrat, rafiq] },
    ];

    // MATCHED
    for (const p of passengers) {
      await assertNoLeak(p.cookie, p.self.rideId, p.self.destination, p.others);
    }

    await arrive(poolId, driverCookie);
    // DRIVER_ARRIVED
    for (const p of passengers) {
      await assertNoLeak(p.cookie, p.self.rideId, p.self.destination, p.others);
    }

    await start(poolId, driverCookie);
    // STARTED
    for (const p of passengers) {
      await assertNoLeak(p.cookie, p.self.rideId, p.self.destination, p.others);
    }
  });
});
