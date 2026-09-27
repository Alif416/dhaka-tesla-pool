import { z } from 'zod';

/** Usability guard only; the real capacity rule is vehicles.capacity, checked from unit 06 on. */
const MAX_SEATS = 3;

const zoneIdQuery = z.coerce.number().int().positive();
const seatsQuery = z.coerce.number().int().min(1).max(MAX_SEATS);
const zoneIdBody = z.number().int().positive();
const seatsBody = z.number().int().min(1).max(MAX_SEATS);

export const fareEstimateQuerySchema = z
  .object({
    pickupZoneId: zoneIdQuery,
    destinationZoneId: zoneIdQuery,
    seats: seatsQuery,
  })
  .strict();

export const createRideBodySchema = z
  .object({
    pickupZoneId: zoneIdBody,
    destinationZoneId: zoneIdBody,
    seats: seatsBody,
  })
  .strict();

export const rideIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
