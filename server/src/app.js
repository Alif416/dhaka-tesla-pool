import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { createWithTx } from './db/tx.js';
import { createLogger } from './lib/logger.js';
import { createAuthenticate } from './middleware/authenticate.js';
import { enforceJsonContentType } from './middleware/enforceJsonContentType.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createLoginRateLimit } from './middleware/loginRateLimit.js';
import { createAuthRouter } from './routes/auth.js';
import { createDriverRouter } from './routes/driver.js';
import { createHealthRouter } from './routes/health.js';
import { createPaymentsRouter } from './routes/payments.js';
import { createPoolsRouter } from './routes/pools.js';
import {
  createFareEstimateRouter,
  createRideAcceptRouter,
  createRidesRouter,
} from './routes/rides.js';
import { createZonesRouter } from './routes/zones.js';
import { createAuthService } from './services/authService.js';
import { createDriverService } from './services/driverService.js';
import { createPoolService } from './services/poolService.js';
import { createRideService } from './services/rideService.js';
import { loadZones } from './services/zoneService.js';

const BODY_LIMIT = '100kb';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Builds the Express app. Kept separate from index.js so tests can import it. Async because it
 * loads the immutable zone reference data into memory before serving any request.
 * @param {{ pool: import('pg').Pool, config: object }} deps
 * @returns {Promise<import('express').Express>}
 */
export async function createApp({ pool, config }) {
  await loadZones(pool);

  const app = express();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const withTx = createWithTx(pool);
  const authenticate = createAuthenticate({ jwtSecret: config.JWT_SECRET });
  const authService = createAuthService({ withTx, config });
  const rideService = createRideService({ withTx });
  const driverService = createDriverService({ withTx });
  const poolService = createPoolService({ withTx });
  const loginRateLimit = createLoginRateLimit();

  app.use(pinoHttp({ logger }));
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(enforceJsonContentType);

  app.use('/api', createHealthRouter({ pool }));
  app.use('/api/auth', createAuthRouter({ authService, config, loginRateLimit, authenticate }));
  app.use('/api/zones', createZonesRouter({ authenticate }));
  app.use('/api/fare-estimate', createFareEstimateRouter({ rideService, authenticate }));
  app.use('/api/rides', createRideAcceptRouter({ poolService, authenticate }));
  app.use('/api/rides', createRidesRouter({ rideService, authenticate }));
  app.use('/api/driver', createDriverRouter({ driverService, authenticate }));
  app.use('/api/pools', createPoolsRouter({ poolService, authenticate }));
  app.use('/api/payments', createPaymentsRouter({ poolService, authenticate }));

  app.use('/api', (req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Route not found.', details: {} } });
  });

  // The built client (present only in the Docker image; local dev uses Vite's own server and
  // proxy, per design.md section 14). Static files first, then a SPA fallback to index.html for
  // any other GET, so client-side routes work on a direct load or refresh.
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
    app.get('*', (req, res) => {
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
