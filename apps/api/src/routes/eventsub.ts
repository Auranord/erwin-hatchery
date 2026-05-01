import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { channelPointRedemptions, economyLedger, eggLootTableEntries, hiddenPetEggs, mysteryEggInventory, twitchEvents, users } from '../db/schema.js';
import { config } from '../config.js';

type EventSubEnvelope = {
  subscription: { type: string };
  challenge?: string;
  event?: {
    id: string;
    user_id: string;
    user_login?: string;
    user_name?: string;
    reward: { id: string; cost: number };
    status: string;
  };
};


function headerValueToString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return null;
}

function verifyEventSubSignature(request: FastifyRequest): boolean {
  const id = headerValueToString(request.headers['twitch-eventsub-message-id']);
  const timestamp = headerValueToString(request.headers['twitch-eventsub-message-timestamp']);
  const signature = headerValueToString(request.headers['twitch-eventsub-message-signature']);
  const body = (request as FastifyRequest & { rawBody?: string }).rawBody;

  if (!id || !timestamp || !signature || !body) {
    return false;
  }

  const value = `${id}${timestamp}${body}`;
  const expected = `sha256=${createHmac('sha256', config.TWITCH_EVENTSUB_SECRET).update(value).digest('hex')}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function resolveLootEntry(entries: Array<{ id: string; weight: number; petTypeId: string | null }>): { id: string; petTypeId: string } {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = Math.floor(Math.random() * totalWeight);
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (roll < cumulative && entry.petTypeId) {
      return { id: entry.id, petTypeId: entry.petTypeId };
    }
  }

  const fallback = entries.find((entry) => entry.petTypeId);
  if (!fallback?.petTypeId) {
    throw new Error('No active mystery egg pet outcome configured');
  }

  return { id: fallback.id, petTypeId: fallback.petTypeId };
}

async function processRedemption(payload: EventSubEnvelope): Promise<void> {
  const redemption = payload.event;
  if (!redemption) return;

  if (redemption.reward.id !== config.TWITCH_CHANNEL_POINT_REWARD_ID || redemption.status !== 'fulfilled') {
    return;
  }

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: channelPointRedemptions.id }).from(channelPointRedemptions).where(eq(channelPointRedemptions.twitchRedemptionId, redemption.id)).limit(1);
    if (existing.length > 0) {
      return;
    }

    const foundUsers = await tx.select().from(users).where(eq(users.twitchUserId, redemption.user_id)).limit(1);
    const existingUser = foundUsers[0];
    const now = new Date();

    const user = existingUser ?? (await tx
      .insert(users)
      .values({
        twitchUserId: redemption.user_id,
        twitchLogin: redemption.user_login ?? null,
        displayName: redemption.user_name ?? null,
        isProvisional: true,
        lastLoginAt: null,
        updatedAt: now
      })
      .returning())[0];

    if (!user) {
      throw new Error('Failed to upsert user for redemption');
    }

    const allEntries = await tx.select({ id: eggLootTableEntries.id, weight: eggLootTableEntries.weight, petTypeId: eggLootTableEntries.petTypeId }).from(eggLootTableEntries).where(and(eq(eggLootTableEntries.eggTypeId, 'mystery_egg'), eq(eggLootTableEntries.outcomeType, 'pet'), eq(eggLootTableEntries.isActive, true)));
    const resolved = resolveLootEntry(allEntries);

    const [savedRedemption] = await tx.insert(channelPointRedemptions).values({
      twitchRedemptionId: redemption.id,
      twitchRewardId: redemption.reward.id,
      userId: user.id,
      cost: redemption.reward.cost,
      status: redemption.status,
      rawPayload: payload,
      processedAt: now
    }).returning({ id: channelPointRedemptions.id });

    if (!savedRedemption) {
      throw new Error('Failed to persist channel point redemption');
    }

    await tx.insert(hiddenPetEggs).values({
      ownerUserId: user.id,
      eggTypeId: 'mystery_egg',
      hiddenPetTypeId: resolved.petTypeId,
      state: 'hidden',
      createdFromRedemptionId: savedRedemption.id
    });

    await tx.insert(mysteryEggInventory).values({ userId: user.id, eggTypeId: 'mystery_egg', amount: 1, updatedAt: now }).onConflictDoUpdate({
      target: [mysteryEggInventory.userId, mysteryEggInventory.eggTypeId],
      set: { amount: sql`${mysteryEggInventory.amount} + 1`, updatedAt: now }
    });

    await tx.insert(economyLedger).values({
      userId: user.id,
      actorUserId: null,
      eventType: 'channel_point_redemption_granted_mystery_egg',
      sourceType: 'channel_point_redemption',
      sourceId: savedRedemption.id,
      delta: { mysteryEggInventory: [{ eggTypeId: 'mystery_egg', amountDelta: 1 }] }
    });
  });
}

function badRequest(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ message: 'Invalid EventSub request' });
}

export async function registerEventSubRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/twitch/eventsub', async (request, reply) => {
    const messageType = headerValueToString(request.headers['twitch-eventsub-message-type']);
    if (!messageType || !verifyEventSubSignature(request)) {
      return badRequest(reply);
    }

    const payload = request.body as EventSubEnvelope;
    if (!payload?.subscription?.type) {
      return badRequest(reply);
    }

    if (messageType === 'webhook_callback_verification') {
      return reply.type('text/plain').send(payload.challenge ?? '');
    }

    if (messageType !== 'notification' || payload.subscription.type !== 'channel.channel_points_custom_reward_redemption.add') {
      return reply.code(204).send();
    }

    if (!payload.event?.id) {
      return badRequest(reply);
    }

    const [eventRow] = await db.insert(twitchEvents).values({
      twitchEventId: payload.event.id,
      type: payload.subscription.type,
      source: 'eventsub',
      rawPayload: payload,
      processingStatus: 'received'
    }).onConflictDoNothing().returning({ id: twitchEvents.id });

    if (!eventRow) {
      return reply.code(204).send();
    }

    try {
      await processRedemption(payload);
      await db.update(twitchEvents).set({ processingStatus: 'processed', processedAt: new Date() }).where(eq(twitchEvents.id, eventRow.id));
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ err: error }, 'eventsub redemption processing failed');
      await db.update(twitchEvents).set({ processingStatus: 'failed', error: error instanceof Error ? error.message : 'unknown_error' }).where(eq(twitchEvents.id, eventRow.id));
      return reply.code(500).send({ message: 'Event processing failed' });
    }
  });
}
