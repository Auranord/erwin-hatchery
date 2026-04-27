import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`API listening on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
