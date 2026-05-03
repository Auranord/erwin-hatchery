import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { healthResponseSchema } from '@erwin/shared';
import { config } from '../config.js';
import { checkDatabaseHealth, checkEggTypeCatalogHealth } from '../db/client.js';

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

  app.get('/api/admin/health', healthRouteOptions, async (_request, reply) => {
    const [databaseHealthy, hasEggTypeRows] = await Promise.all([
      checkDatabaseHealth(),
      checkEggTypeCatalogHealth()
    ]);

    if (!databaseHealthy) {
      return reply.code(503).send({ ok: false, code: 'DATABASE_UNAVAILABLE', message: 'Database health check failed.' });
    }

    if (!hasEggTypeRows) {
      return reply.code(503).send({ ok: false, code: 'NO_EGG_TYPES', message: 'No egg types configured.' });
    }

    return {
      ok: true,
      code: 'OK'
    };
  });
}
