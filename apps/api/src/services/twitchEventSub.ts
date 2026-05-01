import { config, getEventSubCallbackUrl } from '../config.js';
import { db } from '../db/client.js';
import { twitchUserTokens, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const TARGET_SUBSCRIPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';
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
  type: TARGET_SUBSCRIPTION_TYPE,
  callback: getEventSubCallbackUrl(),
  createdAt: null,
  lastCheckedAt: new Date(0).toISOString(),
  error: null
};

async function refreshBroadcasterUserToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string[] }> {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const details = await readErrorDetails(response);
    throw new Error(`Failed to refresh Twitch user token: ${response.status} (${details})`);
  }

  const payload = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string[] };
  if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
    throw new Error('Refresh response missing access_token, refresh_token, or expires_in');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: payload.scope ?? []
  };
}

async function getBroadcasterEventSubToken(): Promise<string> {
  const [broadcaster] = await db.select({ id: users.id }).from(users).where(eq(users.twitchUserId, config.TWITCH_BROADCASTER_ID)).limit(1);
  if (!broadcaster) {
    throw new Error('Broadcaster user not found locally. Please login once with broadcaster account.');
  }

  const [storedToken] = await db.select().from(twitchUserTokens).where(eq(twitchUserTokens.userId, broadcaster.id)).limit(1);
  if (!storedToken) {
    throw new Error('Broadcaster OAuth token not found. Please login once with broadcaster account.');
  }

  const requiredScope = 'channel:read:redemptions';
  const hasScope = storedToken.scope.split(/\s+/).includes(requiredScope);
  if (!hasScope) {
    throw new Error(`Broadcaster token missing required scope: ${requiredScope}. Please logout/login broadcaster account.`);
  }

  const refreshBeforeMs = 60_000;
  if (storedToken.expiresAt.getTime() - Date.now() > refreshBeforeMs) {
    return storedToken.accessToken;
  }

  const refreshed = await refreshBroadcasterUserToken(storedToken.refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
  await db.update(twitchUserTokens).set({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    scope: refreshed.scope.join(' '),
    expiresAt,
    updatedAt: new Date()
  }).where(eq(twitchUserTokens.userId, broadcaster.id));

  return refreshed.accessToken;
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
    const token = await getBroadcasterEventSubToken();
    const list = await twitchApi<{ data: TwitchEventSubSubscription[] }>('/eventsub/subscriptions', token);
    const matching = list.data.filter((subscription) => (
      subscription.type === TARGET_SUBSCRIPTION_TYPE
      && subscription.version === TARGET_SUBSCRIPTION_VERSION
      && subscription.condition.broadcaster_user_id === config.TWITCH_BROADCASTER_ID
      && subscription.transport.method === 'webhook'
      && subscription.transport.callback === getEventSubCallbackUrl()
    ));

    const active = matching.find((subscription) => subscription.status === 'enabled' || subscription.status === 'webhook_callback_verification_pending');

    if (matching.length > 1) {
      log.warn({ count: matching.length }, 'Duplicate EventSub subscriptions detected; attempting cleanup');
      for (const duplicate of matching.slice(1)) {
        await twitchApi(`/eventsub/subscriptions?id=${encodeURIComponent(duplicate.id)}`, token, { method: 'DELETE' });
      }
    }

    if (active) {
      const status = active.status === 'enabled' ? 'enabled' : 'pending_verification';
      eventSubSyncState = {
        enabled: active.status === 'enabled',
        status,
        subscriptionId: active.id,
        type: active.type,
        callback: active.transport.callback,
        createdAt: active.created_at,
        lastCheckedAt: checkedAt,
        error: matching.length > 1 ? 'Duplicate subscriptions were detected and cleaned up.' : null
      };
      log.info({ subscriptionId: active.id, status }, 'EventSub subscription is present');
      return;
    }

    const created = await twitchApi<{ data: TwitchEventSubSubscription[] }>('/eventsub/subscriptions', token, {
      method: 'POST',
      body: JSON.stringify({
        type: TARGET_SUBSCRIPTION_TYPE,
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
    if (!first) {
      throw new Error('Twitch create subscription response was empty');
    }

    eventSubSyncState = {
      enabled: first.status === 'enabled',
      status: first.status === 'enabled' ? 'enabled' : 'pending_verification',
      subscriptionId: first.id,
      type: first.type,
      callback: first.transport.callback,
      createdAt: first.created_at,
      lastCheckedAt: checkedAt,
      error: null
    };
    log.info({ subscriptionId: first.id, status: first.status }, 'Created Twitch EventSub subscription');
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
