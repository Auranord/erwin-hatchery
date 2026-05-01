import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDist = path.resolve(__dirname, '../apps/web/dist');

export function buildApp() {
  const app = fastify({
    logger: true
  });

  app.register(registerHealthRoute);
  app.register(registerAuthRoutes);
  app.register(registerAdminRoutes);

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
