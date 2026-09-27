/**
 * Parses `body`, `params` and `query` with the given Zod schemas and puts the results on
 * `req.valid`. A Zod failure is passed to `next` and mapped to 422 by `errorHandler`.
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny,
 *   query?: import('zod').ZodTypeAny }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate({ body, params, query } = {}) {
  return (req, res, next) => {
    try {
      req.valid = {
        ...(body && { body: body.parse(req.body) }),
        ...(params && { params: params.parse(req.params) }),
        ...(query && { query: query.parse(req.query) }),
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
