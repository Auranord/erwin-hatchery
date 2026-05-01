import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { healthResponseSchema } from '@erwin/shared';
import { config } from '../config.js';
import { checkDatabaseHealth } from '../db/client.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  const healthRouteOptions: RouteShorthandOptions = {
    logLevel: config.LOG_HEALTHCHECK_REQUESTS ? 'info' : 'silent'
  };

  app.get(
    '/api/health',
    healthRouteOptions,
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
