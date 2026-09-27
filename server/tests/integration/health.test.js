import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createPool } from '../../src/db/client.js';
import { buildTestApp } from '../helpers/app.js';

const { app, pool, config } = buildTestApp();

afterAll(async () => {
  await pool.end();
});

describe('GET /api/health', () => {
  it('returns ok when the database answers SELECT 1', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const deadPool = createPool('postgres://ridepool:ridepool@127.0.0.1:1/ridepool');

    const response = await request(createApp({ pool: deadPool, config })).get('/api/health');
    await deadPool.end();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
  });

  it('returns the JSON error shape with 404 for an unknown api path', async () => {
    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found.', details: {} },
    });
  });
});
