import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';

/**
 * Returns 403 unless the authenticated actor has the given role.
 * @param {'PASSENGER' | 'DRIVER'} role
 * @returns {import('express').RequestHandler}
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (req.actor?.role !== role) {
      next(new AppError(ERROR_CODES.FORBIDDEN, 403, 'Not allowed for this role.'));
      return;
    }
    next();
  };
}
