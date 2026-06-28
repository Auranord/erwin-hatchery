import type { FastifyInstance } from 'fastify';
import { finalizeSetupIfReady, getSetupStatus, runHealthCheck } from '../services/twitchIntegration.js';
import { syncChannelPointRedemptionEventSub } from '../services/twitchEventSub.js';

export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/setup/status', async () => getSetupStatus());

  app.get('/api/setup/twitch/login', async (_request, reply) => {
    return reply.code(410).send({
      message: 'Direct broadcaster Twitch setup is retired. Configure broadcaster OAuth in erwin-gateway.',
    });
  });

  app.get('/api/setup/twitch/callback', async (_request, reply) => {
    return reply.code(410).send({
      message: 'Direct broadcaster Twitch setup callback is retired. Configure broadcaster OAuth in erwin-gateway.',
    });
  });

  app.post('/api/setup/run-backfill', async (_request, reply) => {
    return reply.code(410).send({
      message: 'Direct Twitch backfills are retired. Use erwin-gateway backfills or admin inventory controls for manual first-launch grants.',
    });
  });

  app.post('/api/setup/resync-eventsub', async (request) => {
    await syncChannelPointRedemptionEventSub(request.log);
    await finalizeSetupIfReady();
    return getSetupStatus();
  });

  app.post('/api/setup/health-check', async (request) => runHealthCheck(request.log));
}
