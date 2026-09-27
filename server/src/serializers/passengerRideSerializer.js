import { getZoneById } from '../services/zoneService.js';

/**
 * Shapes a ride and its timeline for the passenger who owns it. `driver`, `vehicle` and
 * `payment` are null and `sharedPassengerCount` is 0 until the ride is an active pool member
 * (`poolInfo` is supplied); `payment` is still always null until unit 08 freezes it at start.
 * Never includes another passenger's name, destination, fare or id.
 * @param {{ ride: object, timeline: { event_type: string, created_at: Date }[],
 *   poolInfo?: { driver_name: string, vehicle_name: string, registration_no: string,
 *     active_member_count: number } | null }} input
 * @returns {object}
 */
export function serializePassengerRide({ ride, timeline, poolInfo = null }) {
  const pickupZone = getZoneById(ride.pickup_zone_id);
  const destinationZone = getZoneById(ride.destination_zone_id);
  return {
    id: ride.id,
    status: ride.status,
    pickup: pickupZone?.name ?? null,
    destination: destinationZone?.name ?? null,
    seats: ride.seats,
    fare: { amountPaisa: ride.quoted_fare_paisa, kind: 'ESTIMATE' },
    driver: poolInfo ? { name: poolInfo.driver_name } : null,
    vehicle: poolInfo
      ? { name: poolInfo.vehicle_name, registrationNo: poolInfo.registration_no }
      : null,
    sharedPassengerCount: poolInfo ? poolInfo.active_member_count - 1 : 0,
    payment: null,
    timeline: timeline.map((event) => ({ type: event.event_type, at: event.created_at })),
  };
}
