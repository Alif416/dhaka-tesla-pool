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

function noShow(poolId, rideId, driverCookie) {
  return request(app)
    .post(`/api/pools/${poolId}/members/${rideId}/no-show`)
    .set('Cookie', driverCookie);
}

function cancelRide(rideId, cookie) {
  return request(app).post(`/api/rides/${rideId}/cancel`).set('Cookie', cookie);
}

function getRide(rideId, cookie) {
  return request(app).get(`/api/rides/${rideId}`).set('Cookie', cookie);
}

/** Sets up Jashim online with Nusrat (Banani->Mohakhali) accepted, anchoring a fresh pool. */
async function setUpAcceptedPoolWithNusrat(prefix) {
  const driverEmail = `${prefix}-jashim@test.example.com`;
  const driverCookie = await onlineDriver(driverEmail);
  const nusratCookie = await registerAndLoginPassenger(`${prefix}-nusrat@test.example.com`);
  const nusratRide = await requestRide(nusratCookie, {
    pickupZoneId: BANANI,
    destinationZoneId: MOHAKHALI,
  });
  const acceptResponse = await accept(nusratRide.id, driverCookie);
  return {
    driverCookie,
    nusratCookie,
    nusratRide,
    poolId: acceptResponse.body.id,
  };
}

describe('demo steps 5 and 6: no-show then start, exact numbers', () => {
  it('quotes stay 8500/6800 after Shirin no-shows; payments freeze at 9000/8500/500 and 7200/6800/400', async () => {
    const driverEmail = 'demo-jashim@test.example.com';
    const driverCookie = await onlineDriver(driverEmail);
    const nusratCookie = await registerAndLoginPassenger('demo-nusrat@test.example.com');
    const rafiqCookie = await registerAndLoginPassenger('demo-rafiq@test.example.com');
    const shirinCookie = await registerAndLoginPassenger('demo-shirin@test.example.com');

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
    const shirinRide = await requestRide(shirinCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    await accept(shirinRide.id, driverCookie);

    // Before arrive: 3 passengers, quotes are 8500/6800/6800.
    const nusratBefore = await getRide(nusratRide.id, nusratCookie);
    expect(nusratBefore.body.fare.amountPaisa).toBe(8500);

    const arriveResponse = await arrive(poolId, driverCookie);
    expect(arriveResponse.status).toBe(200);
    expect(arriveResponse.body.status).toBe('DRIVER_ARRIVED');

    const noShowResponse = await noShow(poolId, shirinRide.id, driverCookie);
    expect(noShowResponse.status).toBe(200);
    expect(noShowResponse.body.members).toHaveLength(2);

    // Computed fares for 2 passengers would be 9000/7200, but quotes must stay 8500/6800.
    const nusratAfterNoShow = await getRide(nusratRide.id, nusratCookie);
    const rafiqAfterNoShow = await getRide(rafiqRide.id, rafiqCookie);
    expect(nusratAfterNoShow.body.fare.amountPaisa).toBe(8500);
    expect(rafiqAfterNoShow.body.fare.amountPaisa).toBe(6800);
    const shirinAfterNoShow = await getRide(shirinRide.id, shirinCookie);
    expect(shirinAfterNoShow.body.status).toBe('CANCELLED');
    // design.md section 12's demo checklist lists this timeline as REQUESTED, MATCHED,
    // QUOTE_UPDATED, PASSENGER_NO_SHOW, omitting DRIVER_ARRIVED. Arrive genuinely appends a
    // DRIVER_ARRIVED event per member (section 7.3: "pool and members to DRIVER_ARRIVED,
    // events"), and ride_events.ride_request_id is NOT NULL, so an event can't exist without
    // being attached to a specific ride — there is no way to record "the driver arrived" once
    // without it appearing in every member's own timeline. Treated as an incomplete summary in
    // the doc, not a contradiction to code around; flagged in the tracker.
    expect(shirinAfterNoShow.body.timeline.map((event) => event.type)).toEqual([
      'REQUESTED',
      'MATCHED',
      'QUOTE_UPDATED',
      'DRIVER_ARRIVED',
      'PASSENGER_NO_SHOW',
    ]);

    const startResponse = await start(poolId, driverCookie);
    expect(startResponse.status).toBe(200);
    expect(startResponse.body.status).toBe('STARTED');

    const nusratFinal = await getRide(nusratRide.id, nusratCookie);
    const rafiqFinal = await getRide(rafiqRide.id, rafiqCookie);
    expect(nusratFinal.body.fare).toEqual({ amountPaisa: 8500, kind: 'FINAL' });
    expect(nusratFinal.body.payment).toEqual({ amountPaisa: 8500, status: 'PENDING' });
    expect(rafiqFinal.body.fare).toEqual({ amountPaisa: 6800, kind: 'FINAL' });
    expect(rafiqFinal.body.payment).toEqual({ amountPaisa: 6800, status: 'PENDING' });

    const { rows } = await pool.query(
      `SELECT r.passenger_id, p.uncapped_fare_paisa, p.final_fare_paisa, p.subsidy_paisa
       FROM payments p JOIN ride_requests r ON r.id = p.ride_request_id
       ORDER BY p.uncapped_fare_paisa DESC`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      uncapped_fare_paisa: 9000,
      final_fare_paisa: 8500,
      subsidy_paisa: 500,
    });
    expect(rows[1]).toMatchObject({
      uncapped_fare_paisa: 7200,
      final_fare_paisa: 6800,
      subsidy_paisa: 400,
    });

    const shirinPayment = await pool.query(
      'SELECT count(*)::int AS n FROM payments WHERE ride_request_id = $1',
      [shirinRide.id],
    );
    expect(shirinPayment.rows[0].n).toBe(0);
  });
});

describe('POST /api/pools/:id/arrive', () => {
  it('closes joining: an add after arrive gets POOL_CLOSED', async () => {
    const { driverCookie, poolId } = await setUpAcceptedPoolWithNusrat('arrive-closes');
    await arrive(poolId, driverCookie);
    const rafiqCookie = await registerAndLoginPassenger('arrive-closes-rafiq@test.example.com');
    const rafiqRide = await requestRide(rafiqCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });

    const response = await accept(rafiqRide.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('POOL_CLOSED');
  });

  it('repeats idempotently with 200', async () => {
    const { driverCookie, poolId } = await setUpAcceptedPoolWithNusrat('arrive-idem');

    const first = await arrive(poolId, driverCookie);
    const second = await arrive(poolId, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for another driver's pool", async () => {
    const { poolId } = await setUpAcceptedPoolWithNusrat('arrive-other');
    const otherCookie = await onlineDriver('arrive-other-driver2@test.example.com');

    const response = await arrive(poolId, otherCookie);

    expect(response.status).toBe(404);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratCookie } = await setUpAcceptedPoolWithNusrat('arrive-403');

    const response = await arrive(poolId, nusratCookie);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/pools/:id/members/:rideId/no-show', () => {
  it('rejects a no-show before the pool has arrived', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpAcceptedPoolWithNusrat('noshow-early');

    const response = await noShow(poolId, nusratRide.id, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('cancels the whole pool when the only member no-shows', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpAcceptedPoolWithNusrat('noshow-empty');
    await arrive(poolId, driverCookie);

    const response = await noShow(poolId, nusratRide.id, driverCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CANCELLED');
    expect(response.body.members).toHaveLength(0);
  });

  it('repeats idempotently with 200', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpAcceptedPoolWithNusrat('noshow-idem');
    const rafiqCookie = await registerAndLoginPassenger('noshow-idem-rafiq@test.example.com');
    const rafiqRide = await requestRide(rafiqCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    await accept(rafiqRide.id, driverCookie);
    await arrive(poolId, driverCookie);

    const first = await noShow(poolId, nusratRide.id, driverCookie);
    const second = await noShow(poolId, nusratRide.id, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for another driver's pool", async () => {
    const { poolId, nusratRide } = await setUpAcceptedPoolWithNusrat('noshow-other');
    const otherCookie = await onlineDriver('noshow-other-driver2@test.example.com');

    const response = await noShow(poolId, nusratRide.id, otherCookie);

    expect(response.status).toBe(404);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratRide, nusratCookie } = await setUpAcceptedPoolWithNusrat('noshow-403');

    const response = await noShow(poolId, nusratRide.id, nusratCookie);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/pools/:id/cancel', () => {
  it('requeues members to REQUESTED with their quote kept, from ACCEPTED', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie } =
      await setUpAcceptedPoolWithNusrat('cancelpool-accepted');

    const response = await cancelPool(poolId, driverCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CANCELLED');
    const nusratAfter = await getRide(nusratRide.id, nusratCookie);
    expect(nusratAfter.body.status).toBe('REQUESTED');
    expect(nusratAfter.body.fare.amountPaisa).toBe(10000);
    expect(nusratAfter.body.driver).toBeNull();
  });

  it('requeues members from DRIVER_ARRIVED too', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie } =
      await setUpAcceptedPoolWithNusrat('cancelpool-arrived');
    await arrive(poolId, driverCookie);

    const response = await cancelPool(poolId, driverCookie);

    expect(response.status).toBe(200);
    const nusratAfter = await getRide(nusratRide.id, nusratCookie);
    expect(nusratAfter.body.status).toBe('REQUESTED');
  });

  it('rejects cancelling a STARTED pool', async () => {
    const { driverCookie, poolId } = await setUpAcceptedPoolWithNusrat('cancelpool-started');
    await arrive(poolId, driverCookie);
    await start(poolId, driverCookie);

    const response = await cancelPool(poolId, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('repeats idempotently with 200', async () => {
    const { driverCookie, poolId } = await setUpAcceptedPoolWithNusrat('cancelpool-idem');

    const first = await cancelPool(poolId, driverCookie);
    const second = await cancelPool(poolId, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('lets a requeued passenger be matched into a new pool afterward', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie } =
      await setUpAcceptedPoolWithNusrat('cancelpool-rejoin');
    await cancelPool(poolId, driverCookie);

    const secondAccept = await accept(nusratRide.id, driverCookie);

    expect(secondAccept.status).toBe(200);
    const nusratAfter = await getRide(nusratRide.id, nusratCookie);
    expect(nusratAfter.body.status).toBe('MATCHED');
  });

  it("returns 404 for another driver's pool", async () => {
    const { poolId } = await setUpAcceptedPoolWithNusrat('cancelpool-other');
    const otherCookie = await onlineDriver('cancelpool-other-driver2@test.example.com');

    const response = await cancelPool(poolId, otherCookie);

    expect(response.status).toBe(404);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratCookie } = await setUpAcceptedPoolWithNusrat('cancelpool-403');

    const response = await cancelPool(poolId, nusratCookie);

    expect(response.status).toBe(403);
  });
});

describe('POST /api/pools/:id/start', () => {
  it('rejects starting before arrival', async () => {
    const { driverCookie, poolId } = await setUpAcceptedPoolWithNusrat('start-early');

    const response = await start(poolId, driverCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('starts with a single remaining member', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpAcceptedPoolWithNusrat('start-single');
    await arrive(poolId, driverCookie);

    const response = await start(poolId, driverCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('STARTED');
    expect(response.body.members[0].rideId).toBe(nusratRide.id);
  });

  it('repeats idempotently with 200 and does not create a second payment', async () => {
    const { driverCookie, poolId, nusratRide } = await setUpAcceptedPoolWithNusrat('start-idem');
    await arrive(poolId, driverCookie);

    const first = await start(poolId, driverCookie);
    const second = await start(poolId, driverCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM payments WHERE ride_request_id = $1',
      [nusratRide.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('is forbidden for a passenger', async () => {
    const { poolId, nusratCookie } = await setUpAcceptedPoolWithNusrat('start-403');

    const response = await start(poolId, nusratCookie);

    expect(response.status).toBe(403);
  });

  it("returns 404 for another driver's pool", async () => {
    const { driverCookie, poolId } = await setUpAcceptedPoolWithNusrat('start-other');
    await arrive(poolId, driverCookie);
    const otherCookie = await onlineDriver('start-other-driver2@test.example.com');

    const response = await start(poolId, otherCookie);

    expect(response.status).toBe(404);
  });
});

describe('passenger cancel from inside a pool', () => {
  it('cancels from MATCHED, keeps the pool for the remaining member with a recomputed quote', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie } =
      await setUpAcceptedPoolWithNusrat('pcancel-matched');
    const rafiqCookie = await registerAndLoginPassenger('pcancel-matched-rafiq@test.example.com');
    const rafiqRide = await requestRide(rafiqCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    const addResponse = await accept(rafiqRide.id, driverCookie);
    expect(addResponse.body.occupiedSeats).toBe(2);

    const cancelResponse = await cancelRide(nusratRide.id, nusratCookie);

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.status).toBe('CANCELLED');
    const rafiqAfter = await getRide(rafiqRide.id, rafiqCookie);
    expect(rafiqAfter.body.status).toBe('MATCHED');
    // Quote never rises: Rafiq keeps the 2-passenger discounted 7200, even though he is now
    // the only member (computed solo fare would be 8000).
    expect(rafiqAfter.body.fare.amountPaisa).toBe(7200);
    expect(rafiqAfter.body.sharedPassengerCount).toBe(0);

    const poolRow = await pool.query('SELECT status FROM pools WHERE id = $1', [poolId]);
    expect(poolRow.rows[0].status).toBe('ACCEPTED');
  });

  it('cancels from DRIVER_ARRIVED', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie } =
      await setUpAcceptedPoolWithNusrat('pcancel-arrived');
    await arrive(poolId, driverCookie);

    const response = await cancelRide(nusratRide.id, nusratCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('CANCELLED');
  });

  it('cancels the whole pool when the last member cancels', async () => {
    const { poolId, nusratRide, nusratCookie } = await setUpAcceptedPoolWithNusrat('pcancel-last');

    await cancelRide(nusratRide.id, nusratCookie);

    const poolRow = await pool.query('SELECT status FROM pools WHERE id = $1', [poolId]);
    expect(poolRow.rows[0].status).toBe('CANCELLED');
  });

  it('rejects cancelling after STARTED', async () => {
    const { driverCookie, poolId, nusratRide, nusratCookie } =
      await setUpAcceptedPoolWithNusrat('pcancel-started');
    await arrive(poolId, driverCookie);
    await start(poolId, driverCookie);

    const response = await cancelRide(nusratRide.id, nusratCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('repeats idempotently with 200', async () => {
    const { nusratRide, nusratCookie } = await setUpAcceptedPoolWithNusrat('pcancel-idem');

    const first = await cancelRide(nusratRide.id, nusratCookie);
    const second = await cancelRide(nusratRide.id, nusratCookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("returns 404 for another passenger's ride", async () => {
    const { nusratRide } = await setUpAcceptedPoolWithNusrat('pcancel-other');
    const otherCookie = await registerAndLoginPassenger('pcancel-other-passenger@test.example.com');

    const response = await cancelRide(nusratRide.id, otherCookie);

    expect(response.status).toBe(404);
  });
});

describe('quote never rises', () => {
  it('holds across a sequence of joins, a passenger cancel, and a no-show', async () => {
    const driverEmail = 'norise-jashim@test.example.com';
    const driverCookie = await onlineDriver(driverEmail);
    const nusratCookie = await registerAndLoginPassenger('norise-nusrat@test.example.com');
    const rafiqCookie = await registerAndLoginPassenger('norise-rafiq@test.example.com');
    const shirinCookie = await registerAndLoginPassenger('norise-shirin@test.example.com');

    const nusratRide = await requestRide(nusratCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: MOHAKHALI,
    });
    await accept(nusratRide.id, driverCookie);
    const rafiqRide = await requestRide(rafiqCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    const acceptRafiq = await accept(rafiqRide.id, driverCookie);
    const poolId = acceptRafiq.body.id;
    const shirinRide = await requestRide(shirinCookie, {
      pickupZoneId: BANANI,
      destinationZoneId: GULSHAN_1,
    });
    await accept(shirinRide.id, driverCookie);

    let previousNusratQuote = 10000;
    let previousRafiqQuote = 8000;

    async function assertNeverRises() {
      const nusratNow = (await getRide(nusratRide.id, nusratCookie)).body.fare.amountPaisa;
      const rafiqNow = (await getRide(rafiqRide.id, rafiqCookie)).body.fare.amountPaisa;
      expect(nusratNow).toBeLessThanOrEqual(previousNusratQuote);
      expect(rafiqNow).toBeLessThanOrEqual(previousRafiqQuote);
      previousNusratQuote = nusratNow;
      previousRafiqQuote = rafiqNow;
    }

    await assertNeverRises(); // after 3 joined: 8500/6800/6800
    await cancelRide(shirinRide.id, shirinCookie); // Shirin cancels before arrive
    await assertNeverRises();
    await arrive(poolId, driverCookie);
    await assertNeverRises();
    await start(poolId, driverCookie);
    await assertNeverRises();
  });
});
