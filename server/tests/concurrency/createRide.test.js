import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import { resetDb } from '../helpers/db.js';

const { app, pool } = await buildTestApp();

afterAll(() => pool.end());
beforeEach(() => resetDb(pool));

const BANANI = 1;
const MOHAKHALI = 3;

async function registerAndLogin(email) {
  await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse', name: 'Racer' });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'correct-horse' });
  return login.headers['set-cookie'][0];
}

describe('C6: concurrent create ride for one passenger', () => {
  it('produces exactly one ride across 20 iterations of two parallel identical creates', async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const email = `c6-${iteration}@test.example.com`;
      const cookie = await registerAndLogin(email);
      const body = { pickupZoneId: BANANI, destinationZoneId: MOHAKHALI, seats: 1 };

      const [first, second] = await Promise.all([
        request(app).post('/api/rides').send(body).set('Cookie', cookie),
        request(app).post('/api/rides').send(body).set('Cookie', cookie),
      ]);

      // Exactly one request creates the ride. The other, depending on how the two transactions
      // interleave, either sees it as an identical repeat (200) or hits the database's own
      // partial unique index first (409) — design.md section 13.3 (C6) allows either outcome.
      const responses = [first, second];
      const creators = responses.filter((response) => response.status === 201);
      const others = responses.filter((response) => response.status !== 201);
      expect(creators).toHaveLength(1);
      expect(others).toHaveLength(1);
      expect([200, 409]).toContain(others[0].status);
      if (others[0].status === 200) {
        expect(others[0].body.id).toBe(creators[0].body.id);
      } else {
        expect(others[0].body.error.code).toBe('ACTIVE_RIDE_EXISTS');
      }

      const { rows } = await pool.query(
        'SELECT count(*)::int AS n FROM ride_requests WHERE passenger_id = (SELECT id FROM users WHERE email = $1)',
        [email],
      );
      expect(rows[0].n).toBe(1);
    }
  });
});
