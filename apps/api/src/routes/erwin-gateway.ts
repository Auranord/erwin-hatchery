import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { channelPointRedemptions, economyLedger, eggTypes, gatewayRewardMappings, gatewayWebhookEvents, mysteryEggInventory, users } from '../db/schema.js';
import { createErwinGatewayClient, smokeCheckErwinGateway } from '../services/erwinGatewayClient.js';
import { handleErwinGatewayWebhook, type GatewayWebhookRecord, type GatewayWebhookStore } from '../services/erwinGatewayWebhook.js';
import {
  normalizeGatewayRedemptionPayload,
  processGatewayRedemptionObserveOnly,
  type GatewayRewardMapping,
  type NormalizedGatewayRedemption
} from '../services/gatewayRedemptions.js';

function headerValueToString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function rawPayloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

type GatewayTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function createRedemptionStore(tx: GatewayTransaction, observeOnly: boolean) {
  return {
    observeOnly,
    async findRewardMapping(redemption: NormalizedGatewayRedemption): Promise<GatewayRewardMapping | null> {
      const filters: SQL<unknown> = redemption.gatewayRewardId
        ? (or(
            eq(gatewayRewardMappings.gatewayRewardId, redemption.gatewayRewardId),
            eq(gatewayRewardMappings.twitchRewardId, redemption.twitchRewardId)
          ) as SQL<unknown>)
        : eq(gatewayRewardMappings.twitchRewardId, redemption.twitchRewardId);
      const rows = await tx
        .select()
        .from(gatewayRewardMappings)
        .where(and(filters, eq(gatewayRewardMappings.isActive, true)))
        .limit(1);
      return rows[0] ?? null;
    },
    async upsertProvisionalUser(input: { twitchUserId: string; twitchLogin: string | null; displayName: string | null }) {
      const inserted = await tx
        .insert(users)
        .values({
          twitchUserId: input.twitchUserId,
          twitchLogin: input.twitchLogin,
          displayName: input.displayName,
          isProvisional: true,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: users.twitchUserId,
          set: {
            twitchLogin: input.twitchLogin,
            displayName: input.displayName,
            updatedAt: new Date()
          }
        })
        .returning({ id: users.id });
      const user = inserted[0];
      if (!user) throw new Error('Failed to upsert provisional Twitch user');
      return { userId: user.id, createdOrUpdated: true };
    },

    async processMappedRedemption(input: { redemption: NormalizedGatewayRedemption; userId: string | null; mapping: GatewayRewardMapping }) {
      const { redemption, userId, mapping } = input;
      if (!userId) return { status: 'canceled' as const, reason: 'Redemption is missing a Twitch user.' };
      if (!mapping.localRewardType.startsWith('egg_type:')) {
        return { status: 'canceled' as const, reason: `Unsupported Hatchery reward type: ${mapping.localRewardType}` };
      }

      const eggTypeId = mapping.localRewardType.slice('egg_type:'.length);
      const [eggType] = await tx
        .select({ id: eggTypes.id, isActive: eggTypes.isActive })
        .from(eggTypes)
        .where(eq(eggTypes.id, eggTypeId))
        .limit(1);
      if (!eggType) return { status: 'canceled' as const, reason: `Unknown Hatchery egg type: ${eggTypeId}` };
      if (!eggType.isActive) return { status: 'canceled' as const, reason: `Hatchery egg type is inactive: ${eggTypeId}` };

      const [redemptionRow] = await tx
        .select({ id: channelPointRedemptions.id })
        .from(channelPointRedemptions)
        .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId))
        .limit(1);
      if (!redemptionRow) throw new Error('Expected persisted channel point redemption before reward processing');
      const [existingLedger] = await tx
        .select({ id: economyLedger.id })
        .from(economyLedger)
        .where(and(eq(economyLedger.sourceType, 'channel_point_redemption'), eq(economyLedger.sourceId, redemptionRow.id)))
        .limit(1);
      if (existingLedger) return { status: 'granted' as const };

      await tx
        .insert(mysteryEggInventory)
        .values({ userId, eggTypeId: eggType.id, amount: 1, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
          set: { amount: sql`${mysteryEggInventory.amount} + 1`, updatedAt: new Date() }
        });
      await tx.insert(economyLedger).values({
        userId,
        actorUserId: null,
        eventType: 'gateway_channel_point_redemption_granted_egg',
        sourceType: 'channel_point_redemption',
        sourceId: redemptionRow.id,
        delta: { mysteryEggInventory: [{ eggTypeId: eggType.id, amountDelta: 1 }] }
      });
      return { status: 'granted' as const };
    },
    async fulfillRedemption(redemption: NormalizedGatewayRedemption) {
      const client = createErwinGatewayClient();
      if (!client || !redemption.gatewayRewardId) return;
      await client.updateRedemptionStatus({
        rewardId: redemption.gatewayRewardId,
        redemptionId: redemption.twitchRedemptionId,
        status: 'FULFILLED',
        reason: 'Erwin Hatchery granted the egg and recorded the ledger entry.'
      });
    },
    async cancelRedemption(redemption: NormalizedGatewayRedemption, reason: string) {
      const client = createErwinGatewayClient();
      if (!client || !redemption.gatewayRewardId) return;
      await client.updateRedemptionStatus({
        rewardId: redemption.gatewayRewardId,
        redemptionId: redemption.twitchRedemptionId,
        status: 'CANCELED',
        reason
      });
    },
    async upsertChannelPointRedemption(input: {
      redemption: NormalizedGatewayRedemption;
      userId: string | null;
      mapping: GatewayRewardMapping | null;
      mappingStatus: 'mapped' | 'unknown';
    }) {
      const { redemption, userId, mapping, mappingStatus } = input;
      await tx
        .insert(channelPointRedemptions)
        .values({
          twitchRedemptionId: redemption.twitchRedemptionId,
          twitchRewardId: redemption.twitchRewardId,
          gatewayRewardId: redemption.gatewayRewardId,
          rewardMappingId: mapping?.id ?? null,
          localRewardType: mapping?.localRewardType ?? null,
          mappingStatus,
          userId,
          twitchUserId: redemption.twitchUserId,
          twitchUserLogin: redemption.twitchUserLogin,
          twitchUserDisplayName: redemption.twitchUserDisplayName,
          cost: redemption.rewardCost,
          rewardTitle: redemption.rewardTitle,
          rewardPrompt: redemption.rewardPrompt,
          status: redemption.status,
          userInput: redemption.userInput,
          lastGatewayDeliveryId: redemption.gatewayDeliveryId,
          lastGatewayEventId: redemption.gatewayEventId,
          rawPayload: redemption.rawPayload,
          processedAt: new Date(),
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: channelPointRedemptions.twitchRedemptionId,
          set: {
            twitchRewardId: redemption.twitchRewardId,
            gatewayRewardId: redemption.gatewayRewardId,
            rewardMappingId: mapping?.id ?? null,
            localRewardType: mapping?.localRewardType ?? null,
            mappingStatus,
            userId,
            twitchUserId: redemption.twitchUserId,
            twitchUserLogin: redemption.twitchUserLogin,
            twitchUserDisplayName: redemption.twitchUserDisplayName,
            cost: redemption.rewardCost,
            rewardTitle: redemption.rewardTitle,
            rewardPrompt: redemption.rewardPrompt,
            status: redemption.status,
            userInput: redemption.userInput,
            lastGatewayDeliveryId: redemption.gatewayDeliveryId,
            lastGatewayEventId: redemption.gatewayEventId,
            rawPayload: redemption.rawPayload,
            processedAt: new Date(),
            updatedAt: new Date()
          }
        });
    }
  };
}

function createDatabaseGatewayWebhookStore(observeOnly: boolean): GatewayWebhookStore {
  return {
    async insertEvent(record: GatewayWebhookRecord) {
      return db.transaction(async (tx) => {
        const [eventRow] = await tx
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

        if (!eventRow) {
          const existing = await tx
            .select({ processingStatus: gatewayWebhookEvents.processingStatus })
            .from(gatewayWebhookEvents)
            .where(or(eq(gatewayWebhookEvents.deliveryId, record.deliveryId), eq(gatewayWebhookEvents.eventId, record.eventId)))
            .limit(1);
          return { inserted: false as const, status: existing[0]?.processingStatus ?? 'duplicate' };
        }

        const normalized = normalizeGatewayRedemptionPayload({
          deliveryId: record.deliveryId,
          eventId: record.eventId,
          eventType: record.eventType,
          payload: rawPayloadRecord(record.rawPayload)
        });

        if (normalized) {
          const result = await processGatewayRedemptionObserveOnly(normalized, createRedemptionStore(tx, observeOnly));
          await tx
            .update(gatewayWebhookEvents)
            .set({
              processingStatus: result.ignored ? 'ignored' : observeOnly ? 'observed' : 'processed',
              error: result.ignored ? result.reason : null,
              processedAt: new Date()
            })
            .where(eq(gatewayWebhookEvents.id, eventRow.id));
        }

        return { inserted: true as const };
      });
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

  app.get('/api/erwin-gateway/diagnostics', async () => {
    const [mappings, events, redemptions, unmappedRewards, ignoredEvents] = await Promise.all([
      db.select().from(gatewayRewardMappings).orderBy(desc(gatewayRewardMappings.updatedAt)).limit(100),
      db
        .select({
          id: gatewayWebhookEvents.id,
          deliveryId: gatewayWebhookEvents.deliveryId,
          eventId: gatewayWebhookEvents.eventId,
          eventType: gatewayWebhookEvents.eventType,
          twitchRedemptionId: gatewayWebhookEvents.twitchRedemptionId,
          processingStatus: gatewayWebhookEvents.processingStatus,
          error: gatewayWebhookEvents.error,
          createdAt: gatewayWebhookEvents.createdAt,
          processedAt: gatewayWebhookEvents.processedAt
        })
        .from(gatewayWebhookEvents)
        .orderBy(desc(gatewayWebhookEvents.createdAt))
        .limit(50),
      db.select().from(channelPointRedemptions).orderBy(desc(channelPointRedemptions.updatedAt)).limit(50),
      db
        .select({ twitchRewardId: channelPointRedemptions.twitchRewardId, gatewayRewardId: channelPointRedemptions.gatewayRewardId, rewardTitle: channelPointRedemptions.rewardTitle })
        .from(channelPointRedemptions)
        .where(eq(channelPointRedemptions.mappingStatus, 'unknown'))
        .orderBy(desc(channelPointRedemptions.updatedAt))
        .limit(50),
      db
        .select()
        .from(gatewayWebhookEvents)
        .where(eq(gatewayWebhookEvents.processingStatus, 'ignored'))
        .orderBy(desc(gatewayWebhookEvents.createdAt))
        .limit(50)
    ]);

    return {
      observeOnly: config.ERWIN_GATEWAY_OBSERVE_ONLY,
      enabled: config.ERWIN_GATEWAY_ENABLED,
      mappings,
      recentGatewayRedemptionEvents: events,
      recentChannelPointRedemptions: redemptions,
      unmappedRewards,
      unknownOrIgnoredRedemptionEvents: ignoredEvents
    };
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
      store: createDatabaseGatewayWebhookStore(config.ERWIN_GATEWAY_OBSERVE_ONLY)
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
