import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { serializeDriverPayment } from '../serializers/driverSerializer.js';
import { paymentIdParamsSchema } from '../validation/paymentSchemas.js';

/**
 * @param {{ poolService: object, authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createPaymentsRouter({ poolService, authenticate }) {
  const router = Router();
  router.use(authenticate, requireRole('DRIVER'));

  router.post(
    '/:id/collect',
    validate({ params: paymentIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await poolService.collectCash(req.actor, req.valid.params.id);
      res.status(200).json(serializeDriverPayment(result));
    }),
  );

  return router;
}
