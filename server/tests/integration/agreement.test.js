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

async function onlineDriver(email, capacity = 3) {
  await makeDriverWithVehicle(pool, { email, capacity, online: true });
  return loginAs(email, 'driver-test-password');
}

async function requestRide(cookie, { pickupZoneId, destinationZoneId, seats = 1 }) {
  const response = await request(app)
    .post('/api/rides')
    .send({ pickupZoneId, destinationZoneId, seats })
    .set('Cookie', cookie);
  return response.body;
}

/**
 * Asserts the agreement property for one candidate against one driver state: it is listed in
 * GET /driver/requests if and only if POST /rides/:id/accept succeeds (200), in a quiet
 * database — checked by re-listing before accepting, so the list itself never causes a write.
 */
async function assertAgreement(driverCookie, candidateId) {
  const before = await request(app).get('/api/driver/requests').set('Cookie', driverCookie);
  const isListed = before.body.some((row) => row.id === candidateId);

  const acceptResponse = await request(app)
    .post(`/api/rides/${candidateId}/accept`)
    .set('Cookie', driverCookie);
  const accepted = acceptResponse.status === 200;

  expect(isListed).toBe(accepted);
  return accepted;
}

describe('driver requests vs accept — agreement (design.md section 13.4)', () => {
  it('no pool, request fits capacity: listed and accept succeeds', async () => {
    const driverCookie = await onlineDriver('agree-nopool@test.example.com');
    const candidateCookie = await registerAndLoginPassenger('agree-nopool-c@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });

    expect(await assertAgreement(driverCookie, candidate.id)).toBe(true);
  });

  it('no pool, request exceeds capacity: not listed and accept fails', async () => {
    const driverCookie = await onlineDriver('agree-toobig@test.example.com', 1);
    const candidateCookie = await registerAndLoginPassenger('agree-toobig-c@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 2,
    });

    expect(await assertAgreement(driverCookie, candidate.id)).toBe(false);
  });

  it('one member, compatible candidate: listed and accept succeeds', async () => {
    const driverCookie = await onlineDriver('agree-compat@test.example.com');
    const memberCookie = await registerAndLoginPassenger('agree-compat-m@test.example.com');
    const memberRide = await requestRide(memberCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await request(app).post(`/api/rides/${memberRide.id}/accept`).set('Cookie', driverCookie);
    const candidateCookie = await registerAndLoginPassenger('agree-compat-c@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });

    expect(await assertAgreement(driverCookie, candidate.id)).toBe(true);
  });

  it('one member, incompatible candidate (opposite direction): not listed and accept fails', async () => {
    const driverCookie = await onlineDriver('agree-incompat@test.example.com');
    const memberCookie = await registerAndLoginPassenger('agree-incompat-m@test.example.com');
    const memberRide = await requestRide(memberCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await request(app).post(`/api/rides/${memberRide.id}/accept`).set('Cookie', driverCookie);
    const candidateCookie = await registerAndLoginPassenger('agree-incompat-c@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: MOHAKHALI,
      destinationZoneId: BANANI,
    });

    expect(await assertAgreement(driverCookie, candidate.id)).toBe(false);
  });

  it('pool full: not listed and accept fails', async () => {
    const driverCookie = await onlineDriver('agree-full@test.example.com', 1);
    const memberCookie = await registerAndLoginPassenger('agree-full-m@test.example.com');
    const memberRide = await requestRide(memberCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
      seats: 1,
    });
    await request(app).post(`/api/rides/${memberRide.id}/accept`).set('Cookie', driverCookie);
    const candidateCookie = await registerAndLoginPassenger('agree-full-c@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
      seats: 1,
    });

    expect(await assertAgreement(driverCookie, candidate.id)).toBe(false);
  });

  it('pool DRIVER_ARRIVED: not listed and accept fails', async () => {
    const { vehicle } = await makeDriverWithVehicle(pool, {
      email: 'agree-arrived@test.example.com',
      online: true,
    });
    const driverCookie = await loginAs('agree-arrived@test.example.com', 'driver-test-password');
    await makePool(pool, { vehicleId: vehicle.id, status: 'DRIVER_ARRIVED' });
    const candidateCookie = await registerAndLoginPassenger('agree-arrived-c@test.example.com');
    const candidate = await requestRide(candidateCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });

    expect(await assertAgreement(driverCookie, candidate.id)).toBe(false);
  });
});
