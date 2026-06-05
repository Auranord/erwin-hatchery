import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { channelPointRedemptions, economyLedger, eggTypes, gatewayRewardMappings, gatewayWebhookEvents, mysteryEggInventory, users } from '../db/schema.js';
import { createErwinGatewayClient, ErwinGatewayError, smokeCheckErwinGateway } from '../services/erwinGatewayClient.js';
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
type PostCommitAction = () => Promise<void>;

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function recordValue(record: Record<string, unknown> | null, key: string): unknown {
  return record?.[key];
}

function nestedRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function rawRewardIdLogFields(payload: Record<string, unknown>) {
  const data = nestedRecord(payload.data);
  const event = nestedRecord(recordValue(data, 'event'), payload.event, data);
  const reward = nestedRecord(payload.reward, recordValue(data, 'reward'), recordValue(event, 'reward'));
  return {
    rawRewardId: stringValue(recordValue(reward, 'id')),
    rawRewardTwitchRewardId: stringValue(recordValue(reward, 'twitch_reward_id')),
    rawRewardTwitchRewardIdCamel: stringValue(recordValue(reward, 'twitchRewardId')),
    rawEventRewardId: stringValue(recordValue(event, 'reward_id'))
  };
}

function gatewayStatusLogFields(input: { redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping | null; gatewayRewardId: string | null }) {
  return {
    twitchRedemptionId: input.redemption.twitchRedemptionId,
    twitchRewardId: input.redemption.twitchRewardId,
    gatewayRewardId: input.gatewayRewardId,
    mappingId: input.mapping?.id ?? null,
    localRewardType: input.mapping?.localRewardType ?? null
  };
}

function gatewayErrorLogFields(error: unknown) {
  if (error instanceof ErwinGatewayError) {
    return {
      gatewayStatus: error.status,
      gatewayError: error.message.slice(0, 300),
      gatewayCode: error.code,
      twitchStatus: error.twitchStatus,
      twitchErrorExcerpt: error.twitchErrorExcerpt?.slice(0, 300) ?? null,
      retryable: error.retryable
    };
  }
  return { gatewayError: error instanceof Error ? error.message.slice(0, 300) : 'Unknown erwin-gateway redemption status error' };
}

async function markRedemptionStatus(twitchRedemptionId: string, status: string): Promise<void> {
  await db
    .update(channelPointRedemptions)
    .set({ status, updatedAt: new Date() })
    .where(eq(channelPointRedemptions.twitchRedemptionId, twitchRedemptionId));
}

function createRedemptionStore(tx: GatewayTransaction, observeOnly: boolean, postCommitActions: PostCommitAction[], log: FastifyBaseLogger) {
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
      const mapping = rows[0] ?? null;
      if (!mapping) {
        log.warn(
          {
            twitchRedemptionId: redemption.twitchRedemptionId,
            twitchRewardId: redemption.twitchRewardId,
            gatewayRewardId: redemption.gatewayRewardId,
            mappingId: null,
            localRewardType: null,
            ...rawRewardIdLogFields(redemption.rawPayload)
          },
          'No active Hatchery reward mapping exists for Gateway Channel Point redemption'
        );
      }
      return mapping;
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
      if (existingLedger) {
        return { status: 'already_granted' as const, reason: 'duplicate_twitch_redemption_id' };
      }

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
    async fulfillRedemption(input: { redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping }) {
      const { redemption, mapping } = input;
      const gatewayRewardId = nonEmptyString(redemption.gatewayRewardId ?? mapping.gatewayRewardId);
      const logFields = gatewayStatusLogFields({ redemption, mapping, gatewayRewardId });
      log.info(logFields, 'Gateway Channel Point redemption local grant completed');
      if (!config.ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS) {
        await tx
          .update(channelPointRedemptions)
          .set({ status: 'locally_granted_pending_manual_fulfill', updatedAt: new Date() })
          .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId));
        log.info(logFields, 'Gateway Channel Point redemption auto fulfill disabled; pending manual fulfill');
        return;
      }

      if (!gatewayRewardId) {
        await tx
          .update(channelPointRedemptions)
          .set({ status: 'locally_granted_pending_manual_fulfill', updatedAt: new Date() })
          .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId));
        log.warn(logFields, 'Gateway Channel Point redemption fulfillment pending manual fulfill because reward id is missing');
        return;
      }

      await tx
        .update(channelPointRedemptions)
        .set({ status: 'locally_granted_pending_gateway_fulfill', gatewayRewardId, updatedAt: new Date() })
        .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId));

      postCommitActions.push(async () => {
        const client = createErwinGatewayClient();
        if (!client) {
          await markRedemptionStatus(redemption.twitchRedemptionId, 'locally_granted_pending_manual_fulfill');
          log.warn(logFields, 'Gateway Channel Point redemption fulfillment pending manual fulfill because erwin-gateway client is not configured');
          return;
        }

        log.info(logFields, 'Gateway Channel Point redemption fulfillment attempted');
        try {
          await client.updateRedemptionStatus({
            rewardId: gatewayRewardId,
            redemptionId: redemption.twitchRedemptionId,
            status: 'FULFILLED',
            reason: 'Erwin Hatchery granted the egg and recorded the ledger entry.'
          });
          await markRedemptionStatus(redemption.twitchRedemptionId, 'FULFILLED');
          log.info(logFields, 'Gateway Channel Point redemption fulfillment succeeded');
        } catch (error) {
          await markRedemptionStatus(redemption.twitchRedemptionId, 'locally_granted_fulfillment_failed');
          log.warn({ ...logFields, ...gatewayErrorLogFields(error) }, 'Gateway Channel Point redemption fulfillment failed after local grant');
        }
      });
    },
    async cancelRedemption(input: { redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping | null; reason: string }) {
      const { redemption, mapping, reason } = input;
      const gatewayRewardId = nonEmptyString(redemption.gatewayRewardId ?? mapping?.gatewayRewardId);
      const logFields = gatewayStatusLogFields({ redemption, mapping, gatewayRewardId });
      if (!config.ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS) {
        await tx
          .update(channelPointRedemptions)
          .set({ status: 'cancel_pending_manual_fulfill', updatedAt: new Date() })
          .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId));
        log.info(logFields, 'Gateway Channel Point redemption auto cancel disabled; pending manual action');
        return;
      }

      if (!gatewayRewardId) {
        await tx
          .update(channelPointRedemptions)
          .set({ status: 'cancel_pending_manual_fulfill', updatedAt: new Date() })
          .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId));
        log.warn(logFields, 'Gateway Channel Point redemption cancel pending manual action because reward id is missing');
        return;
      }

      await tx
        .update(channelPointRedemptions)
        .set({ status: 'cancel_pending_gateway', gatewayRewardId, updatedAt: new Date() })
        .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.twitchRedemptionId));

      postCommitActions.push(async () => {
        const client = createErwinGatewayClient();
        if (!client) {
          await markRedemptionStatus(redemption.twitchRedemptionId, 'cancel_pending_manual_fulfill');
          log.warn(logFields, 'Gateway Channel Point redemption cancel pending manual action because erwin-gateway client is not configured');
          return;
        }

        log.info(logFields, 'Gateway Channel Point redemption cancel attempted');
        try {
          await client.updateRedemptionStatus({
            rewardId: gatewayRewardId,
            redemptionId: redemption.twitchRedemptionId,
            status: 'CANCELED',
            reason
          });
          await markRedemptionStatus(redemption.twitchRedemptionId, 'CANCELED');
          log.info(logFields, 'Gateway Channel Point redemption cancel succeeded');
        } catch (error) {
          await markRedemptionStatus(redemption.twitchRedemptionId, 'cancel_failed');
          log.warn({ ...logFields, ...gatewayErrorLogFields(error) }, 'Gateway Channel Point redemption cancel failed');
        }
      });
    },
    async upsertChannelPointRedemption(input: {
      redemption: NormalizedGatewayRedemption;
      userId: string | null;
      mapping: GatewayRewardMapping | null;
      mappingStatus: 'mapped' | 'unknown';
    }) {
      const { redemption, userId, mapping, mappingStatus } = input;
      const gatewayRewardId = nonEmptyString(redemption.gatewayRewardId ?? mapping?.gatewayRewardId);
      await tx
        .insert(channelPointRedemptions)
        .values({
          twitchRedemptionId: redemption.twitchRedemptionId,
          twitchRewardId: redemption.twitchRewardId,
          gatewayRewardId,
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
            gatewayRewardId,
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
            status: sql<string>`case
              when ${redemption.status} in ('FULFILLED', 'CANCELED') then ${redemption.status}
              when ${channelPointRedemptions.status} in ('FULFILLED', 'CANCELED', 'locally_granted_pending_gateway_fulfill', 'locally_granted_pending_manual_fulfill', 'locally_granted_fulfillment_failed', 'cancel_pending_gateway', 'cancel_pending_manual_fulfill', 'cancel_failed') then ${channelPointRedemptions.status}
              else ${redemption.status}
            end`,
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

function createDatabaseGatewayWebhookStore(observeOnly: boolean, log: FastifyBaseLogger): GatewayWebhookStore {
  return {
    async insertEvent(record: GatewayWebhookRecord) {
      const postCommitActions: PostCommitAction[] = [];
      const stored = await db.transaction(async (tx) => {
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
          const result = await processGatewayRedemptionObserveOnly(normalized, createRedemptionStore(tx, observeOnly, postCommitActions, log));
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

      if (stored.inserted) {
        for (const action of postCommitActions) {
          await action();
        }
      }

      return stored;
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
      db
        .select({
          id: channelPointRedemptions.id,
          twitchRedemptionId: channelPointRedemptions.twitchRedemptionId,
          mappingStatus: channelPointRedemptions.mappingStatus,
          localRewardType: channelPointRedemptions.localRewardType,
          gatewayRewardId: channelPointRedemptions.gatewayRewardId,
          twitchRewardId: channelPointRedemptions.twitchRewardId,
          rewardTitle: channelPointRedemptions.rewardTitle,
          status: channelPointRedemptions.status,
          lastGatewayDeliveryId: channelPointRedemptions.lastGatewayDeliveryId,
          lastGatewayEventId: channelPointRedemptions.lastGatewayEventId,
          processedAt: channelPointRedemptions.processedAt,
          updatedAt: channelPointRedemptions.updatedAt
        })
        .from(channelPointRedemptions)
        .orderBy(desc(channelPointRedemptions.updatedAt))
        .limit(50),
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
      store: createDatabaseGatewayWebhookStore(config.ERWIN_GATEWAY_OBSERVE_ONLY, request.log)
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
