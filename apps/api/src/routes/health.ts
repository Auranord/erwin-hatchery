import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@erwin/shared';
import { config } from '../config.js';
import { checkDatabaseHealth } from '../db/client.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/health',
    { logLevel: config.LOG_HEALTHCHECK_REQUESTS ? 'info' : 'silent' },
    async () => {
      const database = (await checkDatabaseHealth()) ? 'ok' : 'error';
      return healthResponseSchema.parse({
        ok: true,
        database,
        version: process.env.npm_package_version ?? '0.1.0'
      });
    }
  );
}
