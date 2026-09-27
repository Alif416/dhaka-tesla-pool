import { request } from './client.js';

/**
 * @param {{ pickupZoneId: number, destinationZoneId: number, seats: number }} input
 * @returns {Promise<{ amountPaisa: number, distanceUnits: number }>}
 */
export function estimateFare({ pickupZoneId, destinationZoneId, seats }) {
  const query = new URLSearchParams({
    pickupZoneId: String(pickupZoneId),
    destinationZoneId: String(destinationZoneId),
    seats: String(seats),
  });
  return request(`/api/fare-estimate?${query}`);
}

/**
 * @param {{ pickupZoneId: number, destinationZoneId: number, seats: number }} input
 * @returns {Promise<object>} The created (or identical existing) ride.
 */
export function createRide(input) {
  return request('/api/rides', { method: 'POST', body: input });
}

/** @returns {Promise<object[]>} Current and past rides. */
export function listRides() {
  return request('/api/rides');
}

/**
 * @param {string} rideId
 * @returns {Promise<object>}
 */
export function getRide(rideId) {
  return request(`/api/rides/${rideId}`);
}

/**
 * @param {string} rideId
 * @returns {Promise<object>} The cancelled ride.
 */
export function cancelRide(rideId) {
  return request(`/api/rides/${rideId}/cancel`, { method: 'POST' });
}

/**
 * @param {string} rideId
 * @returns {Promise<object>} The completed ride.
 */
export function completeRide(rideId) {
  return request(`/api/rides/${rideId}/complete`, { method: 'POST' });
}
