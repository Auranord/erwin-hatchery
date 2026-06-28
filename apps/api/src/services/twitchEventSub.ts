import { eq } from 'drizzle-orm';
import { config, getEventSubCallbackUrl } from '../config.js';
import { db } from '../db/client.js';
import { twitchEventSubSubscriptions, twitchIntegrationState, twitchEvents, users } from '../db/schema.js';

export const REQUIRED_EVENTSUB_SUBSCRIPTIONS = [
  'channel.channel_points_custom_reward_redemption.add',
  'channel.subscribe',
  'channel.subscription.end',
  'channel.subscription.message',
  'channel.subscription.gift',
  'channel.cheer',
] as const;

const GATEWAY_MIGRATED_EVENTSUB_TYPES = new Set<string>([...REQUIRED_EVENTSUB_SUBSCRIPTIONS, 'stream.online', 'stream.offline', 'channel.update']);

const TARGET_SUBSCRIPTION_VERSION = '1';

type EventSubSyncStatusValue = 'disabled_gateway';

type EventSubSyncState = {
  enabled: boolean;
  status: EventSubSyncStatusValue;
  subscriptionId: string | null;
  type: string;
  callback: string;
  createdAt: string | null;
  lastCheckedAt: string;
  error: string | null;
};

let eventSubSyncState: EventSubSyncState = {
  enabled: false,
  status: 'disabled_gateway',
  subscriptionId: null,
  type: '',
  callback: getEventSubCallbackUrl(),
  createdAt: null,
  lastCheckedAt: new Date(0).toISOString(),
  error: 'Direct Twitch EventSub transport is retired; erwin-gateway is required',
};

async function persistRetiredEventSubStatuses(): Promise<void> {
  const now = new Date();
  for (const eventType of GATEWAY_MIGRATED_EVENTSUB_TYPES) {
    await db
      .insert(twitchEventSubSubscriptions)
      .values({
        eventType,
        version: TARGET_SUBSCRIPTION_VERSION,
        twitchSubscriptionId: null,
        status: 'disabled_gateway',
        callbackUrl: getEventSubCallbackUrl(),
        lastSyncedAt: now,
        lastError: 'Direct Twitch EventSub transport is retired; erwin-gateway is required',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [twitchEventSubSubscriptions.eventType, twitchEventSubSubscriptions.version],
        set: {
          twitchSubscriptionId: null,
          status: 'disabled_gateway',
          callbackUrl: getEventSubCallbackUrl(),
          lastSyncedAt: now,
          lastError: 'Direct Twitch EventSub transport is retired; erwin-gateway is required',
          updatedAt: now,
        },
      });
  }
}

export async function checkEventSubHealth(): Promise<
  EventSubSyncState & {
    subscriptions: Array<{
      eventType: string;
      status: string;
      subscriptionId: string | null;
      callbackUrl: string;
      lastError: string | null;
    }>;
  }
> {
  return {
    ...eventSubSyncState,
    lastCheckedAt: new Date().toISOString(),
    subscriptions: [],
  };
}

export function getEventSubSubscriptionStatus(): EventSubSyncState {
  return { ...eventSubSyncState };
}

export async function syncChannelPointRedemptionEventSub(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  eventSubSyncState = {
    enabled: false,
    status: 'disabled_gateway',
    subscriptionId: null,
    type: '',
    callback: getEventSubCallbackUrl(),
    createdAt: null,
    lastCheckedAt: new Date().toISOString(),
    error: 'Direct Twitch EventSub transport is retired; erwin-gateway is required',
  };
  await persistRetiredEventSubStatuses();
  await db
    .update(twitchIntegrationState)
    .set({
      eventsubHealthy: false,
      lastError: eventSubSyncState.error,
      updatedAt: new Date(),
    })
    .where(eq(twitchIntegrationState.id, 'default'));
  log.info('Direct Twitch EventSub sync skipped because erwin-gateway is required');
}

function getSubscriptionStatusFromEventType(eventType: string): boolean | null {
  const activateTypes = new Set(['channel.subscribe', 'channel.subscription.message']);
  const deactivateTypes = new Set(['channel.subscription.end']);
  if (activateTypes.has(eventType)) return true;
  if (deactivateTypes.has(eventType)) return false;
  return null;
}

type SubscriptionEventEnvelope = {
  event?: {
    user_id?: string;
    user_login?: string;
    user_name?: string;
  };
};

export async function syncSubscriberStatusFromRecentEvents(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS);
  const rows = await db
    .select({
      type: twitchEvents.type,
      rawPayload: twitchEvents.rawPayload,
      receivedAt: twitchEvents.receivedAt,
    })
    .from(twitchEvents);

  const relevantRows = rows
    .filter((row) => row.receivedAt >= rangeStart)
    .filter((row) => getSubscriptionStatusFromEventType(row.type) !== null)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

  let updatedUsers = 0;
  for (const row of relevantRows) {
    const payload = row.rawPayload as SubscriptionEventEnvelope;
    const twitchUserId = payload.event?.user_id?.trim();
    const status = getSubscriptionStatusFromEventType(row.type);
    if (!twitchUserId || status === null) continue;
    const subscriberEndsAt = status ? new Date(now.getTime() + config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS * 24 * 60 * 60 * 1000) : now;
    const userLogin = payload.event?.user_login ?? null;
    const displayName = payload.event?.user_name ?? null;
    const existing = await db.select().from(users).where(eq(users.twitchUserId, twitchUserId)).limit(1);
    const current = existing[0];
    if (current) {
      await db
        .update(users)
        .set({
          isSubscriber: status,
          subscriberEndsAt,
          twitchLogin: userLogin ?? current.twitchLogin ?? null,
          displayName: displayName ?? current.displayName ?? null,
          updatedAt: now,
        })
        .where(eq(users.id, current.id));
    } else {
      await db.insert(users).values({
        twitchUserId,
        twitchLogin: userLogin,
        displayName,
        isProvisional: true,
        isSubscriber: status,
        subscriberEndsAt,
        lastLoginAt: null,
        updatedAt: now,
      });
    }
    updatedUsers += 1;
  }

  log.info(
    {
      scannedEvents: relevantRows.length,
      updatedUsers,
      rangeStart: rangeStart.toISOString(),
    },
    'Subscriber startup status replay completed',
  );
}
