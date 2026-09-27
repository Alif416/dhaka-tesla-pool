import { z } from 'zod';

export const paymentIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
