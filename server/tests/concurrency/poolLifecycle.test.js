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
const ITERATIONS = 20;

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

function accept(rideId, driverCookie) {
  return request(app).post(`/api/rides/${rideId}/accept`).set('Cookie', driverCookie);
}

function cancelRide(rideId, cookie) {
  return request(app).post(`/api/rides/${rideId}/cancel`).set('Cookie', cookie);
}

function arrive(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/arrive`).set('Cookie', driverCookie);
}

describe('C3: driver accept versus passenger cancel of the same request', () => {
  it('exactly one wins, and a cancelled ride never holds an active membership (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c3-${i}`;
      const driverCookie = await onlineDriver(`${prefix}-driver@test.example.com`);
      const candidateCookie = await registerAndLoginPassenger(`${prefix}-c@test.example.com`);
      const candidate = await requestRide(candidateCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
      });

      const [acceptResult, cancelResult] = await Promise.all([
        accept(candidate.id, driverCookie),
        cancelRide(candidate.id, candidateCookie),
      ]);

      expect([200, 409]).toContain(acceptResult.status);
      expect([200, 409]).toContain(cancelResult.status);

      const { rows } = await pool.query(
        `SELECT r.status,
                  EXISTS (SELECT 1 FROM pool_members pm
                          WHERE pm.ride_request_id = r.id AND pm.left_at IS NULL) AS has_active_membership
           FROM ride_requests r WHERE r.id = $1`,
        [candidate.id],
      );
      const { status, has_active_membership: hasActiveMembership } = rows[0];
      if (status === 'CANCELLED') {
        expect(hasActiveMembership).toBe(false);
      } else {
        expect(status).toBe('MATCHED');
        expect(hasActiveMembership).toBe(true);
      }
    }
  }, 30000);
});

describe('C4: add to pool versus arrive', () => {
  it('the add either lands before arrive or is rejected as closed, never both partially (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c4-${i}`;
      const driverCookie = await onlineDriver(`${prefix}-driver@test.example.com`);
      const anchorCookie = await registerAndLoginPassenger(`${prefix}-anchor@test.example.com`);
      const anchorRide = await requestRide(anchorCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
      });
      const acceptResponse = await accept(anchorRide.id, driverCookie);
      const poolId = acceptResponse.body.id;

      const joinerCookie = await registerAndLoginPassenger(`${prefix}-joiner@test.example.com`);
      const joinerRide = await requestRide(joinerCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN_1,
      });

      const [addResult, arriveResult] = await Promise.all([
        accept(joinerRide.id, driverCookie),
        arrive(poolId, driverCookie),
      ]);

      expect(arriveResult.status).toBe(200);
      expect([200, 409]).toContain(addResult.status);
      if (addResult.status === 409) {
        expect(addResult.body.error.code).toBe('POOL_CLOSED');
      }

      const { rows } = await pool.query(
        `SELECT r.status,
                  EXISTS (SELECT 1 FROM pool_members pm
                          WHERE pm.ride_request_id = r.id AND pm.left_at IS NULL) AS has_active_membership
           FROM ride_requests r WHERE r.id = $1`,
        [joinerRide.id],
      );
      const { status, has_active_membership: hasActiveMembership } = rows[0];
      if (addResult.status === 200) {
        expect(['MATCHED', 'DRIVER_ARRIVED']).toContain(status);
        expect(hasActiveMembership).toBe(true);
      } else {
        expect(status).toBe('REQUESTED');
        expect(hasActiveMembership).toBe(false);
      }
    }
  }, 30000);
});
