import { buildApp } from './app.js';
import { config } from './config.js';
import { checkActiveEggTypesHealth, ensureCoreSchema } from './db/client.js';
import { syncChannelPointRedemptionEventSub } from './services/twitchEventSub.js';
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
    app.log.info('Subscriber status startup sync skipped; player subscription state is not derived from subscription events');
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`API listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
