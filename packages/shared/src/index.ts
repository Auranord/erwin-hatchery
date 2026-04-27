import { z } from 'zod';

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  database: z.enum(['ok', 'error']),
  version: z.string()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
