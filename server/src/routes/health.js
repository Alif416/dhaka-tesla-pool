import { Router } from 'express';

import { checkConnection } from '../db/client.js';

/**
 * @param {{ pool: import('pg').Pool }} deps
 * @returns {import('express').Router}
 */
export function createHealthRouter({ pool }) {
  const router = Router();

  router.get('/health', async (req, res) => {
    const isDatabaseUp = await checkConnection(pool);
    if (isDatabaseUp) {
      res.status(200).json({ status: 'ok' });
      return;
    }
    res.status(503).json({ status: 'unavailable' });
  });

  return router;
}
