import { buildApp } from './app.js';
import { config } from './config.js';
import { checkActiveEggTypesHealth, ensureCoreSchema } from './db/client.js';

const app = buildApp();

const start = async (): Promise<void> => {
  try {
    await ensureCoreSchema();
    const hasActiveEggTypes = await checkActiveEggTypesHealth();
    if (!hasActiveEggTypes) {
      throw new Error('NO_ACTIVE_EGG_TYPES: At least one active egg type is required before startup. Run seed after migrations.');
    }
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`API listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
