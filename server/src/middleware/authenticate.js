import jwt from 'jsonwebtoken';

import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';

const UNAUTHENTICATED = new AppError(ERROR_CODES.UNAUTHENTICATED, 401, 'Sign in required.');

/**
 * Builds the `authenticate` middleware bound to one JWT secret. Verifies the `rp_session`
 * cookie and sets `req.actor = { id, role }`. Nothing else in the app sets identity.
 * @param {{ jwtSecret: string }} deps
 * @returns {import('express').RequestHandler}
 */
export function createAuthenticate({ jwtSecret }) {
  return function authenticate(req, res, next) {
    const token = req.cookies?.rp_session;
    if (!token) {
      next(UNAUTHENTICATED);
      return;
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.actor = { id: payload.sub, role: payload.role };
      next();
    } catch {
      next(UNAUTHENTICATED);
    }
  };
}
