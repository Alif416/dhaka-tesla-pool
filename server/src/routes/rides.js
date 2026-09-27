import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { serializePassengerRide } from '../serializers/passengerRideSerializer.js';
import {
  createRideBodySchema,
  fareEstimateQuerySchema,
  rideIdParamsSchema,
} from '../validation/rideSchemas.js';

/**
 * `GET /api/fare-estimate` is a sibling of `/api/rides`, not nested under it (design.md
 * section 8.2), so it gets its own router mounted at its own path.
 * @param {{ rideService: object, authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createFareEstimateRouter({ rideService, authenticate }) {
  const router = Router();

  router.get(
    '/',
    authenticate,
    requireRole('PASSENGER'),
    validate({ query: fareEstimateQuerySchema }),
    asyncHandler(async (req, res) => {
      const estimate = await rideService.estimateFare(req.actor, req.valid.query);
      res.status(200).json(estimate);
    }),
  );

  return router;
}

/**
 * @param {{ rideService: object, authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createRidesRouter({ rideService, authenticate }) {
  const router = Router();
  router.use(authenticate, requireRole('PASSENGER'));

  router.post(
    '/',
    validate({ body: createRideBodySchema }),
    asyncHandler(async (req, res) => {
      const { created, ...result } = await rideService.createRide(req.actor, req.valid.body);
      res.status(created ? 201 : 200).json(serializePassengerRide(result));
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rides = await rideService.listRides(req.actor);
      res.status(200).json(rides.map(serializePassengerRide));
    }),
  );

  router.get(
    '/:id',
    validate({ params: rideIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await rideService.getRide(req.actor, req.valid.params.id);
      res.status(200).json(serializePassengerRide(result));
    }),
  );

  router.post(
    '/:id/cancel',
    validate({ params: rideIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await rideService.cancelRide(req.actor, req.valid.params.id);
      res.status(200).json(serializePassengerRide(result));
    }),
  );

  return router;
}
