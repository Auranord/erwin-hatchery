import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerGameRoutes } from './routes/game.js';
import { registerEventSubRoutes } from './routes/eventsub.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerUserReportRoutes } from './routes/user-reports.js';
import { registerErwinGatewayRoutes } from './routes/erwin-gateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDist = path.resolve(__dirname, '../apps/web/dist');

export function buildApp() {
  const app = fastify({
    logger: true
  });

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const rawBodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const rawBody = rawBodyBuffer.toString('utf8');
      (request as typeof request & { rawBody?: string; rawBodyBuffer?: Buffer }).rawBody = rawBody;
      (request as typeof request & { rawBodyBuffer?: Buffer }).rawBodyBuffer = rawBodyBuffer;

      if (rawBody.trim() === '') {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(rawBody));
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  );

  app.register(registerHealthRoute);
  app.register(registerAuthRoutes);
  app.register(registerSetupRoutes);
  app.register(registerAdminRoutes);
  app.register(registerGameRoutes);
  app.register(registerUserReportRoutes);
  app.register(registerEventSubRoutes);
  app.register(registerErwinGatewayRoutes);

  app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    wildcard: false,
    decorateReply: true
  });

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ message: 'Not found' });
    }

    return reply.sendFile('index.html');
  });

  return app;
}
