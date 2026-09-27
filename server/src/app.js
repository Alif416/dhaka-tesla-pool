import express from 'express';

import { createHealthRouter } from './routes/health.js';

const BODY_LIMIT = '100kb';

/**
 * Builds the Express app. Kept separate from index.js so tests can import it.
 * @param {{ pool: import('pg').Pool }} deps
 * @returns {import('express').Express}
 */
export function createApp({ pool }) {
  const app = express();

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use('/api', createHealthRouter({ pool }));
  app.use('/api', (req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Route not found.', details: {} } });
  });

  return app;
}
