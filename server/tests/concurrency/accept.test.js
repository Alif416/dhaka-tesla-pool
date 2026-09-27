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

async function onlineDriver(email, capacity) {
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

async function occupiedSeatsForVehicleEmail(email) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(r.seats), 0)::int AS occupied
     FROM pool_members pm
     JOIN ride_requests r ON r.id = pm.ride_request_id
     JOIN pools p ON p.id = pm.pool_id
     JOIN vehicles v ON v.id = p.vehicle_id
     JOIN users u ON u.id = v.driver_id
     WHERE pm.left_at IS NULL AND u.email = $1`,
    [email],
  );
  return rows[0].occupied;
}

async function poolCountForVehicleEmail(email) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM pools p
     JOIN vehicles v ON v.id = p.vehicle_id
     JOIN users u ON u.id = v.driver_id
     WHERE u.email = $1`,
    [email],
  );
  return rows[0].n;
}

describe('C1: two different requests, one seat left', () => {
  it('exactly one succeeds, the other gets POOL_FULL, and capacity never exceeded (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c1-${i}`;
      const driverEmail = `${prefix}-driver@test.example.com`;
      const driverCookie = await onlineDriver(driverEmail, 2);
      const anchorCookie = await registerAndLoginPassenger(`${prefix}-anchor@test.example.com`);
      const anchorRide = await requestRide(anchorCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
      });
      await accept(anchorRide.id, driverCookie);

      const rafiqCookie = await registerAndLoginPassenger(`${prefix}-rafiq@test.example.com`);
      const shirinCookie = await registerAndLoginPassenger(`${prefix}-shirin@test.example.com`);
      const rafiqRide = await requestRide(rafiqCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN_1,
        seats: 1,
      });
      const shirinRide = await requestRide(shirinCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN_1,
        seats: 1,
      });

      const [first, second] = await Promise.all([
        accept(rafiqRide.id, driverCookie),
        accept(shirinRide.id, driverCookie),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const failure = first.status === 409 ? first : second;
      expect(failure.body.error.code).toBe('POOL_FULL');
      expect(await occupiedSeatsForVehicleEmail(driverEmail)).toBeLessThanOrEqual(2);
    }
  }, 30000);
});

describe('C2: a 2-seat booking against 1 remaining seat, concurrent with a 1-seat booking', () => {
  it('the 2-seat booking is always rejected in full, never partial (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c2-${i}`;
      const driverEmail = `${prefix}-driver@test.example.com`;
      const driverCookie = await onlineDriver(driverEmail, 3);
      const firstCookie = await registerAndLoginPassenger(`${prefix}-first@test.example.com`);
      const firstRide = await requestRide(firstCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 2,
      });
      await accept(firstRide.id, driverCookie);

      const oneSeatCookie = await registerAndLoginPassenger(`${prefix}-one@test.example.com`);
      const twoSeatCookie = await registerAndLoginPassenger(`${prefix}-two@test.example.com`);
      const oneSeatRide = await requestRide(oneSeatCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN_1,
        seats: 1,
      });
      const twoSeatRide = await requestRide(twoSeatCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN_1,
        seats: 2,
      });

      const [oneSeatResult, twoSeatResult] = await Promise.all([
        accept(oneSeatRide.id, driverCookie),
        accept(twoSeatRide.id, driverCookie),
      ]);

      expect(twoSeatResult.status).toBe(409);
      expect(twoSeatResult.body.error.code).toBe('POOL_FULL');
      expect([200, 409]).toContain(oneSeatResult.status);
      expect(await occupiedSeatsForVehicleEmail(driverEmail)).toBeLessThanOrEqual(3);
    }
  }, 30000);
});

describe('C5: the same accept sent twice, concurrently', () => {
  it('both return 200 with exactly one membership (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c5-${i}`;
      const driverCookie = await onlineDriver(`${prefix}-driver@test.example.com`, 3);
      const candidateCookie = await registerAndLoginPassenger(`${prefix}-c@test.example.com`);
      const candidate = await requestRide(candidateCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
      });

      const [first, second] = await Promise.all([
        accept(candidate.id, driverCookie),
        accept(candidate.id, driverCookie),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM pool_members WHERE ride_request_id = $1',
        [candidate.id],
      );
      expect(rows[0].n).toBe(1);
    }
  }, 30000);
});

describe('C7: two different requests accepted with no pool yet', () => {
  it('creates exactly one pool, never two (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c7-${i}`;
      const driverEmail = `${prefix}-driver@test.example.com`;
      const driverCookie = await onlineDriver(driverEmail, 3);
      const nusratCookie = await registerAndLoginPassenger(`${prefix}-nusrat@test.example.com`);
      const rafiqCookie = await registerAndLoginPassenger(`${prefix}-rafiq@test.example.com`);
      const nusratRide = await requestRide(nusratCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
        seats: 1,
      });
      const rafiqRide = await requestRide(rafiqCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: GULSHAN_1,
        seats: 1,
      });

      const [first, second] = await Promise.all([
        accept(nusratRide.id, driverCookie),
        accept(rafiqRide.id, driverCookie),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await poolCountForVehicleEmail(driverEmail)).toBe(1);
      expect(await occupiedSeatsForVehicleEmail(driverEmail)).toBe(2);
    }
  }, 30000);
});

describe('C8: accept versus go offline', () => {
  it('never leaves an offline vehicle with a new active pool (20 iterations)', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const prefix = `c8-${i}`;
      const driverEmail = `${prefix}-driver@test.example.com`;
      const driverCookie = await onlineDriver(driverEmail, 3);
      const candidateCookie = await registerAndLoginPassenger(`${prefix}-c@test.example.com`);
      const candidate = await requestRide(candidateCookie, {
        pickupZoneId: BANANI,
        destinationZoneId: MOHAKHALI,
      });

      const [acceptResult] = await Promise.all([
        accept(candidate.id, driverCookie),
        request(app).post('/api/driver/offline').set('Cookie', driverCookie),
      ]);

      const { rows } = await pool.query(
        `SELECT v.online, EXISTS (
           SELECT 1 FROM pools p WHERE p.vehicle_id = v.id
             AND p.status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')
         ) AS has_active_pool
         FROM vehicles v
         JOIN users u ON u.id = v.driver_id
         WHERE u.email = $1`,
        [driverEmail],
      );
      const { online, has_active_pool: hasActivePool } = rows[0];

      if (!online) {
        expect(hasActivePool).toBe(false);
      }
      // Accept can legitimately succeed either before or after the offline attempt resolves;
      // what must never happen is an offline vehicle owning an active pool (checked above).
      expect([200, 409]).toContain(acceptResult.status);
    }
  }, 30000);
});
