import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { serializeDriverPool } from '../serializers/driverSerializer.js';
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
 * `POST /api/rides/:id/accept` is driver-only, unlike the rest of `/api/rides`, so it is its own
 * router mounted at the same prefix rather than added to `createRidesRouter`'s passenger-only
 * one (Express tries each router mounted at a prefix in turn; there is no path overlap since
 * every passenger route here has a different path or method).
 * @param {{ poolService: object, authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createRideAcceptRouter({ poolService, authenticate }) {
  const router = Router();

  router.post(
    '/:id/accept',
    authenticate,
    requireRole('DRIVER'),
    validate({ params: rideIdParamsSchema }),
    asyncHandler(async (req, res) => {
      const result = await poolService.acceptRide(req.actor, req.valid.params.id);
      res.status(200).json(serializeDriverPool(result));
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
