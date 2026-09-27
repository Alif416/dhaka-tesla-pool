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
import { createHealthRouter } from './routes/health.js';
import { createFareEstimateRouter, createRidesRouter } from './routes/rides.js';
import { createZonesRouter } from './routes/zones.js';
import { createAuthService } from './services/authService.js';
import { createRideService } from './services/rideService.js';
import { loadZones } from './services/zoneService.js';

const BODY_LIMIT = '100kb';

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
  app.use('/api/rides', createRidesRouter({ rideService, authenticate }));

  app.use('/api', (req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Route not found.', details: {} } });
  });
  app.use(errorHandler);

  return app;
}
