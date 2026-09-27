/**
 * Expected failure carrying an HTTP status and a machine-readable code. Services throw this;
 * nothing else is thrown deliberately. `errorHandler` is the only place it becomes a response.
 */
export class AppError extends Error {
  /**
   * @param {string} code One of `lib/errorCodes.js`.
   * @param {number} status HTTP status code.
   * @param {string} message Human-readable message.
   * @param {object} [details] Extra machine-readable context, e.g. `{ rideId }`.
   */
  constructor(code, status, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
