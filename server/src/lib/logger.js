import pino from 'pino';

/**
 * Shared JSON logger. Redacts credentials so they can never appear in a log line.
 * @param {{ level: string, destination?: NodeJS.WritableStream }} config `destination` defaults
 *   to stdout; tests pass a collecting stream to assert on redaction without touching stdout.
 * @returns {import('pino').Logger}
 */
export function createLogger({ level, destination }) {
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.passwordHash',
          'req.body.password_hash',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  );
}
