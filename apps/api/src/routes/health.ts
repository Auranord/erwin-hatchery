import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@erwin/shared';
import { checkDatabaseHealth } from '../db/client.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const database = (await checkDatabaseHealth()) ? 'ok' : 'error';
    return healthResponseSchema.parse({
      ok: true,
      database,
      version: process.env.npm_package_version ?? '0.1.0'
    });
  });
}
