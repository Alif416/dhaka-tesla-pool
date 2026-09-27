/**
 * The only place `fetch` is called. Everything else calls the named functions in the other
 * `api/*.js` modules.
 */

/** Thrown for any non-2xx response. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {object} details
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = null;

/**
 * Registers the single handler called on a 401 response. Set once by AuthProvider.
 * @param {() => void} handler
 */
export function registerUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * @param {string} path Starts with `/api`.
 * @param {{ method?: string, body?: object }} [options]
 * @returns {Promise<unknown>} The parsed JSON body, or `undefined` for a 204.
 */
export async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'INTERNAL',
      error.message ?? 'Something went wrong.',
      error.details ?? {},
    );
  }

  return payload;
}
