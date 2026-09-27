import { parseDurationMs } from './duration.js';

const COOKIE_NAME = 'rp_session';

function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.COOKIE_SECURE,
  };
}

/**
 * Sets the session cookie. The token itself is never returned in a response body.
 * @param {import('express').Response} res
 * @param {string} token
 * @param {object} config
 */
export function setSessionCookie(res, token, config) {
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(config),
    maxAge: parseDurationMs(config.JWT_EXPIRES_IN),
  });
}

/**
 * Clears the session cookie. Logout only; there is no server-side revocation.
 * @param {import('express').Response} res
 * @param {object} config
 */
export function clearSessionCookie(res, config) {
  res.clearCookie(COOKIE_NAME, cookieOptions(config));
}
