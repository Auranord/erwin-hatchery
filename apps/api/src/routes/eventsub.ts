import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { channelPointRedemptions, economyLedger, eggTypes, mysteryEggInventory, twitchEvents, users } from '../db/schema.js';
import { config } from '../config.js';

type EventSubEnvelope = {
  subscription: { type: string };
  challenge?: string;
  event?: {
    id: string;
    user_id?: string;
    user_login?: string;
    user_name?: string;
    reward?: { id: string; cost: number };
    status?: string;
  };
};

type RedemptionOutcome = 'unknown_reward' | 'inactive_egg_type' | 'granted';
function headerValueToString(value: string | string[] | undefined): string | null { if (typeof value === 'string') return value; if (Array.isArray(value) && typeof value[0] === 'string') return value[0]; return null; }
function verifyEventSubSignature(request: FastifyRequest): boolean { const id = headerValueToString(request.headers['twitch-eventsub-message-id']); const timestamp = headerValueToString(request.headers['twitch-eventsub-message-timestamp']); const signature = headerValueToString(request.headers['twitch-eventsub-message-signature']); const body = (request as FastifyRequest & { rawBody?: string }).rawBody; if (!id || !timestamp || !signature || !body) return false; const value = `${id}${timestamp}${body}`; const expected = `sha256=${createHmac('sha256', config.TWITCH_EVENTSUB_SECRET).update(value).digest('hex')}`; return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
function shouldGrantRedemption(status: string | undefined): boolean { return status === 'unfulfilled' || status === 'fulfilled'; }
function subscriptionEndsAtFromNow(now: Date): Date {
  const endsAt = new Date(now);
  endsAt.setUTCDate(endsAt.getUTCDate() + config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS);
  return endsAt;
}

async function processRedemption(payload: EventSubEnvelope, log: FastifyRequest['log']): Promise<RedemptionOutcome> {
  const redemption = payload.event;
  if (!redemption || !redemption.reward || !shouldGrantRedemption(redemption.status)) return 'unknown_reward';
  const { reward } = redemption;

  const [eggType] = await db.select({ id: eggTypes.id, isActive: eggTypes.isActive }).from(eggTypes).where(eq(eggTypes.twitchRewardId, reward.id)).limit(1);
  const outcome: RedemptionOutcome = !eggType ? 'unknown_reward' : eggType.isActive ? 'granted' : 'inactive_egg_type';

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: channelPointRedemptions.id, status: channelPointRedemptions.status }).from(channelPointRedemptions).where(eq(channelPointRedemptions.twitchRedemptionId, redemption.id)).limit(1);
    if (existing.length > 0) return;

    const foundUsers = await tx.select().from(users).where(eq(users.twitchUserId, redemption.user_id)).limit(1);
    const existingUser = foundUsers[0];
    const now = new Date();
    const user = existingUser ?? (await tx.insert(users).values({ twitchUserId: redemption.user_id, twitchLogin: redemption.user_login ?? null, displayName: redemption.user_name ?? null, isProvisional: true, lastLoginAt: null, updatedAt: now }).returning())[0];
    if (!user) throw new Error('Failed to upsert user for redemption');

    const saved = await tx.insert(channelPointRedemptions).values({ twitchRedemptionId: redemption.id, twitchRewardId: reward.id, userId: user.id, cost: reward.cost, status: `processed:${outcome}`, rawPayload: payload, processedAt: now }).returning({ id: channelPointRedemptions.id });
    const savedRedemption = saved[0];
    if (!savedRedemption) throw new Error('Failed to persist channel point redemption');

    if (outcome === 'granted' && eggType) {
      await tx.insert(mysteryEggInventory).values({ userId: user.id, eggTypeId: eggType.id, amount: 1, updatedAt: now }).onConflictDoUpdate({ target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId], set: { amount: sql`${mysteryEggInventory.amount} + 1`, updatedAt: now } });
      await tx.insert(economyLedger).values({ userId: user.id, actorUserId: null, eventType: 'channel_point_redemption_granted_egg', sourceType: 'channel_point_redemption', sourceId: savedRedemption.id, delta: { mysteryEggInventory: [{ eggTypeId: eggType.id, amountDelta: 1 }] } });
    }

    if (outcome === 'inactive_egg_type') {
      await tx.insert(economyLedger).values({ userId: user.id, actorUserId: null, eventType: 'channel_point_redemption_refund_required', sourceType: 'channel_point_redemption', sourceId: savedRedemption.id, delta: { refund: { required: true, reason: 'inactive_egg_type', twitchRewardId: reward.id } } });
    }
  });

  log.info({ redemptionId: redemption.id, rewardId: reward.id, outcome }, 'EventSub redemption processed');
  return outcome;
}

async function processSubscriberStatus(payload: EventSubEnvelope, log: FastifyRequest['log']): Promise<'subscribed' | 'unsubscribed' | 'ignored'> {
  const eventType = payload.subscription.type;
  const event = payload.event;
  const twitchUserId = event?.user_id?.trim();
  if (!twitchUserId) return 'ignored';

  const activateTypes = new Set(['channel.subscribe', 'channel.subscription.message']);
  const deactivateTypes = new Set(['channel.subscription.end']);
  if (!activateTypes.has(eventType) && !deactivateTypes.has(eventType)) return 'ignored';

  const now = new Date();
  const nextEndsAt = subscriptionEndsAtFromNow(now);
  const shouldActivate = activateTypes.has(eventType);
  await db.transaction(async (tx) => {
    const existingUser = (await tx.select().from(users).where(eq(users.twitchUserId, twitchUserId)).limit(1))[0];
    const user = existingUser ?? (await tx.insert(users).values({
      twitchUserId,
      twitchLogin: event?.user_login ?? null,
      displayName: event?.user_name ?? null,
      isProvisional: true,
      lastLoginAt: null,
      updatedAt: now
    }).returning())[0];
    if (!user) throw new Error('Failed to upsert user for subscription event');

    await tx.update(users).set({
      isSubscriber: shouldActivate,
      subscriberEndsAt: shouldActivate ? nextEndsAt : now,
      twitchLogin: event?.user_login ?? user.twitchLogin ?? null,
      displayName: event?.user_name ?? user.displayName ?? null,
      updatedAt: now
    }).where(eq(users.id, user.id));
  });

  log.info({ twitchUserId, eventType, isSubscriber: shouldActivate, subscriberEndsAt: shouldActivate ? nextEndsAt.toISOString() : now.toISOString() }, 'Subscriber status updated');
  return shouldActivate ? 'subscribed' : 'unsubscribed';
}
function badRequest(reply: FastifyReply): FastifyReply { return reply.code(400).send({ message: 'Invalid EventSub request' }); }

export async function registerEventSubRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/twitch/eventsub', async (request, reply) => {
    const messageType = headerValueToString(request.headers['twitch-eventsub-message-type']);
    const messageId = headerValueToString(request.headers['twitch-eventsub-message-id']);
    if (!messageType || !verifyEventSubSignature(request)) return badRequest(reply);
    const payload = request.body as EventSubEnvelope;
    if (!payload?.subscription?.type) return badRequest(reply);
    if (messageType === 'webhook_callback_verification') return reply.type('text/plain').send(payload.challenge ?? '');
    if (messageType !== 'notification') return reply.code(204).send();
    if (!payload.event?.id || !messageId) return badRequest(reply);

    const [eventRow] = await db.insert(twitchEvents).values({ twitchEventId: messageId, type: payload.subscription.type, source: 'eventsub', rawPayload: payload, processingStatus: 'received' }).onConflictDoNothing().returning({ id: twitchEvents.id });
    if (!eventRow) return reply.code(204).send();
    try {
      let outcome: string = 'ignored';
      if (payload.subscription.type === 'channel.channel_points_custom_reward_redemption.add') {
        outcome = await processRedemption(payload, request.log);
      } else if (payload.subscription.type === 'channel.subscribe' || payload.subscription.type === 'channel.subscription.end' || payload.subscription.type === 'channel.subscription.message') {
        outcome = await processSubscriberStatus(payload, request.log);
      }
      const nonErrorOutcomes = new Set(['granted', 'subscribed', 'unsubscribed', 'ignored']);
      await db.update(twitchEvents).set({ processingStatus: 'processed', processedAt: new Date(), error: nonErrorOutcomes.has(outcome) ? null : outcome }).where(eq(twitchEvents.id, eventRow.id));
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error }, 'eventsub redemption processing failed');
      await db.update(twitchEvents).set({ processingStatus: 'failed', error: error instanceof Error ? error.message : 'unknown_error' }).where(eq(twitchEvents.id, eventRow.id));
      return reply.code(500).send({ message: 'Event processing failed' });
    }
  });
}
