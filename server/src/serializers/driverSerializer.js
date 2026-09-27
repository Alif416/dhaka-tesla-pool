import { getZoneById } from '../services/zoneService.js';

/**
 * Shapes one row of the advisory request list (design.md section 8.5): passenger name, pickup,
 * destination, seats, quotedFarePaisa, requested time.
 * @param {object} row Raw candidate row from listOpenRequestsForDriver.
 * @returns {object}
 */
export function serializeDriverRequestRow(row) {
  return {
    id: row.id,
    passenger: { name: row.passenger_name },
    pickup: getZoneById(row.pickup_zone_id)?.name ?? null,
    destination: getZoneById(row.destination_zone_id)?.name ?? null,
    seats: row.seats,
    quotedFarePaisa: row.quoted_fare_paisa,
    requestedAt: row.created_at,
  };
}

/**
 * Shapes the driver's current pool: vehicle, status, occupied/capacity, and every member with
 * their own route, seats, status and fare. `null` when there is no active pool.
 * @param {{ pool: object | null, vehicle: object, members: object[], occupiedSeats: number }} input
 * @returns {object | null}
 */
export function serializeDriverPool({ pool, vehicle, members, occupiedSeats }) {
  if (!pool) {
    return null;
  }
  return {
    id: pool.id,
    status: pool.status,
    vehicle: { name: vehicle.name, registrationNo: vehicle.registration_no },
    occupiedSeats,
    capacity: vehicle.capacity,
    members: members.map((member) => ({
      rideId: member.ride_request_id,
      passenger: { name: member.passenger_name },
      pickup: getZoneById(member.pickup_zone_id)?.name ?? null,
      destination: getZoneById(member.destination_zone_id)?.name ?? null,
      seats: member.seats,
      status: member.ride_status,
      fare: {
        amountPaisa: member.final_fare_paisa ?? member.quoted_fare_paisa,
        kind: member.final_fare_paisa === null ? 'ESTIMATE' : 'FINAL',
      },
      uncappedFarePaisa: member.uncapped_fare_paisa ?? null,
      paymentStatus: member.payment_status ?? null,
    })),
  };
}
