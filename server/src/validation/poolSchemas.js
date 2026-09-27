import { z } from 'zod';

export const poolIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const poolMemberParamsSchema = z
  .object({ id: z.string().uuid(), rideId: z.string().uuid() })
  .strict();
