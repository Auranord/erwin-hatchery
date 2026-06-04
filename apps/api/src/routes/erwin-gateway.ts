import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { gatewayWebhookEvents } from '../db/schema.js';
import { smokeCheckErwinGateway } from '../services/erwinGatewayClient.js';
import { handleErwinGatewayWebhook, type GatewayWebhookRecord, type GatewayWebhookStore } from '../services/erwinGatewayWebhook.js';

function headerValueToString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function createDatabaseGatewayWebhookStore(): GatewayWebhookStore {
  return {
    async insertEvent(record: GatewayWebhookRecord) {
      const [eventRow] = await db
        .insert(gatewayWebhookEvents)
        .values({
          deliveryId: record.deliveryId,
          eventId: record.eventId,
          eventType: record.eventType,
          twitchRedemptionId: record.twitchRedemptionId,
          twitchMessageId: record.twitchMessageId,
          rawPayload: record.rawPayload,
          processingStatus: record.processingStatus,
          processedAt: new Date()
        })
        .onConflictDoNothing()
        .returning({ id: gatewayWebhookEvents.id });

      if (eventRow) return { inserted: true as const };

      const existing = await db
        .select({ processingStatus: gatewayWebhookEvents.processingStatus })
        .from(gatewayWebhookEvents)
        .where(eq(gatewayWebhookEvents.eventId, record.eventId))
        .limit(1);
      return { inserted: false as const, status: existing[0]?.processingStatus ?? 'duplicate' };
    }
  };
}

export async function registerErwinGatewayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/erwin-gateway/smoke', async (_request, reply) => {
    const result = await smokeCheckErwinGateway();
    if (!result.ok && result.required) {
      return reply.code(503).send(result);
    }
    return result;
  });

  app.post('/erwin-gateway/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = config.ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET;
    if (!secret) {
      request.log.warn('erwin-gateway webhook received without configured signing secret');
      return reply.code(503).send({ message: 'erwin-gateway webhook receiver is not configured' });
    }

    const result = await handleErwinGatewayWebhook({
      secret,
      deliveryId: headerValueToString(request.headers['x-erwin-gateway-delivery-id']),
      headerEventId: headerValueToString(request.headers['x-erwin-gateway-event-id']),
      timestamp: headerValueToString(request.headers['x-erwin-gateway-timestamp']),
      signature: headerValueToString(request.headers['x-erwin-gateway-signature']),
      rawBody: (request as FastifyRequest & { rawBodyBuffer?: Buffer }).rawBodyBuffer,
      maxAgeSeconds: config.ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS,
      observeOnly: config.ERWIN_GATEWAY_OBSERVE_ONLY,
      store: createDatabaseGatewayWebhookStore()
    });

    if (!result.ok) {
      return reply.code(result.statusCode).send({ message: result.message });
    }

    request.log.info(
      {
        duplicate: result.duplicate,
        observeOnly: result.duplicate ? undefined : result.observeOnly
      },
      result.duplicate ? 'Duplicate erwin-gateway webhook observed' : 'erwin-gateway webhook observed'
    );
    return reply.code(result.statusCode).send(result);
  });
}
