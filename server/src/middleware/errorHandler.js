import { ZodError } from 'zod';

import { mapConstraintError } from '../db/constraintErrors.js';
import { ERROR_CODES } from '../lib/errorCodes.js';
import { AppError } from '../lib/errors.js';

function sendError(res, status, code, message, details = {}) {
  res.status(status).json({ error: { code, message, details } });
}

/**
 * The only place an error becomes an HTTP response. Logs once here; lower layers must not log
 * and rethrow. Express requires all four parameters on an error-handling middleware.
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    if (error.status === 503 && error.details?.retryAfter) {
      res.set('Retry-After', String(error.details.retryAfter));
    }
    if (error.status >= 500) {
      req.log?.error({ err: error, code: error.code }, 'app_error');
    }
    sendError(res, error.status, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
    sendError(res, 422, ERROR_CODES.VALIDATION_FAILED, 'Invalid input.', {
      issues: error.issues,
    });
    return;
  }

  if (error.type?.startsWith('entity.') || error instanceof SyntaxError) {
    sendError(res, 400, ERROR_CODES.MALFORMED_JSON, 'Malformed JSON.');
    return;
  }

  const mapped = mapConstraintError(error);
  if (mapped) {
    const level = mapped.code === ERROR_CODES.CONSTRAINT_VIOLATION ? 'error' : 'warn';
    req.log?.[level]({ constraint: error.constraint, code: mapped.code }, 'constraint_violation');
    sendError(res, mapped.status, mapped.code, mapped.message);
    return;
  }

  req.log?.error({ err: error }, 'unhandled_error');
  sendError(res, 500, ERROR_CODES.INTERNAL, 'Something went wrong.');
}
