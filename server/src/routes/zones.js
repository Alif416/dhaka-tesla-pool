import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { getZones } from '../services/zoneService.js';

/**
 * @param {{ authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createZonesRouter({ authenticate }) {
  const router = Router();

  router.get(
    '/',
    authenticate,
    asyncHandler(async (req, res) => {
      const zones = getZones().map((zone) => ({
        id: zone.id,
        name: zone.name,
        corridor: zone.corridor,
        position: zone.position,
      }));
      res.status(200).json(zones);
    }),
  );

  return router;
}
