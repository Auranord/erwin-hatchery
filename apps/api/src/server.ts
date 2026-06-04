import { buildApp } from './app.js';
import { config } from './config.js';
import { checkActiveEggTypesHealth, ensureCoreSchema } from './db/client.js';
import { syncChannelPointRedemptionEventSub, syncSubscriberStatusFromRecentEvents, syncSubscriberStatusFromTwitch } from './services/twitchEventSub.js';
import { smokeCheckErwinGateway } from './services/erwinGatewayClient.js';

const app = buildApp();

const start = async (): Promise<void> => {
  try {
    await ensureCoreSchema();
    const hasActiveEggTypes = await checkActiveEggTypesHealth();
    if (!hasActiveEggTypes) {
      throw new Error('NO_ACTIVE_EGG_TYPES: At least one active egg type is required before startup. Run seed after migrations.');
    }
    const gatewaySmoke = await smokeCheckErwinGateway();
    if (!gatewaySmoke.ok) {
      const logPayload = { required: gatewaySmoke.required, retryable: gatewaySmoke.retryable };
      if (config.ERWIN_GATEWAY_REQUIRED) {
        throw new Error(`ERWIN_GATEWAY_REQUIRED smoke check failed: ${gatewaySmoke.error}`);
      }
      app.log.warn(logPayload, 'erwin-gateway smoke check failed; continuing because gateway is not required');
    }
    await syncChannelPointRedemptionEventSub(app.log);
    try {
      await syncSubscriberStatusFromTwitch(app.log);
    } catch (error) {
      app.log.warn({ err: error }, 'Subscriber startup sync from Twitch failed, falling back to recent EventSub replay');
      await syncSubscriberStatusFromRecentEvents(app.log);
    }
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`API listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
