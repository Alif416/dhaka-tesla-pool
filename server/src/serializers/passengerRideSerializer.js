import { getZoneById } from '../services/zoneService.js';

/**
 * Shapes a ride and its timeline for the passenger who owns it. `driver`, `vehicle` and
 * `sharedPassengerCount` reflect `poolInfo` once the ride is an active pool member; `fare` and
 * `payment` reflect `payment` once one has been frozen (at `STARTED`) — `fare.kind` is
 * `ESTIMATE` until then, `FINAL` after. Never includes another passenger's name, destination,
 * fare or id.
 * @param {{ ride: object, timeline: { event_type: string, created_at: Date }[],
 *   poolInfo?: { driver_name: string, vehicle_name: string, registration_no: string,
 *     active_member_count: number } | null,
 *   payment?: { final_fare_paisa: number, status: string } | null }} input
 * @returns {object}
 */
export function serializePassengerRide({ ride, timeline, poolInfo = null, payment = null }) {
  const pickupZone = getZoneById(ride.pickup_zone_id);
  const destinationZone = getZoneById(ride.destination_zone_id);
  return {
    id: ride.id,
    status: ride.status,
    pickup: pickupZone?.name ?? null,
    destination: destinationZone?.name ?? null,
    seats: ride.seats,
    fare: payment
      ? { amountPaisa: payment.final_fare_paisa, kind: 'FINAL' }
      : { amountPaisa: ride.quoted_fare_paisa, kind: 'ESTIMATE' },
    driver: poolInfo ? { name: poolInfo.driver_name } : null,
    vehicle: poolInfo
      ? { name: poolInfo.vehicle_name, registrationNo: poolInfo.registration_no }
      : null,
    sharedPassengerCount: poolInfo ? poolInfo.active_member_count - 1 : 0,
    payment: payment ? { amountPaisa: payment.final_fare_paisa, status: payment.status } : null,
    timeline: timeline.map((event) => ({ type: event.event_type, at: event.created_at })),
  };
}
