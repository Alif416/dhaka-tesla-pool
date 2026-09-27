import { z } from 'zod';

const email = z.string().trim().toLowerCase().email();

// bcrypt silently ignores bytes past 72; the upper bound keeps that from being surprising.
const password = z.string().min(8).max(72);

export const registerBodySchema = z
  .object({
    email,
    password,
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export const loginBodySchema = z
  .object({
    email,
    password: z.string().min(1),
  })
  .strict();
