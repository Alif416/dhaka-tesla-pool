import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import { makeDriverWithVehicle, resetDb } from '../helpers/db.js';

const { app, pool } = await buildTestApp();

afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

const BANANI = 1;
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

function arrive(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/arrive`).set('Cookie', driverCookie);
}

function start(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/start`).set('Cookie', driverCookie);
}

function noShow(poolId, rideId, driverCookie) {
  return request(app)
    .post(`/api/pools/${poolId}/members/${rideId}/no-show`)
    .set('Cookie', driverCookie);
}

function endTrip(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/end`).set('Cookie', driverCookie);
}

function completeAsPassenger(rideId, cookie) {
  return request(app).post(`/api/rides/${rideId}/complete`).set('Cookie', cookie);
}

describe('C9: no-show versus Start', () => {
  it('produces exactly one valid outcome — the member is either no-shown or started, never both (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c9-${i}`;
      const driverEmail = `${prefix}-driver@test.example.com`;
      const driverCookie = await onlineDriver(driverEmail);
      const nusratCookie = await registerAndLoginPassenger(`${prefix}-nusrat@test.example.com`);
      const nusratRide = await requestRide(nusratCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
      });
      const acceptResponse = await accept(nusratRide.id, driverCookie);
      const poolId = acceptResponse.body.id;
      await arrive(poolId, driverCookie);

      const [noShowResult, startResult] = await Promise.all([
        noShow(poolId, nusratRide.id, driverCookie),
        start(poolId, driverCookie),
      ]);

      // With a single member, the two are mutually exclusive: whichever locks the pool first
      // leaves it in a state (CANCELLED or STARTED) the other's re-check under the same lock
      // rejects. Exactly one of the two must succeed.
      const statuses = [noShowResult.status, startResult.status].sort();
      expect(statuses).toEqual([200, 409]);

      const { rows } = await pool.query(
        `SELECT r.status, (SELECT count(*)::int FROM payments WHERE ride_request_id = r.id) AS n_payments
           FROM ride_requests r WHERE r.id = $1`,
        [nusratRide.id],
      );
      const { status, n_payments: paymentCount } = rows[0];
      if (status === 'CANCELLED') {
        // No-show won: no payment for a no-showed passenger, and the pool has nothing left
        // to start (an empty pool cancels itself in that case) or started with none of it.
        expect(paymentCount).toBe(0);
      } else {
        expect(status).toBe('STARTED');
        expect(paymentCount).toBe(1);
      }
    }
  }, 30000);
});

describe('C10: self-complete versus End Trip', () => {
  it('completes each ride exactly once and the pool completes exactly once (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c10-${i}`;
      const driverEmail = `${prefix}-driver@test.example.com`;
      const driverCookie = await onlineDriver(driverEmail);
      const nusratCookie = await registerAndLoginPassenger(`${prefix}-nusrat@test.example.com`);
      const nusratRide = await requestRide(nusratCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
      });
      const acceptResponse = await accept(nusratRide.id, driverCookie);
      const poolId = acceptResponse.body.id;
      await arrive(poolId, driverCookie);
      await start(poolId, driverCookie);

      const [completeResult, endResult] = await Promise.all([
        completeAsPassenger(nusratRide.id, nusratCookie),
        endTrip(poolId, driverCookie),
      ]);

      expect(completeResult.status).toBe(200);
      expect(endResult.status).toBe(200);

      const { rows } = await pool.query(
        `SELECT r.status,
                  (SELECT count(*)::int FROM ride_events
                   WHERE ride_request_id = r.id AND event_type IN ('COMPLETED', 'PASSENGER_SELF_COMPLETED', 'DRIVER_FORCE_ENDED')) AS n_completion_events
           FROM ride_requests r WHERE r.id = $1`,
        [nusratRide.id],
      );
      expect(rows[0].status).toBe('COMPLETED');
      expect(rows[0].n_completion_events).toBe(1);

      const poolRow = await pool.query('SELECT status FROM pools WHERE id = $1', [poolId]);
      expect(poolRow.rows[0].status).toBe('COMPLETED');
    }
  }, 30000);
});
