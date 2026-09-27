import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';

/**
 * Requires `Content-Type: application/json` on a POST that carries a body. Together with
 * `SameSite=Lax` cookies and no CORS, this covers CSRF on mutating routes: a simple cross-site
 * form cannot set an arbitrary Content-Type.
 * @type {import('express').RequestHandler}
 */
export function enforceJsonContentType(req, res, next) {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (req.method === 'POST' && contentLength > 0 && !req.is('application/json')) {
    next(new AppError(ERROR_CODES.MALFORMED_JSON, 400, 'Content-Type must be application/json.'));
    return;
  }
  next();
}
