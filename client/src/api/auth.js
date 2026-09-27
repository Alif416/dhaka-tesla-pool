import { request } from './client.js';

/**
 * @param {{ email: string, password: string, name: string }} input
 * @returns {Promise<object>} The created user.
 */
export function register(input) {
  return request('/api/auth/register', { method: 'POST', body: input });
}

/**
 * @param {{ email: string, password: string }} input
 * @returns {Promise<object>} The signed-in user.
 */
export function login(input) {
  return request('/api/auth/login', { method: 'POST', body: input });
}

/** @returns {Promise<void>} */
export function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

/** @returns {Promise<object>} The current user. */
export function me() {
  return request('/api/auth/me');
}
