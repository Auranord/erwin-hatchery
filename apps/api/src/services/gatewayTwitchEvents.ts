import { and, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { economyLedger, resources, twitchBitsBalances, users } from '../db/schema.js';

const VOUCHER_RESOURCE_TYPE = 'voucher';

const GATEWAY_SUB_BITS_EVENT_TYPES = new Set([
  'twitch.channel.subscribe',
  'twitch.channel.subscription.end',
  'twitch.channel.subscription.message',
  'twitch.channel.subscription.gift',
  'twitch.channel.cheer'
]);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TwitchUserRef = {
  twitchUserId: string | null;
  twitchLogin: string | null;
  twitchDisplayName: string | null;
};

export type NormalizedGatewayTwitchEvent = {
  gatewayDeliveryId: string;
  gatewayEventId: string;
  eventType: string;
  twitchMessageId: string | null;
  primaryUser: TwitchUserRef;
  recipientUser: TwitchUserRef;
  isAnonymous: boolean;
  totalGiftCount: number;
  bits: number;
  rawPayload: Record<string, unknown>;
};

export type GatewayTwitchEventProcessingResult = {
  processed: boolean;
  ignored: boolean;
  reason: string | null;
  voucherGrants: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nested(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const found = record(value);
    if (found) return found;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function pickUser(...sources: (Record<string, unknown> | null | undefined)[]): TwitchUserRef {
  return {
    twitchUserId:
      sources.map((source) => stringValue(source?.id) ?? stringValue(source?.user_id) ?? stringValue(source?.userId)).find(Boolean) ?? null,
    twitchLogin:
      sources.map((source) => stringValue(source?.login) ?? stringValue(source?.user_login) ?? stringValue(source?.userLogin)).find(Boolean) ?? null,
    twitchDisplayName:
      sources.map((source) => stringValue(source?.display_name) ?? stringValue(source?.displayName) ?? stringValue(source?.user_name) ?? stringValue(source?.userName)).find(Boolean) ?? null
  };
}

export function isGatewaySubBitsEventType(eventType: string): boolean {
  return GATEWAY_SUB_BITS_EVENT_TYPES.has(eventType);
}

export function normalizeGatewayTwitchEventPayload(input: {
  deliveryId: string;
  eventId: string;
  eventType: string;
  twitchMessageId: string | null;
  payload: Record<string, unknown>;
}): NormalizedGatewayTwitchEvent | null {
  if (!isGatewaySubBitsEventType(input.eventType)) return null;

  const data = nested(input.payload.data);
  const event = nested(data?.event, input.payload.event, data);
  const twitch = nested(input.payload.twitch, data?.twitch);
  const user = nested(input.payload.user, data?.user, event?.user, twitch?.user);
  const gifter = nested(input.payload.gifter, data?.gifter, event?.gifter);
  const recipient = nested(input.payload.recipient, data?.recipient, event?.recipient);
  const message = nested(input.payload.message, data?.message, event?.message);

  const primaryUser = pickUser(user, event, data, twitch);
  const recipientUser = pickUser(
    recipient,
    {
      id: event?.recipient_user_id,
      login: event?.recipient_user_login,
      display_name: event?.recipient_user_name
    },
    {
      id: data?.recipient_user_id,
      login: data?.recipient_user_login,
      display_name: data?.recipient_user_name
    }
  );

  const giftUser = pickUser(gifter, user, event, data, twitch);

  return {
    gatewayDeliveryId: input.deliveryId,
    gatewayEventId: input.eventId,
    eventType: input.eventType,
    twitchMessageId:
      input.twitchMessageId ??
      stringValue(message?.id) ??
      stringValue(event?.message_id) ??
      stringValue(event?.eventsub_message_id) ??
      stringValue(event?.eventsubMessageId) ??
      stringValue(data?.message_id) ??
      stringValue(data?.eventsub_message_id) ??
      stringValue(data?.eventsubMessageId) ??
      stringValue(twitch?.message_id),
    primaryUser: input.eventType === 'twitch.channel.subscription.gift' ? giftUser : primaryUser,
    recipientUser,
    isAnonymous: booleanValue(event?.is_anonymous) || booleanValue(data?.is_anonymous) || booleanValue(input.payload.is_anonymous),
    totalGiftCount: Math.max(1, Math.floor(numberValue(event?.total) ?? numberValue(data?.total) ?? numberValue(input.payload.total) ?? 1)),
    bits: Math.max(0, Math.floor(numberValue(event?.bits) ?? numberValue(data?.bits) ?? numberValue(input.payload.bits) ?? 0)),
    rawPayload: input.payload
  };
}

async function upsertProvisionalUserInTx(tx: Tx, input: TwitchUserRef): Promise<{ id: string } | null> {
  if (!input.twitchUserId) return null;
  const now = new Date();
  const [user] = await tx
    .insert(users)
    .values({
      twitchUserId: input.twitchUserId,
      twitchLogin: input.twitchLogin,
      displayName: input.twitchDisplayName,
      isProvisional: true,
      lastLoginAt: null,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: users.twitchUserId,
      set: {
        twitchLogin: input.twitchLogin,
        displayName: input.twitchDisplayName,
        updatedAt: now
      }
    })
    .returning({ id: users.id });
  return user ?? null;
}

async function grantVoucherInTx(tx: Tx, input: { userId: string; gatewayEventRowId: string; amount: number; eventType: string; reason: string }): Promise<number> {
  const amount = Math.max(0, Math.floor(input.amount));
  if (amount <= 0) return 0;
  const [existingLedger] = await tx
    .select({ id: economyLedger.id })
    .from(economyLedger)
    .where(
      and(
        eq(economyLedger.sourceType, 'gateway_twitch_event'),
        eq(economyLedger.sourceId, input.gatewayEventRowId),
        eq(economyLedger.userId, input.userId),
        eq(economyLedger.eventType, input.eventType)
      )
    )
    .limit(1);
  if (existingLedger) return 0;

  const now = new Date();
  await tx
    .insert(resources)
    .values({ userId: input.userId, resourceType: VOUCHER_RESOURCE_TYPE, amount, updatedAt: now })
    .onConflictDoUpdate({
      target: [resources.userId, resources.resourceType],
      set: { amount: sql`${resources.amount} + ${amount}`, updatedAt: now }
    });
  await tx.insert(economyLedger).values({
    userId: input.userId,
    actorUserId: null,
    eventType: input.eventType,
    sourceType: 'gateway_twitch_event',
    sourceId: input.gatewayEventRowId,
    delta: { resources: [{ resourceType: VOUCHER_RESOURCE_TYPE, amountDelta: amount, reason: input.reason }] }
  });
  return amount;
}

async function grantBitsThresholdVouchersInTx(tx: Tx, input: { event: NormalizedGatewayTwitchEvent; gatewayEventRowId: string }): Promise<number> {
  const twitchUserId = input.event.primaryUser.twitchUserId;
  if (input.event.bits <= 0 || input.event.isAnonymous || !twitchUserId) return 0;
  const user = await upsertProvisionalUserInTx(tx, input.event.primaryUser);
  if (!user) return 0;

  const [existingLedger] = await tx
    .select({ id: economyLedger.id })
    .from(economyLedger)
    .where(and(eq(economyLedger.sourceType, 'gateway_twitch_event'), eq(economyLedger.sourceId, input.gatewayEventRowId)))
    .limit(1);
  if (existingLedger) return 0;

  const [existing] = await tx.select().from(twitchBitsBalances).where(eq(twitchBitsBalances.userId, user.id)).limit(1);
  const imported = existing?.importedBitsBaseline ?? 0;
  const live = (existing?.eventsubBitsTotal ?? 0) + input.event.bits;
  const total = imported + live;
  const thresholds = Math.floor(total / config.TWITCH_BITS_PER_VOUCHER);
  const alreadyGranted = existing?.voucherThresholdsGranted ?? 0;
  const vouchersToGrant = Math.max(0, thresholds - alreadyGranted);

  await tx
    .insert(twitchBitsBalances)
    .values({
      userId: user.id,
      twitchUserId,
      importedBitsBaseline: imported,
      eventsubBitsTotal: live,
      totalBitsCounted: total,
      voucherThresholdsGranted: thresholds,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [twitchBitsBalances.userId],
      set: { eventsubBitsTotal: live, totalBitsCounted: total, voucherThresholdsGranted: thresholds, updatedAt: new Date() }
    });

  if (vouchersToGrant <= 0) return 0;
  await tx.insert(economyLedger).values({
    userId: user.id,
    actorUserId: null,
    eventType: 'gateway_bits_voucher_granted',
    sourceType: 'gateway_twitch_event',
    sourceId: input.gatewayEventRowId,
    delta: { resources: [{ resourceType: VOUCHER_RESOURCE_TYPE, amountDelta: vouchersToGrant, reason: 'gateway_bits_threshold' }] }
  });
  return vouchersToGrant;
}

export async function processGatewayTwitchEventInTx(tx: Tx, event: NormalizedGatewayTwitchEvent, gatewayEventRowId: string): Promise<GatewayTwitchEventProcessingResult> {
  if (config.ERWIN_GATEWAY_OBSERVE_ONLY) return { processed: true, ignored: false, reason: 'observe_only', voucherGrants: 0 };

  if (event.eventType === 'twitch.channel.subscription.end') {
    if (!event.primaryUser.twitchUserId) return { processed: true, ignored: true, reason: 'missing_twitch_user', voucherGrants: 0 };
    const user = await upsertProvisionalUserInTx(tx, event.primaryUser);
    if (!user) return { processed: true, ignored: true, reason: 'missing_twitch_user', voucherGrants: 0 };
    await tx.update(users).set({ isSubscriber: false, subscriberEndsAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
    return { processed: true, ignored: false, reason: 'subscription_ended_no_voucher', voucherGrants: 0 };
  }

  if (event.eventType === 'twitch.channel.subscribe' || event.eventType === 'twitch.channel.subscription.message') {
    if (!event.primaryUser.twitchUserId) return { processed: true, ignored: true, reason: 'missing_twitch_user', voucherGrants: 0 };
    const user = await upsertProvisionalUserInTx(tx, event.primaryUser);
    if (!user) return { processed: true, ignored: true, reason: 'missing_twitch_user', voucherGrants: 0 };
    await tx.update(users).set({ isSubscriber: true, updatedAt: new Date() }).where(eq(users.id, user.id));
    const granted = await grantVoucherInTx(tx, {
      userId: user.id,
      gatewayEventRowId,
      amount: 1,
      eventType: event.eventType === 'twitch.channel.subscribe' ? 'gateway_subscription_voucher_granted' : 'gateway_resubscription_voucher_granted',
      reason: event.eventType === 'twitch.channel.subscribe' ? 'gateway_subscription_recipient' : 'gateway_resubscription_message'
    });
    return { processed: true, ignored: granted === 0, reason: granted === 0 ? 'duplicate_or_no_voucher_delta' : null, voucherGrants: granted };
  }

  if (event.eventType === 'twitch.channel.subscription.gift') {
    let granted = 0;
    if (!event.isAnonymous && event.primaryUser.twitchUserId) {
      const gifter = await upsertProvisionalUserInTx(tx, event.primaryUser);
      if (gifter) {
        granted += await grantVoucherInTx(tx, {
          userId: gifter.id,
          gatewayEventRowId,
          amount: event.totalGiftCount,
          eventType: 'gateway_gift_subscription_voucher_granted',
          reason: 'gateway_gift_subscription_gifter'
        });
      }
    }
    if (event.recipientUser.twitchUserId) {
      const recipient = await upsertProvisionalUserInTx(tx, event.recipientUser);
      if (recipient) {
        granted += await grantVoucherInTx(tx, {
          userId: recipient.id,
          gatewayEventRowId,
          amount: 1,
          eventType: 'gateway_gift_subscription_recipient_voucher_granted',
          reason: 'gateway_gift_subscription_recipient'
        });
      }
      if (recipient) await tx.update(users).set({ isSubscriber: true, updatedAt: new Date() }).where(eq(users.id, recipient.id));
    }
    return { processed: true, ignored: granted === 0, reason: granted === 0 ? 'anonymous_or_duplicate_gift_without_recipient_grant' : null, voucherGrants: granted };
  }

  if (event.eventType === 'twitch.channel.cheer') {
    if (event.bits <= 0) return { processed: true, ignored: true, reason: 'missing_bits_amount', voucherGrants: 0 };
    if (event.isAnonymous || !event.primaryUser.twitchUserId) return { processed: true, ignored: true, reason: 'anonymous_bits_audited_no_grant', voucherGrants: 0 };
    const granted = await grantBitsThresholdVouchersInTx(tx, { event, gatewayEventRowId });
    return { processed: true, ignored: false, reason: granted === 0 ? 'bits_threshold_not_reached' : null, voucherGrants: granted };
  }

  return { processed: false, ignored: true, reason: 'unsupported_gateway_twitch_event', voucherGrants: 0 };
}
