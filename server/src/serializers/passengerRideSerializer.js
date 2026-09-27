import { getZoneById } from '../services/zoneService.js';

/**
 * Shapes a ride and its timeline for the passenger who owns it. `driver`, `vehicle` and
 * `payment` are null and `sharedPassengerCount` is 0 until a pool exists (unit 07 on). Never
 * includes another passenger's name, destination, fare or id — there is none to include here.
 * @param {{ ride: object, timeline: { event_type: string, created_at: Date }[] }} input
 * @returns {object}
 */
export function serializePassengerRide({ ride, timeline }) {
  const pickupZone = getZoneById(ride.pickup_zone_id);
  const destinationZone = getZoneById(ride.destination_zone_id);
  return {
    id: ride.id,
    status: ride.status,
    pickup: pickupZone?.name ?? null,
    destination: destinationZone?.name ?? null,
    seats: ride.seats,
    fare: { amountPaisa: ride.quoted_fare_paisa, kind: 'ESTIMATE' },
    driver: null,
    vehicle: null,
    sharedPassengerCount: 0,
    payment: null,
    timeline: timeline.map((event) => ({ type: event.event_type, at: event.created_at })),
  };
}
