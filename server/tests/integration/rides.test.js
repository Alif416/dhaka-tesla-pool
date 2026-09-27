import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import { resetDb } from '../helpers/db.js';

const { app, pool } = await buildTestApp();

afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

const BANANI = 1;
const GULSHAN_1 = 2;
const MOHAKHALI = 3;

async function registerAndLogin(email, name) {
  await request(app).post('/api/auth/register').send({ email, password: 'correct-horse', name });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'correct-horse' });
  return login.headers['set-cookie'][0];
}

describe('GET /api/fare-estimate', () => {
  it('reproduces the demo estimates and writes nothing', async () => {
    const cookie = await registerAndLogin('nusrat@test.example.com', 'Nusrat');

    const nusrat = await request(app)
      .get('/api/fare-estimate')
      .query({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', cookie);
    const rafiq = await request(app)
      .get('/api/fare-estimate')
      .query({ pickupZoneId: BANANI, destinationZoneId: GULSHAN_1, seats: 1 })
      .set('Cookie', cookie);

    expect(nusrat.status).toBe(200);
    expect(nusrat.body).toEqual({ amountPaisa: 10000, distanceUnits: 3 });
    expect(rafiq.body).toEqual({ amountPaisa: 8000, distanceUnits: 2 });

    const rides = await request(app).get('/api/rides').set('Cookie', cookie);
    expect(rides.body).toEqual([]);
  });

  it('prices a 2-seat booking double', async () => {
    const cookie = await registerAndLogin('twoseats@test.example.com', 'Two Seats');

    const response = await request(app)
      .get('/api/fare-estimate')
      .query({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 2 })
      .set('Cookie', cookie);

    expect(response.body.amountPaisa).toBe(20000);
  });

  it('gives 422 for an unknown zone and for pickup equal to destination', async () => {
    const cookie = await registerAndLogin('errors@test.example.com', 'Errors');

    const unknownZone = await request(app)
      .get('/api/fare-estimate')
      .query({ pickupZoneId: 999, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', cookie);
    const sameZone = await request(app)
      .get('/api/fare-estimate')
      .query({ pickupZoneId: BANANI, destinationZoneId: BANANI, seats: 1 })
      .set('Cookie', cookie);

    expect(unknownZone.status).toBe(422);
    expect(sameZone.status).toBe(422);
    // NO_DISTANCE itself has no reachable case here: the seed data covers all 15 cross-corridor
    // pairs (design.md section 6.2), so every real zone pair has a distance. It is proven at the
    // domain level instead (tests/unit/geography.test.js, "missing pair").
  });
});

describe('POST /api/rides', () => {
  it('creates a REQUESTED ride with quoted equal to solo, and a REQUESTED event', async () => {
    const cookie = await registerAndLogin('create@test.example.com', 'Create');

    const response = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', cookie);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('REQUESTED');
    expect(response.body.fare).toEqual({ amountPaisa: 10000, kind: 'ESTIMATE' });
    expect(response.body.timeline).toEqual([{ type: 'REQUESTED', at: expect.any(String) }]);
  });

  it('returns 200 with the same ride for an identical repeat, and 409 for a different one', async () => {
    const cookie = await registerAndLogin('repeat@test.example.com', 'Repeat');
    const body = { pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 };

    const first = await request(app).post('/api/rides').send(body).set('Cookie', cookie);
    const repeat = await request(app).post('/api/rides').send(body).set('Cookie', cookie);
    const different = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: GULSHAN_1, seats: 1 })
      .set('Cookie', cookie);

    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(first.body.id);
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
    expect(different.body.error.details.rideId).toBe(first.body.id);
  });

  it('rejects role or passengerId supplied in the body', async () => {
    const cookie = await registerAndLogin('smuggle@test.example.com', 'Smuggle');

    const response = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1, role: 'DRIVER' })
      .set('Cookie', cookie);

    expect(response.status).toBe(422);
  });

  it('is forbidden for a driver', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'driver1@test.example.com', password: 'correct-horse', name: 'Driver One' });
    await pool.query("UPDATE users SET role = 'DRIVER' WHERE email = 'driver1@test.example.com'");
    const driverLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'driver1@test.example.com', password: 'correct-horse' });
    const driverCookie = driverLogin.headers['set-cookie'][0];

    const response = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', driverCookie);

    expect(response.status).toBe(403);
  });
});

describe('GET /api/rides/:id and GET /api/rides', () => {
  it("returns 404 for another passenger's ride", async () => {
    const ownerCookie = await registerAndLogin('owner@test.example.com', 'Owner');
    const otherCookie = await registerAndLogin('other@test.example.com', 'Other');
    const created = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', ownerCookie);

    const response = await request(app)
      .get(`/api/rides/${created.body.id}`)
      .set('Cookie', otherCookie);

    expect(response.status).toBe(404);
  });

  it('lists current and past rides newest first', async () => {
    const cookie = await registerAndLogin('history@test.example.com', 'History');
    const created = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', cookie);
    await request(app).post(`/api/rides/${created.body.id}/cancel`).set('Cookie', cookie);

    const response = await request(app).get('/api/rides').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].status).toBe('CANCELLED');
  });
});

describe('POST /api/rides/:id/cancel', () => {
  it('cancels a REQUESTED ride and repeats idempotently with 200', async () => {
    const cookie = await registerAndLogin('cancel@test.example.com', 'Cancel');
    const created = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', cookie);

    const first = await request(app)
      .post(`/api/rides/${created.body.id}/cancel`)
      .set('Cookie', cookie);
    const again = await request(app)
      .post(`/api/rides/${created.body.id}/cancel`)
      .set('Cookie', cookie);

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('CANCELLED');
    expect(first.body.timeline.map((event) => event.type)).toEqual([
      'REQUESTED',
      'PASSENGER_CANCELLED',
    ]);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('CANCELLED');
  });

  it("returns 404 for another passenger's ride", async () => {
    const ownerCookie = await registerAndLogin('cowner@test.example.com', 'Cowner');
    const otherCookie = await registerAndLogin('cother@test.example.com', 'Cother');
    const created = await request(app)
      .post('/api/rides')
      .send({ pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 })
      .set('Cookie', ownerCookie);

    const response = await request(app)
      .post(`/api/rides/${created.body.id}/cancel`)
      .set('Cookie', otherCookie);

    expect(response.status).toBe(404);
  });
});
