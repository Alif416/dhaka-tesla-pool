import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { serializeDriverPool } from '../serializers/driverSerializer.js';
import { poolIdParamsSchema, poolMemberParamsSchema } from '../validation/poolSchemas.js';

/**
 * @param {{ poolService: object, authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createPoolsRouter({ poolService, authenticate }) {
  const router = Router();
  router.use(authenticate, requireRole('DRIVER'));

  router.post(
    '/:id/arrive',
    validate({ params: poolIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await poolService.arriveAtPool(req.actor, req.valid.params.id);
      res.status(200).json(serializeDriverPool(result));
    }),
  );

  router.post(
    '/:id/start',
    validate({ params: poolIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await poolService.startPool(req.actor, req.valid.params.id);
      res.status(200).json(serializeDriverPool(result));
    }),
  );

  router.post(
    '/:id/cancel',
    validate({ params: poolIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await poolService.cancelPool(req.actor, req.valid.params.id);
      res.status(200).json(serializeDriverPool(result));
    }),
  );

  router.post(
    '/:id/members/:rideId/no-show',
    validate({ params: poolMemberParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await poolService.noShowMember(
        req.actor,
        req.valid.params.id,
        req.valid.params.rideId,
      );
      res.status(200).json(serializeDriverPool(result));
    }),
  );

  return router;
}
