import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  channelPointRedemptions,
  economyLedger,
  eggTypes,
  mysteryEggInventory,
  resources,
  twitchEvents,
  users
} from '../db/schema.js';
import { config } from '../config.js';
import { grantBitsVouchersForEvent, markEventSubRevoked } from '../services/twitchIntegration.js';

type EventSubEnvelope = {
  subscription: { type: string };
  challenge?: string;
  event?: {
    id: string;
    user_id?: string;
    user_login?: string;
    user_name?: string;
    recipient_user_id?: string;
    recipient_user_login?: string;
    recipient_user_name?: string;
    total?: number;
    bits?: number;
    is_anonymous?: boolean;
    reward?: { id: string; cost: number };
    status?: string;
  };
};

type RedemptionOutcome = 'unknown_reward' | 'inactive_egg_type' | 'granted';
const VOUCHER_RESOURCE_TYPE = 'voucher';
function headerValueToString(
  value: string | string[] | undefined
): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}
function verifyEventSubSignature(request: FastifyRequest): boolean {
  const id = headerValueToString(request.headers['twitch-eventsub-message-id']);
  const timestamp = headerValueToString(
    request.headers['twitch-eventsub-message-timestamp']
  );
  const signature = headerValueToString(
    request.headers['twitch-eventsub-message-signature']
  );
  const body = (request as FastifyRequest & { rawBody?: string }).rawBody;
  if (!id || !timestamp || !signature || !body) return false;
  const value = `${id}${timestamp}${body}`;
  const expected = `sha256=${createHmac('sha256', config.TWITCH_EVENTSUB_SECRET).update(value).digest('hex')}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
function shouldGrantRedemption(status: string | undefined): boolean {
  return status === 'unfulfilled' || status === 'fulfilled';
}
function subscriptionEndsAtFromNow(now: Date): Date {
  const endsAt = new Date(now);
  endsAt.setUTCDate(
    endsAt.getUTCDate() + config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS
  );
  return endsAt;
}

export function getSubscriptionStatusFromEventType(
  eventType: string
): boolean | null {
  const activateTypes = new Set([
    'channel.subscribe',
    'channel.subscription.message'
  ]);
  const deactivateTypes = new Set(['channel.subscription.end']);
  if (activateTypes.has(eventType)) return true;
  if (deactivateTypes.has(eventType)) return false;
  return null;
}

async function processRedemption(
  payload: EventSubEnvelope,
  log: FastifyRequest['log']
): Promise<RedemptionOutcome> {
  const redemption = payload.event;
  if (
    !redemption ||
    !redemption.reward ||
    !shouldGrantRedemption(redemption.status)
  )
    return 'unknown_reward';
  const { reward } = redemption;
  const twitchUserId = redemption.user_id?.trim();
  if (!twitchUserId) return 'unknown_reward';

  const [eggType] = await db
    .select({ id: eggTypes.id, isActive: eggTypes.isActive })
    .from(eggTypes)
    .where(eq(eggTypes.twitchRewardId, reward.id))
    .limit(1);
  const outcome: RedemptionOutcome = !eggType
    ? 'unknown_reward'
    : eggType.isActive
      ? 'granted'
      : 'inactive_egg_type';

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: channelPointRedemptions.id,
        status: channelPointRedemptions.status
      })
      .from(channelPointRedemptions)
      .where(eq(channelPointRedemptions.twitchRedemptionId, redemption.id))
      .limit(1);
    if (existing.length > 0) return;

    const foundUsers = await tx
      .select()
      .from(users)
      .where(eq(users.twitchUserId, twitchUserId))
      .limit(1);
    const existingUser = foundUsers[0];
    const now = new Date();
    const user =
      existingUser ??
      (
        await tx
          .insert(users)
          .values({
            twitchUserId,
            twitchLogin: redemption.user_login ?? null,
            displayName: redemption.user_name ?? null,
            isProvisional: true,
            lastLoginAt: null,
            updatedAt: now
          })
          .returning()
      )[0];
    if (!user) throw new Error('Failed to upsert user for redemption');

    const saved = await tx
      .insert(channelPointRedemptions)
      .values({
        twitchRedemptionId: redemption.id,
        twitchRewardId: reward.id,
        userId: user.id,
        cost: reward.cost,
        status: `processed:${outcome}`,
        rawPayload: payload,
        processedAt: now
      })
      .returning({ id: channelPointRedemptions.id });
    const savedRedemption = saved[0];
    if (!savedRedemption)
      throw new Error('Failed to persist channel point redemption');

    if (outcome === 'granted' && eggType) {
      await tx
        .insert(mysteryEggInventory)
        .values({
          userId: user.id,
          eggTypeId: eggType.id,
          amount: 1,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
          set: {
            amount: sql`${mysteryEggInventory.amount} + 1`,
            updatedAt: now
          }
        });
      await tx.insert(economyLedger).values({
        userId: user.id,
        actorUserId: null,
        eventType: 'channel_point_redemption_granted_egg',
        sourceType: 'channel_point_redemption',
        sourceId: savedRedemption.id,
        delta: {
          mysteryEggInventory: [{ eggTypeId: eggType.id, amountDelta: 1 }]
        }
      });
    }

    if (outcome === 'inactive_egg_type') {
      await tx.insert(economyLedger).values({
        userId: user.id,
        actorUserId: null,
        eventType: 'channel_point_redemption_refund_required',
        sourceType: 'channel_point_redemption',
        sourceId: savedRedemption.id,
        delta: {
          refund: {
            required: true,
            reason: 'inactive_egg_type',
            twitchRewardId: reward.id
          }
        }
      });
    }
  });

  log.info(
    { redemptionId: redemption.id, rewardId: reward.id, outcome },
    'EventSub redemption processed'
  );
  return outcome;
}

async function grantVoucherInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    userId: string;
    twitchEventRowId: string;
    amount: number;
    reason: string;
  }
): Promise<void> {
  const amount = Math.max(1, Math.floor(input.amount));
  const now = new Date();
  await tx
    .insert(resources)
    .values({
      userId: input.userId,
      resourceType: VOUCHER_RESOURCE_TYPE,
      amount,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [resources.userId, resources.resourceType],
      set: { amount: sql`${resources.amount} + ${amount}`, updatedAt: now }
    });
  await tx.insert(economyLedger).values({
    userId: input.userId,
    actorUserId: null,
    eventType: 'subscription_voucher_granted',
    sourceType: 'eventsub_subscription',
    sourceId: input.twitchEventRowId,
    delta: {
      resources: [
        {
          resourceType: VOUCHER_RESOURCE_TYPE,
          amountDelta: amount,
          reason: input.reason
        }
      ]
    }
  });
}

async function processSubscriberStatus(
  payload: EventSubEnvelope,
  twitchEventRowId: string,
  log: FastifyRequest['log']
): Promise<'subscribed' | 'unsubscribed' | 'ignored'> {
  const eventType = payload.subscription.type;
  const event = payload.event;
  const twitchUserId = event?.user_id?.trim();
  if (!twitchUserId) return 'ignored';

  const subscriberStatus = getSubscriptionStatusFromEventType(eventType);
  if (subscriberStatus === null && eventType !== 'channel.subscription.gift')
    return 'ignored';

  const now = new Date();
  const nextEndsAt = subscriptionEndsAtFromNow(now);
  const shouldActivate = subscriberStatus === true;
  await db.transaction(async (tx) => {
    const existingUser = (
      await tx
        .select()
        .from(users)
        .where(eq(users.twitchUserId, twitchUserId))
        .limit(1)
    )[0];
    const user =
      existingUser ??
      (
        await tx
          .insert(users)
          .values({
            twitchUserId,
            twitchLogin: event?.user_login ?? null,
            displayName: event?.user_name ?? null,
            isProvisional: true,
            lastLoginAt: null,
            updatedAt: now
          })
          .returning()
      )[0];
    if (!user) throw new Error('Failed to upsert user for subscription event');

    if (subscriberStatus !== null) {
      await tx
        .update(users)
        .set({
          isSubscriber: shouldActivate,
          subscriberEndsAt: shouldActivate ? nextEndsAt : now,
          twitchLogin: event?.user_login ?? user.twitchLogin ?? null,
          displayName: event?.user_name ?? user.displayName ?? null,
          updatedAt: now
        })
        .where(eq(users.id, user.id));
    }

    if (
      eventType === 'channel.subscribe' ||
      eventType === 'channel.subscription.message'
    ) {
      await grantVoucherInTx(tx, {
        userId: user.id,
        twitchEventRowId,
        amount: 1,
        reason: 'subscription_recipient'
      });
    }

    if (
      eventType === 'channel.subscription.gift' &&
      event?.is_anonymous !== true
    ) {
      await grantVoucherInTx(tx, {
        userId: user.id,
        twitchEventRowId,
        amount: event?.total ?? 1,
        reason: 'gift_subscription_gifter'
      });
    }

    if (eventType === 'channel.subscription.gift' && event?.recipient_user_id) {
      const existingRecipient = (
        await tx
          .select()
          .from(users)
          .where(eq(users.twitchUserId, event.recipient_user_id))
          .limit(1)
      )[0];
      const recipient =
        existingRecipient ??
        (
          await tx
            .insert(users)
            .values({
              twitchUserId: event.recipient_user_id,
              twitchLogin: event.recipient_user_login ?? null,
              displayName: event.recipient_user_name ?? null,
              isProvisional: true,
              lastLoginAt: null,
              updatedAt: now
            })
            .returning()
        )[0];
      if (recipient) {
        await grantVoucherInTx(tx, {
          userId: recipient.id,
          twitchEventRowId,
          amount: 1,
          reason: 'gift_subscription_recipient'
        });
      }
    }
  });

  log.info(
    {
      twitchUserId,
      eventType,
      isSubscriber: shouldActivate,
      subscriberEndsAt: shouldActivate
        ? nextEndsAt.toISOString()
        : now.toISOString()
    },
    'Subscriber status updated'
  );
  if (eventType === 'channel.subscription.gift') return 'subscribed';
  return shouldActivate ? 'subscribed' : 'unsubscribed';
}

async function processBitsEvent(
  payload: EventSubEnvelope,
  twitchEventRowId: string,
  log: FastifyRequest['log']
): Promise<'bits_counted' | 'anonymous_bits_ignored' | 'ignored'> {
  const event = payload.event;
  const bits = Number(event?.bits ?? 0);
  if (!event || !Number.isFinite(bits) || bits <= 0) return 'ignored';
  if (event.is_anonymous || !event.user_id?.trim()) {
    log.info({ bits }, 'Anonymous Bits EventSub event audited without voucher grant');
    return 'anonymous_bits_ignored';
  }
  await grantBitsVouchersForEvent({
    twitchEventRowId,
    twitchUserId: event.user_id.trim(),
    login: event.user_login ?? null,
    displayName: event.user_name ?? null,
    bits,
    reason: 'eventsub_bits_threshold'
  });
  return 'bits_counted';
}

async function processRevocation(payload: EventSubEnvelope, log: FastifyRequest['log']): Promise<void> {
  const reason = (payload as EventSubEnvelope & { subscription?: { status?: string } }).subscription?.status ?? 'unknown_revocation';
  await markEventSubRevoked(reason);
  log.warn({ eventType: payload.subscription.type, reason }, 'EventSub subscription revoked');
}

function badRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ message: 'Invalid EventSub request' });
}

export async function registerEventSubRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post('/api/twitch/eventsub', async (request, reply) => {
    const messageType = headerValueToString(
      request.headers['twitch-eventsub-message-type']
    );
    const messageId = headerValueToString(
      request.headers['twitch-eventsub-message-id']
    );
    if (!messageType || !verifyEventSubSignature(request))
      return badRequest(reply);
    const payload = request.body as EventSubEnvelope;
    if (!payload?.subscription?.type) return badRequest(reply);
    if (messageType === 'webhook_callback_verification')
      return reply.type('text/plain').send(payload.challenge ?? '');
    if (messageType === 'revocation') {
      await processRevocation(payload, request.log);
      return reply.code(204).send();
    }
    if (messageType !== 'notification') return reply.code(204).send();
    if (!payload.event?.id || !messageId) return badRequest(reply);

    const [eventRow] = await db
      .insert(twitchEvents)
      .values({
        twitchEventId: messageId,
        type: payload.subscription.type,
        source: 'eventsub',
        rawPayload: payload,
        processingStatus: 'received'
      })
      .onConflictDoNothing()
      .returning({ id: twitchEvents.id });
    if (!eventRow) return reply.code(204).send();
    try {
      let outcome: string = 'ignored';
      if (
        payload.subscription.type ===
        'channel.channel_points_custom_reward_redemption.add'
      ) {
        if (config.ERWIN_GATEWAY_ENABLED) {
          outcome = 'direct_twitch_redemption_ignored_gateway_enabled';
          request.log.info(
            {
              twitchEventSubMessageId: messageId,
              twitchRedemptionId: payload.event.id,
              twitchRewardId: payload.event.reward?.id ?? null
            },
            'Direct Twitch Channel Point redemption ignored because erwin-gateway mode is enabled'
          );
        } else {
          outcome = await processRedemption(payload, request.log);
        }
      } else if (
        payload.subscription.type === 'channel.subscribe' ||
        payload.subscription.type === 'channel.subscription.end' ||
        payload.subscription.type === 'channel.subscription.message' ||
        payload.subscription.type === 'channel.subscription.gift'
      ) {
        outcome = await processSubscriberStatus(
          payload,
          eventRow.id,
          request.log
        );
      } else if (payload.subscription.type === 'channel.cheer') {
        outcome = await processBitsEvent(payload, eventRow.id, request.log);
      }
      const nonErrorOutcomes = new Set([
        'granted',
        'subscribed',
        'unsubscribed',
        'ignored',
        'bits_counted',
        'anonymous_bits_ignored',
        'direct_twitch_redemption_ignored_gateway_enabled'
      ]);
      await db
        .update(twitchEvents)
        .set({
          processingStatus: 'processed',
          processedAt: new Date(),
          error: nonErrorOutcomes.has(outcome) ? null : outcome
        })
        .where(eq(twitchEvents.id, eventRow.id));
      return reply.code(204).send();
    } catch (error) {
      request.log.error(
        { err: error },
        'eventsub redemption processing failed'
      );
      await db
        .update(twitchEvents)
        .set({
          processingStatus: 'failed',
          error: error instanceof Error ? error.message : 'unknown_error'
        })
        .where(eq(twitchEvents.id, eventRow.id));
      return reply.code(500).send({ message: 'Event processing failed' });
    }
  });
}
