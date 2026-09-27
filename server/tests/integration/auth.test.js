import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthenticate } from '../../src/middleware/authenticate.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { requireRole } from '../../src/middleware/requireRole.js';
import { buildTestApp } from '../helpers/app.js';
import { resetDb } from '../helpers/db.js';

const { app, pool, config } = await buildTestApp();

const registerBody = { email: 'Nusrat@Example.com', password: 'correct-horse', name: 'Nusrat' };

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

describe('POST /api/auth/register', () => {
  it('creates a passenger, lowercases the email, and never returns a hash', async () => {
    const response = await request(app).post('/api/auth/register').send(registerBody);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      name: 'Nusrat',
      email: 'nusrat@example.com',
      role: 'PASSENGER',
    });
    expect(response.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/hash/i);
  });

  it('rejects a second registration with the same email', async () => {
    await request(app).post('/api/auth/register').send(registerBody);

    const response = await request(app).post('/api/auth/register').send(registerBody);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a role supplied in the body', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...registerBody, role: 'DRIVER' });

    expect(response.status).toBe(422);
  });

  it('rejects a short password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...registerBody, password: 'short' });

    expect(response.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  async function registerAndReturnCredentials() {
    await request(app).post('/api/auth/register').send(registerBody);
    return { email: registerBody.email.toLowerCase(), password: registerBody.password };
  }

  it('sets the session cookie with the right flags and no token in the body', async () => {
    const credentials = await registerAndReturnCredentials();

    const response = await request(app).post('/api/auth/login').send(credentials);

    expect(response.status).toBe(200);
    const cookieHeader = response.headers['set-cookie'][0];
    expect(cookieHeader).toMatch(/^rp_session=/);
    expect(cookieHeader).toMatch(/HttpOnly/);
    expect(cookieHeader).toMatch(/SameSite=Lax/);
    expect(cookieHeader).toMatch(/Path=\//);
    expect(cookieHeader).not.toMatch(/Secure/);
    expect(cookieHeader).toMatch(/Max-Age=28800/); // 8 hours
    expect(JSON.stringify(response.body)).not.toMatch(/eyJ/); // no raw JWT in the body
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const credentials = await registerAndReturnCredentials();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'not the password' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('sets Secure only when COOKIE_SECURE is true', async () => {
    const secureApp = await buildTestApp({ COOKIE_SECURE: 'true' });
    await secureApp.pool.query('SELECT 1');
    await request(secureApp.app).post('/api/auth/register').send(registerBody);

    const response = await request(secureApp.app).post('/api/auth/login').send({
      email: registerBody.email.toLowerCase(),
      password: registerBody.password,
    });

    expect(response.headers['set-cookie'][0]).toMatch(/Secure/);
    await secureApp.pool.end();
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 with no cookie', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 with an invalid cookie', async () => {
    const response = await request(app).get('/api/auth/me').set('Cookie', 'rp_session=garbage');

    expect(response.status).toBe(401);
  });

  it('returns the current user with a valid cookie', async () => {
    await request(app).post('/api/auth/register').send(registerBody);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: registerBody.email.toLowerCase(), password: registerBody.password });
    const cookie = login.headers['set-cookie'][0];

    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe('nusrat@example.com');
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204 and clears the cookie', async () => {
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(204);
    expect(response.headers['set-cookie'][0]).toMatch(/rp_session=;/);
  });
});

describe('role enforcement', () => {
  it('returns 403 when a passenger calls a driver-only route', async () => {
    await request(app).post('/api/auth/register').send(registerBody);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: registerBody.email.toLowerCase(), password: registerBody.password });
    const cookie = login.headers['set-cookie'][0];

    // A tiny standalone app, not the real router, just to prove requireRole in isolation.
    const testApp = express();
    testApp.use(cookieParser());
    testApp.use(createAuthenticate({ jwtSecret: config.JWT_SECRET }));
    testApp.get('/driver-only', requireRole('DRIVER'), (req, res) => {
      res.status(200).json({ ok: true });
    });
    testApp.use(errorHandler);

    const response = await request(testApp).get('/driver-only').set('Cookie', cookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

describe('login rate limiting', () => {
  it('returns 429 on the eleventh attempt within the window', async () => {
    await registerAndReturnCredentialsForRateLimit();

    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rate-limit-target@example.com', password: 'wrong-password-1' });
    }

    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });

  async function registerAndReturnCredentialsForRateLimit() {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'rate-limit-target@example.com', password: 'correct-horse', name: 'Target' });
  }
});

describe('request body rules', () => {
  it('returns 400 for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });

  it('rejects a POST body without a JSON content type', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('email=a@example.com&password=x');

    expect(response.status).toBe(400);
  });
});
