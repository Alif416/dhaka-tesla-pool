import { Router } from 'express';

import { asyncHandler } from '../lib/asyncHandler.js';
import { clearSessionCookie, setSessionCookie } from '../lib/sessionCookie.js';
import { serializeUser } from '../serializers/userSerializer.js';
import { loginBodySchema, registerBodySchema } from '../validation/authSchemas.js';
import { validate } from '../middleware/validate.js';

/**
 * @param {{ authService: object, config: object, loginRateLimit: import('express').RequestHandler,
 *   authenticate: import('express').RequestHandler }} deps
 * @returns {import('express').Router}
 */
export function createAuthRouter({ authService, config, loginRateLimit, authenticate }) {
  const router = Router();

  router.post(
    '/register',
    validate({ body: registerBodySchema }),
    asyncHandler(async (req, res) => {
      const user = await authService.registerPassenger(req.valid.body);
      res.status(201).json(serializeUser(user));
    }),
  );

  router.post(
    '/login',
    loginRateLimit,
    validate({ body: loginBodySchema }),
    asyncHandler(async (req, res) => {
      const { user, token } = await authService.login(req.valid.body);
      setSessionCookie(res, token, config);
      res.status(200).json(serializeUser(user));
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      clearSessionCookie(res, config);
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
      const user = await authService.getMe(req.actor);
      res.status(200).json(serializeUser(user));
    }),
  );

  return router;
}
