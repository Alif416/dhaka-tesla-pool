import { request } from './client.js';

/** @returns {Promise<object[]>} All zones. */
export function listZones() {
  return request('/api/zones');
}
