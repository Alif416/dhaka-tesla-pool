/**
 * Wraps an async Express handler so a rejected promise reaches `errorHandler` instead of
 * crashing the process. Every route handler in this app is wrapped with this.
 * @param {(req: import('express').Request, res: import('express').Response,
 *   next: import('express').NextFunction) => Promise<void>} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
