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

function endTrip(poolId, driverCookie) {
  return request(app).post(`/api/pools/${poolId}/end`).set('Cookie', driverCookie);
}

function completeAsDriver(poolId, rideId, driverCookie) {
  return request(app)
    .post(`/api/pools/${poolId}/members/${rideId}/complete`)
    .set('Cookie', driverCookie);
}

function completeAsPassenger(rideId, cookie) {
  return request(app).post(`/api/rides/${rideId}/complete`).set('Cookie', cookie);
}

function collectCash(paymentId, driverCookie) {
  return request(app).post(`/api/payments/${paymentId}/collect`).set('Cookie', driverCookie);
}

function getRide(rideId, cookie) {
  return request(app).get(`/api/rides/${rideId}`).set('Cookie', cookie);
}

function getPool(driverCookie) {
  return request(app).get('/api/driver/pool').set('Cookie', driverCookie);
}

/** Jashim online, Nusrat (Banani->Mohakhali) and Rafiq (Banani->Gulshan 1) matched, arrived, started. */
async function setUpStartedPool(prefix) {
  const driverEmail = `${prefix}-jashim@test.example.com`;
  const driverCookie = await onlineDriver(driverEmail);
  const nusratCookie = await registerAndLoginPassenger(`${prefix}-nusrat@test.example.com`);
  const rafiqCookie = await registerAndLoginPassenger(`${prefix}-rafiq@test.example.com`);
  const nusratRide = await requestRide(nusratCookie, {
    pickupZoneId: BANANI,
    destinationZoneId: MOHAKHALI,
  });
  const acceptResponse = await accept(nusratRide.id, driverCookie);
  const poolId = acceptResponse.body.id;
  const rafiqRide = await requestRide(rafiqCookie, {
    pickupZoneId: BANANI,
    destinationZoneId: GULSHAN_1,
  });
  await accept(rafiqRide.id, driverCookie);
  await arrive(poolId, driverCookie);
  const startResponse = await start(poolId, driverCookie);
  return {
    driverCookie,
    poolId,
    nusratCookie,
    nusratRide,
    rafiqCookie,
    rafiqRide,
    startResponse,
  };
}

describe('demo steps 7 to 9: completion and cash collection', () => {
  it('Rafiq completes first (pool stays STARTED), then Nusrat (pool COMPLETED); cash collected for both', async () => {
    const { driverCookie, poolId, nusratCookie, nusratRide, rafiqCookie, rafiqRide } =
      await setUpStartedPool('demo789');

    const rafiqComplete = await completeAsPassenger(rafiqRide.id, rafiqCookie);
    expect(rafiqComplete.status).toBe(200);
    expect(rafiqComplete.body.status).toBe('COMPLETED');
    const poolAfterRafiq = await getPool(driverCookie);
    expect(poolAfterRafiq.body.status).toBe('STARTED');

    const nusratComplete = await completeAsPassenger(nusratRide.id, nusratCookie);
    expect(nusratComplete.status).toBe(200);
    expect(nusratComplete.body.status).toBe('COMPLETED');
    const poolAfterNusrat = await getPool(driverCookie);
    expect(poolAfterNusrat.body).toBeNull(); // no longer active

    const poolRow = await pool.query('SELECT status FROM pools WHERE id = $1', [poolId]);
    expect(poolRow.rows[0].status).toBe('COMPLETED');

    // Vehicle is free for a new pool.
    const anotherCookie = await registerAndLoginPassenger('demo789-another@test.example.com');
    const anotherRide = await requestRide(anotherCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const newAccept = await accept(anotherRide.id, driverCookie);
    expect(newAccept.status).toBe(200);
    expect(newAccept.body.id).not.toBe(poolId);

    // Collect cash for both.
    const { rows: payments } = await pool.query(
      `SELECT id, ride_request_id FROM payments WHERE ride_request_id IN ($1, $2)`,
      [nusratRide.id, rafiqRide.id],
    );
    for (const payment of payments) {
      const collectResponse = await collectCash(payment.id, driverCookie);
      expect(collectResponse.status).toBe(200);
      expect(collectResponse.body.status).toBe('CASH_COLLECTED');
    }

    const nusratFinal = await getRide(nusratRide.id, nusratCookie);
    expect(nusratFinal.body.payment.status).toBe('CASH_COLLECTED');
    const rafiqFinal = await getRide(rafiqRide.id, rafiqCookie);
    expect(rafiqFinal.body.payment.status).toBe('CASH_COLLECTED');
  });
});

describe('POST /api/rides/:id/complete (passenger self-complete)', () => {
  it('rejects completing before STARTED', async () => {
    const driverCookie = await onlineDriver('selfcomplete-early@test.example.com');
    const nusratCookie = await registerAndLoginPassenger(
      'selfcomplete-early-nusrat@test.example.com',
    );
    const nusratRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await accept(nusratRide.id, driverCookie);

    const response = await completeAsPassenger(nusratRide.id, nusratCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('repeats idempotently with 200', async () => {
    const { nusratCookie, nusratRide } = await setUpStartedPool('selfcomplete-idem');

    const first = await completeAsPassenger(nusratRide.id, nusratCookie);
    const second = await completeAsPassenger(nusratRide.id, nusratCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for another passenger's ride", async () => {
    const { nusratRide } = await setUpStartedPool('selfcomplete-other');
    const otherCookie = await registerAndLoginPassenger(
      'selfcomplete-other-passenger@test.example.com',
    );

    const response = await completeAsPassenger(nusratRide.id, otherCookie);

    expect(response.status).toBe(404);
  });
});

describe('POST /api/pools/:id/members/:rideId/complete (driver complete)', () => {
  it('rejects completing before STARTED', async () => {
    const driverCookie = await onlineDriver('drivercomplete-early@test.example.com');
    const nusratCookie = await registerAndLoginPassenger(
      'drivercomplete-early-nusrat@test.example.com',
    );
    const nusratRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const acceptResponse = await accept(nusratRide.id, driverCookie);

    const response = await completeAsDriver(acceptResponse.body.id, nusratRide.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('repeats idempotently with 200', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpStartedPool('drivercomplete-idem');

    const first = await completeAsDriver(poolId, nusratRide.id, driverCookie);
    const second = await completeAsDriver(poolId, nusratRide.id, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for another driver's pool", async () => {
    const { poolId, nusratRide } = await setUpStartedPool('drivercomplete-other');
    const otherCookie = await onlineDriver('drivercomplete-other-driver2@test.example.com');

    const response = await completeAsDriver(poolId, nusratRide.id, otherCookie);

    expect(response.status).toBe(404);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratRide, nusratCookie } = await setUpStartedPool('drivercomplete-403');

    const response = await completeAsDriver(poolId, nusratRide.id, nusratCookie);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/pools/:id/end (End Trip)', () => {
  it('force-completes every remaining member with DRIVER_FORCE_ENDED', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie, rafiqRide, rafiqCookie } =
      await setUpStartedPool('endtrip');

    const response = await endTrip(poolId, driverCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('COMPLETED');
    const nusratAfter = await getRide(nusratRide.id, nusratCookie);
    const rafiqAfter = await getRide(rafiqRide.id, rafiqCookie);
    expect(nusratAfter.body.status).toBe('COMPLETED');
    expect(rafiqAfter.body.status).toBe('COMPLETED');
    expect(nusratAfter.body.timeline.at(-1).type).toBe('DRIVER_FORCE_ENDED');
    expect(rafiqAfter.body.timeline.at(-1).type).toBe('DRIVER_FORCE_ENDED');
  });

  it('rejects ending before STARTED', async () => {
    const driverEmail = 'endtrip-early@test.example.com';
    const driverCookie = await onlineDriver(driverEmail);
    const nusratCookie = await registerAndLoginPassenger('endtrip-early-nusrat@test.example.com');
    const nusratRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    const acceptResponse = await accept(nusratRide.id, driverCookie);

    const response = await endTrip(acceptResponse.body.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('repeats idempotently with 200', async () => {
    const { driverCookie, poolId } = await setUpStartedPool('endtrip-idem');

    const first = await endTrip(poolId, driverCookie);
    const second = await endTrip(poolId, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for another driver's pool", async () => {
    const { poolId } = await setUpStartedPool('endtrip-other');
    const otherCookie = await onlineDriver('endtrip-other-driver2@test.example.com');

    const response = await endTrip(poolId, otherCookie);

    expect(response.status).toBe(404);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratCookie } = await setUpStartedPool('endtrip-403');

    const response = await endTrip(poolId, nusratCookie);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/payments/:id/collect', () => {
  async function getPaymentId(rideId) {
    const { rows } = await pool.query('SELECT id FROM payments WHERE ride_request_id = $1', [
      rideId,
    ]);
    return rows[0].id;
  }

  it('rejects collecting before the ride is COMPLETED', async () => {
    const { driverCookie, nusratRide } = await setUpStartedPool('collect-early');
    const paymentId = await getPaymentId(nusratRide.id);

    const response = await collectCash(paymentId, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('repeats idempotently with 200', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpStartedPool('collect-idem');
    await completeAsDriver(poolId, nusratRide.id, driverCookie);
    const paymentId = await getPaymentId(nusratRide.id);

    const first = await collectCash(paymentId, driverCookie);
    const second = await collectCash(paymentId, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for a payment through another driver's pool", async () => {
    const { poolId, nusratRide, driverCookie } = await setUpStartedPool('collect-other');
    await completeAsDriver(poolId, nusratRide.id, driverCookie);
    const paymentId = await getPaymentId(nusratRide.id);
    const otherCookie = await onlineDriver('collect-other-driver2@test.example.com');

    const response = await collectCash(paymentId, otherCookie);

    expect(response.status).toBe(404);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratRide, nusratCookie, driverCookie } =
      await setUpStartedPool('collect-403');
    await completeAsDriver(poolId, nusratRide.id, driverCookie);
    const paymentId = await getPaymentId(nusratRide.id);

    const response = await collectCash(paymentId, nusratCookie);

    expect(response.status).toBe(403);
  });
});
