import { eq } from 'drizzle-orm';
import { config, getEventSubCallbackUrl } from '../config.js';
import { db } from '../db/client.js';
import { twitchEvents, twitchUserTokens, users } from '../db/schema.js';
import { getSubscriptionStatusFromEventType } from '../routes/eventsub.js';

const TARGET_SUBSCRIPTION_TYPES = [
  'channel.channel_points_custom_reward_redemption.add',
  'channel.subscribe',
  'channel.subscription.end',
  'channel.subscription.message'
] as const;
const TARGET_SUBSCRIPTION_VERSION = '1';

type TwitchEventSubTransport = {
  method: 'webhook';
  callback: string;
  secret: string;
};

type TwitchEventSubSubscription = {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: { broadcaster_user_id?: string };
  created_at: string;
  transport: TwitchEventSubTransport;
};

type EventSubSyncStatusValue = 'enabled' | 'missing' | 'error' | 'duplicate' | 'pending_verification';

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


async function readErrorDetails(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    const details = [payload?.error, payload?.message].filter((value): value is string => Boolean(value));
    if (details.length > 0) {
      return details.join(' - ');
    }
  }

  const text = await response.text().catch(() => '');
  const normalized = text.trim();
  return normalized.length > 0 ? normalized.slice(0, 300) : 'no response body';
}

let eventSubSyncState: EventSubSyncState = {
  enabled: false,
  status: 'missing',
  subscriptionId: null,
  type: TARGET_SUBSCRIPTION_TYPES.join(','),
  callback: getEventSubCallbackUrl(),
  createdAt: null,
  lastCheckedAt: new Date(0).toISOString(),
  error: null
};

const REQUIRED_BROADCASTER_SCOPES = [
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'channel:read:subscriptions'
] as const;

async function assertBroadcasterAuthorization(): Promise<void> {
  const rows = await db
    .select({ accessToken: twitchUserTokens.accessToken, scope: twitchUserTokens.scope })
    .from(twitchUserTokens)
    .innerJoin(users, eq(users.id, twitchUserTokens.userId))
    .where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID))
    .limit(1);

  const tokenRow = rows[0];
  if (!tokenRow?.accessToken) {
    throw new Error('Missing broadcaster OAuth token. Login with broadcaster account first.');
  }

  const grantedScopes = new Set(tokenRow.scope.split(/\s+/).filter(Boolean));
  const missingScopes = REQUIRED_BROADCASTER_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Broadcaster token missing scopes: ${missingScopes.join(', ')}. Login again to refresh scopes.`);
  }

}

async function getBroadcasterUserAccessToken(): Promise<string> {
  const rows = await db
    .select({ accessToken: twitchUserTokens.accessToken })
    .from(twitchUserTokens)
    .innerJoin(users, eq(users.id, twitchUserTokens.userId))
    .where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID))
    .limit(1);
  const token = rows[0]?.accessToken;
  if (!token) throw new Error('Missing broadcaster OAuth token. Login with broadcaster account first.');
  return token;
}


async function getAppAccessToken(): Promise<string> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(`Twitch app token request failed: ${response.status} (${details})`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error('Twitch app token response did not include access_token');
  return payload.access_token;
}
async function twitchApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: {
      'Client-Id': config.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(`Twitch API ${path} failed: ${response.status} (${details})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getEventSubSubscriptionStatus(): EventSubSyncState {
  return { ...eventSubSyncState };
}

export async function syncChannelPointRedemptionEventSub(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  const checkedAt = new Date().toISOString();
  eventSubSyncState = { ...eventSubSyncState, lastCheckedAt: checkedAt, error: null };

  if (!config.TWITCH_EVENTSUB_AUTO_SYNC) {
    eventSubSyncState = { ...eventSubSyncState, status: 'missing', enabled: false, error: 'Auto-sync disabled by TWITCH_EVENTSUB_AUTO_SYNC=false' };
    return;
  }

  try {
    await assertBroadcasterAuthorization();
    const token = await getAppAccessToken();
    const list = await twitchApi<{ data: TwitchEventSubSubscription[] }>('/eventsub/subscriptions', token);
    const ensured: TwitchEventSubSubscription[] = [];
    let duplicateCleanupCount = 0;
    for (const subscriptionType of TARGET_SUBSCRIPTION_TYPES) {
      const matching = list.data.filter((subscription) => (
        subscription.type === subscriptionType
        && subscription.version === TARGET_SUBSCRIPTION_VERSION
        && subscription.condition.broadcaster_user_id === config.TWITCH_BROADCASTER_ID
        && subscription.transport.method === 'webhook'
        && subscription.transport.callback === getEventSubCallbackUrl()
      ));
      if (matching.length > 1) {
        duplicateCleanupCount += matching.length - 1;
        for (const duplicate of matching.slice(1)) {
          await twitchApi(`/eventsub/subscriptions?id=${encodeURIComponent(duplicate.id)}`, token, { method: 'DELETE' });
        }
      }
      const active = matching[0];
      if (active) {
        ensured.push(active);
        continue;
      }
      const created = await twitchApi<{ data: TwitchEventSubSubscription[] }>('/eventsub/subscriptions', token, {
        method: 'POST',
        body: JSON.stringify({
          type: subscriptionType,
          version: TARGET_SUBSCRIPTION_VERSION,
          condition: { broadcaster_user_id: config.TWITCH_BROADCASTER_ID },
          transport: {
            method: 'webhook',
            callback: getEventSubCallbackUrl(),
            secret: config.TWITCH_EVENTSUB_SECRET
          }
        })
      });
      const first = created.data[0];
      if (!first) throw new Error(`Twitch create subscription response was empty for ${subscriptionType}`);
      ensured.push(first);
    }
    const allEnabled = ensured.every((subscription) => subscription.status === 'enabled');
    const anyPending = ensured.some((subscription) => subscription.status === 'webhook_callback_verification_pending');
    const first = ensured[0]!;

    eventSubSyncState = {
      enabled: allEnabled,
      status: allEnabled ? 'enabled' : anyPending ? 'pending_verification' : 'error',
      subscriptionId: ensured.map((subscription) => subscription.id).join(','),
      type: TARGET_SUBSCRIPTION_TYPES.join(','),
      callback: first.transport.callback,
      createdAt: first.created_at,
      lastCheckedAt: checkedAt,
      error: duplicateCleanupCount > 0 ? `Duplicate subscriptions detected and cleaned up (${duplicateCleanupCount}).` : null
    };
    log.info({ subscriptionIds: ensured.map((subscription) => subscription.id), status: eventSubSyncState.status }, 'EventSub subscriptions ensured');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    eventSubSyncState = {
      ...eventSubSyncState,
      enabled: false,
      status: 'error',
      subscriptionId: null,
      createdAt: null,
      lastCheckedAt: checkedAt,
      error: `EventSub sync failed: ${message}`
    };
    log.error({ err: error }, 'EventSub sync failed');
  }
}

type SubscriptionEventEnvelope = {
  event?: {
    user_id?: string;
    user_login?: string;
    user_name?: string;
  };
};

type HelixSubscription = {
  user_id: string;
  user_login: string;
  user_name: string;
};

type HelixSubscriptionsResponse = {
  data: HelixSubscription[];
  pagination?: { cursor?: string };
};

export async function syncSubscriberStatusFromTwitch(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  await assertBroadcasterAuthorization();
  const token = await getBroadcasterUserAccessToken();
  const now = new Date();
  const subscriberEndsAt = new Date(now);
  subscriberEndsAt.setUTCDate(subscriberEndsAt.getUTCDate() + config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS);

  const activeSubs: HelixSubscription[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      broadcaster_id: config.TWITCH_BROADCASTER_ID,
      first: '100'
    });
    if (cursor) query.set('after', cursor);
    const page = await twitchApi<HelixSubscriptionsResponse>(`/subscriptions?${query.toString()}`, token);
    activeSubs.push(...page.data);
    cursor = page.pagination?.cursor ?? null;
  } while (cursor);

  const activeSubUserIds = new Set(activeSubs.map((sub) => sub.user_id));
  const currentSubscriberUsers = await db.select({
    id: users.id,
    twitchUserId: users.twitchUserId
  }).from(users).where(eq(users.isSubscriber, true));

  let deactivatedSubscribers = 0;
  for (const user of currentSubscriberUsers) {
    if (activeSubUserIds.has(user.twitchUserId)) continue;
    await db.update(users).set({
      isSubscriber: false,
      subscriberEndsAt: now,
      updatedAt: now
    }).where(eq(users.id, user.id));
    deactivatedSubscribers += 1;
  }

  for (const sub of activeSubs) {
    const existing = await db.select().from(users).where(eq(users.twitchUserId, sub.user_id)).limit(1);
    const current = existing[0];
    if (current) {
      await db.update(users).set({
        twitchLogin: sub.user_login,
        displayName: sub.user_name,
        isSubscriber: true,
        subscriberEndsAt,
        updatedAt: now
      }).where(eq(users.id, current.id));
    } else {
      await db.insert(users).values({
        twitchUserId: sub.user_id,
        twitchLogin: sub.user_login,
        displayName: sub.user_name,
        isProvisional: true,
        isSubscriber: true,
        subscriberEndsAt,
        lastLoginAt: null,
        updatedAt: now
      });
    }
  }

  log.info({ activeSubscriptions: activeSubs.length, deactivatedSubscribers }, 'Subscriber startup sync from Twitch completed');
}

export async function syncSubscriberStatusFromRecentEvents(log: { info: Function; warn: Function; error: Function }): Promise<void> {
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS);
  const rows = await db.select({
    type: twitchEvents.type,
    rawPayload: twitchEvents.rawPayload,
    receivedAt: twitchEvents.receivedAt
  }).from(twitchEvents);

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
    const subscriberEndsAt = status ? new Date(now.getTime() + (config.TWITCH_SUBSCRIPTION_RENEWAL_DAYS * 24 * 60 * 60 * 1000)) : now;
    const userLogin = payload.event?.user_login ?? null;
    const displayName = payload.event?.user_name ?? null;
    const existing = await db.select().from(users).where(eq(users.twitchUserId, twitchUserId)).limit(1);
    const current = existing[0];
    if (current) {
      await db.update(users).set({
        isSubscriber: status,
        subscriberEndsAt,
        twitchLogin: userLogin ?? current.twitchLogin ?? null,
        displayName: displayName ?? current.displayName ?? null,
        updatedAt: now
      }).where(eq(users.id, current.id));
    } else {
      await db.insert(users).values({
        twitchUserId,
        twitchLogin: userLogin,
        displayName,
        isProvisional: true,
        isSubscriber: status,
        subscriberEndsAt,
        lastLoginAt: null,
        updatedAt: now
      });
    }
    updatedUsers += 1;
  }

  log.info({ scannedEvents: relevantRows.length, updatedUsers, rangeStart: rangeStart.toISOString() }, 'Subscriber startup status replay completed');
}
