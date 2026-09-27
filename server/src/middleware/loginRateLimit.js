import rateLimit from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/**
 * 10 attempts per 15 minutes per IP and email. Keyed on the pair so one user's failed logins
 * cannot lock out a different email from the same IP.
 * @returns {import('express').RequestHandler}
 */
export function createLoginRateLimit() {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many login attempts. Try again later.',
          details: {},
        },
      });
    },
  });
}
