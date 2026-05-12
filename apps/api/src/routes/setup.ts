import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import {
  REQUIRED_BROADCASTER_SCOPES,
  clearSetupStateCookie,
  completeSetupOAuth,
  createSetupStateCookie,
  finalizeSetupIfReady,
  getSetupStatus,
  runAllBackfills,
  runHealthCheck,
  setupRedirectUri,
  validateSetupState
} from '../services/twitchIntegration.js';
import { syncChannelPointRedemptionEventSub } from '../services/twitchEventSub.js';

export async function registerSetupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/setup/status', async () => getSetupStatus());

  app.get('/api/setup/twitch/login', async (_request, reply) => {
    const state = createSetupStateCookie(reply);
    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id', config.TWITCH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', setupRedirectUri());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', REQUIRED_BROADCASTER_SCOPES.join(' '));
    authUrl.searchParams.set('state', state);
    return reply.redirect(authUrl.toString());
  });

  app.get('/api/setup/twitch/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    if (!query.code || !validateSetupState(request, query.state)) {
      return reply.code(400).send({ message: 'Invalid OAuth state' });
    }
    try {
      await completeSetupOAuth(query.code, request.log);
      clearSetupStateCookie(reply);
      return reply.redirect('/');
    } catch (error) {
      request.log.error({ err: error }, 'Twitch setup callback failed');
      clearSetupStateCookie(reply);
      return reply.code(400).send({ message: error instanceof Error ? error.message : 'Twitch setup failed' });
    }
  });

  app.post('/api/setup/run-backfill', async (request) => {
    await runAllBackfills(request.log);
    return getSetupStatus();
  });

  app.post('/api/setup/resync-eventsub', async (request) => {
    await syncChannelPointRedemptionEventSub(request.log);
    await finalizeSetupIfReady();
    return getSetupStatus();
  });

  app.post('/api/setup/health-check', async (request) => runHealthCheck(request.log));
}
