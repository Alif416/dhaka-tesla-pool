import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { requireRole } from '../middleware/requireRole.js';
import { serializeDriverPool, serializeDriverRequestRow } from '../serializers/driverSerializer.js';

/**
 * @param {{ driverService: object, authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createDriverRouter({ driverService, authenticate }) {
  const router = Router();
  router.use(authenticate, requireRole('DRIVER'));

  router.post(
    '/online',
    asyncHandler(async (req, res) => {
      const vehicle = await driverService.goOnline(req.actor);
      res
        .status(200)
        .json({ online: vehicle.online, name: vehicle.name, capacity: vehicle.capacity });
    }),
  );

  router.post(
    '/offline',
    asyncHandler(async (req, res) => {
      const vehicle = await driverService.goOffline(req.actor);
      res
        .status(200)
        .json({ online: vehicle.online, name: vehicle.name, capacity: vehicle.capacity });
    }),
  );

  router.get(
    '/requests',
    asyncHandler(async (req, res) => {
      const requests = await driverService.listRequests(req.actor);
      res.status(200).json(requests.map(serializeDriverRequestRow));
    }),
  );

  router.get(
    '/pool',
    asyncHandler(async (req, res) => {
      const result = await driverService.getCurrentPool(req.actor);
      res.status(200).json(serializeDriverPool(result));
    }),
  );

  router.get(
    '/history',
    asyncHandler(async (req, res) => {
      const history = await driverService.getHistory(req.actor);
      res.status(200).json(history.map(serializeDriverPool));
    }),
  );

  return router;
}
