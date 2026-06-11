import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { streamStateCache } from '../db/schema.js';
import { createErwinGatewayClient, type GatewayChannel, type GatewayChannelProfile, type GatewayChannelSchedule, type GatewayCurrentStream } from './erwinGatewayClient.js';

export type GatewayStreamEventType = 'twitch.stream.online' | 'twitch.stream.offline' | 'twitch.channel.update';

type LiveOverride = 'live' | 'offline' | null;

let manualOverride: LiveOverride = null;
let cachedAppToken: { accessToken: string; expiresAtMs: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAppToken && cachedAppToken.expiresAtMs > now + 30_000) return cachedAppToken.accessToken;

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.TWITCH_CLIENT_ID,
      client_secret: config.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  if (!response.ok) throw new Error(`Failed Twitch app token request: ${response.status}`);
  const payload = await response.json() as { access_token: string; expires_in: number };
  cachedAppToken = { accessToken: payload.access_token, expiresAtMs: now + (Math.max(60, payload.expires_in) * 1000) };
  return payload.access_token;
}

async function twitchApi<T>(path: string): Promise<T> {
  const token = await getAppAccessToken();
  const response = await fetch(`https://api.twitch.tv/helix${path}`, {
    headers: { 'Client-Id': config.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Twitch ${path} response ${response.status}`);
  return await response.json() as T;
}

export function setManualStreamStateOverride(next: LiveOverride): void {
  manualOverride = next;
}

export function getManualStreamStateOverride(): LiveOverride {
  return manualOverride;
}

export type StreamStateSource = 'debug_env' | 'manual_override' | 'gateway_webhook' | 'gateway_api' | 'twitch_helix_rollback' | 'cache' | 'fallback_offline';

type HelixStream = {
  title?: string;
  game_name?: string;
  viewer_count?: number;
  started_at?: string;
};

type HelixUser = {
  id: string;
  login?: string;
  display_name?: string;
  profile_image_url?: string;
};

type HelixScheduleSegment = {
  id: string;
  title?: string;
  start_time: string;
  end_time?: string;
  category?: { name?: string } | null;
  canceled_until?: string | null;
};

type CachedStreamState = {
  isLive: boolean;
  viewerCount: number;
  title: string | null;
  category: string | null;
  startedAt: string | null;
  source: StreamStateSource;
  sourceEventId: string | null;
  sourceDeliveryId: string | null;
  updatedAt: string;
};

type GatewayStreamPayload = {
  isLive: boolean;
  viewerCount: number;
  title: string | null;
  category: string | null;
  startedAt: string | null;
  stream: Record<string, unknown> | null;
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

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'online', 'live'].includes(normalized)) return true;
    if (['false', '0', 'no', 'offline'].includes(normalized)) return false;
  }
  return null;
}

function normalizeGatewayStreamPayload(input: GatewayCurrentStream | Record<string, unknown>, eventType?: string): GatewayStreamPayload {
  const root = input as Record<string, unknown>;
  const data = nested(root.data);
  const event = nested(data?.event, root.event, data);
  const stream = nested(root.stream, data?.stream, event?.stream, event);
  const channel = nested(root.channel, data?.channel, event?.channel);
  const source = stream ?? event ?? data ?? root;
  const eventLive = eventType === 'twitch.stream.online' ? true : eventType === 'twitch.stream.offline' ? false : null;
  const isLive = eventLive ?? booleanValue(source?.is_live) ?? booleanValue(source?.isLive) ?? Boolean(stream && eventType !== 'twitch.stream.offline');
  const viewerCount = Math.max(0, Math.floor(numberValue(source?.viewer_count) ?? numberValue(source?.viewerCount) ?? 0));
  return {
    isLive,
    viewerCount,
    title: stringValue(source?.title) ?? stringValue(channel?.title) ?? null,
    category: stringValue(source?.game_name) ?? stringValue(source?.gameName) ?? stringValue(source?.category) ?? stringValue(channel?.game_name) ?? stringValue(channel?.category) ?? null,
    startedAt: stringValue(source?.started_at) ?? stringValue(source?.startedAt) ?? null,
    stream: stream ?? (isLive ? source : null)
  };
}

function normalizeGatewayChannel(channels: GatewayChannel[]): GatewayChannel | null {
  return channels.find((channel) => {
    const id = stringValue(channel.id) ?? stringValue(channel.channelId) ?? stringValue(channel.channel_id) ?? stringValue(channel.broadcaster_id) ?? stringValue(channel.broadcasterUserId);
    return id === config.TWITCH_BROADCASTER_ID;
  }) ?? channels[0] ?? null;
}

function normalizeGatewayProfile(profile: GatewayChannelProfile | null, fallbackChannel: GatewayChannel | null) {
  const root = record(profile) ?? {};
  const profileRecord = nested(root.profile, root.channel, root.data, root) ?? {};
  const fallback = record(fallbackChannel) ?? {};
  return {
    id: stringValue(profileRecord.id) ?? stringValue(profileRecord.channelId) ?? stringValue(profileRecord.broadcaster_id) ?? stringValue(fallback.id) ?? stringValue(fallback.channelId) ?? config.TWITCH_BROADCASTER_ID,
    login: stringValue(profileRecord.login) ?? stringValue(profileRecord.broadcaster_login) ?? stringValue(fallback.login) ?? null,
    displayName: stringValue(profileRecord.display_name) ?? stringValue(profileRecord.displayName) ?? stringValue(profileRecord.broadcaster_name) ?? stringValue(fallback.displayName) ?? null,
    avatarUrl: stringValue(profileRecord.profile_image_url) ?? stringValue(profileRecord.profileImageUrl) ?? stringValue(profileRecord.avatarUrl) ?? null
  };
}

function normalizeGatewaySchedule(schedule: GatewayChannelSchedule | null) {
  const root = record(schedule) ?? {};
  const data = nested(root.data, root.schedule, root) ?? {};
  const segmentValues = Array.isArray(data.segments) ? data.segments : Array.isArray(root.segments) ? root.segments : [];
  const segment = segmentValues.map(record).find((item) => item && !item.canceled_until && !item.canceledUntil) ?? null;
  const category = nested(segment?.category);
  return segment ? {
    id: stringValue(segment.id) ?? 'gateway-schedule-segment',
    title: stringValue(segment.title),
    startTime: stringValue(segment.start_time) ?? stringValue(segment.startTime) ?? new Date().toISOString(),
    endTime: stringValue(segment.end_time) ?? stringValue(segment.endTime),
    category: stringValue(category?.name) ?? stringValue(segment.category)
  } : null;
}

async function loadCachedStreamState(): Promise<CachedStreamState | null> {
  const [row] = await db.select().from(streamStateCache).where(eq(streamStateCache.id, 'default')).limit(1);
  if (!row) return null;
  return {
    isLive: row.isLive,
    viewerCount: Math.max(0, row.viewerCount ?? 0),
    title: row.title,
    category: row.category,
    startedAt: row.startedAt?.toISOString() ?? null,
    source: row.source as StreamStateSource,
    sourceEventId: row.sourceEventId,
    sourceDeliveryId: row.sourceDeliveryId,
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function upsertGatewayStreamStateFromPayload(input: {
  eventType: GatewayStreamEventType;
  gatewayEventId: string;
  gatewayDeliveryId: string;
  payload: Record<string, unknown>;
}): Promise<CachedStreamState> {
  const existing = await loadCachedStreamState();
  const normalized = normalizeGatewayStreamPayload(input.payload, input.eventType);
  const next = {
    isLive: input.eventType === 'twitch.channel.update' ? (existing?.isLive ?? normalized.isLive) : normalized.isLive,
    viewerCount: input.eventType === 'twitch.channel.update' ? (existing?.viewerCount ?? normalized.viewerCount) : normalized.viewerCount,
    title: normalized.title ?? existing?.title ?? null,
    category: normalized.category ?? existing?.category ?? null,
    startedAt: input.eventType === 'twitch.stream.offline' ? null : normalized.startedAt ?? existing?.startedAt ?? null
  };
  const now = new Date();
  const [row] = await db.insert(streamStateCache).values({
    id: 'default',
    isLive: next.isLive,
    title: next.title,
    category: next.category,
    viewerCount: next.viewerCount,
    startedAt: next.startedAt ? new Date(next.startedAt) : null,
    source: 'gateway_webhook',
    sourceEventId: input.gatewayEventId,
    sourceDeliveryId: input.gatewayDeliveryId,
    rawPayload: input.payload,
    updatedAt: now
  }).onConflictDoUpdate({
    target: streamStateCache.id,
    set: {
      isLive: next.isLive,
      title: next.title,
      category: next.category,
      viewerCount: next.viewerCount,
      startedAt: next.startedAt ? new Date(next.startedAt) : null,
      source: 'gateway_webhook',
      sourceEventId: input.gatewayEventId,
      sourceDeliveryId: input.gatewayDeliveryId,
      rawPayload: input.payload,
      updatedAt: now
    }
  }).returning();
  return {
    isLive: row?.isLive ?? next.isLive,
    viewerCount: row?.viewerCount ?? next.viewerCount,
    title: row?.title ?? next.title,
    category: row?.category ?? next.category,
    startedAt: row?.startedAt?.toISOString() ?? next.startedAt,
    source: 'gateway_webhook',
    sourceEventId: input.gatewayEventId,
    sourceDeliveryId: input.gatewayDeliveryId,
    updatedAt: row?.updatedAt?.toISOString() ?? now.toISOString()
  };
}

async function refreshGatewayStreamCache(): Promise<CachedStreamState | null> {
  const client = createErwinGatewayClient();
  if (!client) return null;
  const current = await client.getCurrentStream();
  const normalized = normalizeGatewayStreamPayload(current);
  const now = new Date();
  const [row] = await db.insert(streamStateCache).values({
    id: 'default',
    isLive: normalized.isLive,
    title: normalized.title,
    category: normalized.category,
    viewerCount: normalized.viewerCount,
    startedAt: normalized.startedAt ? new Date(normalized.startedAt) : null,
    source: 'gateway_api',
    sourceEventId: null,
    sourceDeliveryId: null,
    rawPayload: current as Record<string, unknown>,
    updatedAt: now
  }).onConflictDoUpdate({
    target: streamStateCache.id,
    set: {
      isLive: normalized.isLive,
      title: normalized.title,
      category: normalized.category,
      viewerCount: normalized.viewerCount,
      startedAt: normalized.startedAt ? new Date(normalized.startedAt) : null,
      source: 'gateway_api',
      sourceEventId: null,
      sourceDeliveryId: null,
      rawPayload: current as Record<string, unknown>,
      updatedAt: now
    }
  }).returning();
  return {
    isLive: row?.isLive ?? normalized.isLive,
    viewerCount: row?.viewerCount ?? normalized.viewerCount,
    title: row?.title ?? normalized.title,
    category: row?.category ?? normalized.category,
    startedAt: row?.startedAt?.toISOString() ?? normalized.startedAt,
    source: 'gateway_api',
    sourceEventId: null,
    sourceDeliveryId: null,
    updatedAt: row?.updatedAt?.toISOString() ?? now.toISOString()
  };
}

export async function getLocalStreamStateCache(): Promise<CachedStreamState | null> {
  return loadCachedStreamState();
}

export async function getCurrentStreamState(): Promise<{ isLive: boolean; viewerCount: number; source: StreamStateSource; title?: string | null; category?: string | null; updatedAt?: string | null }> {
  if (config.DEBUG_MODE) {
    return { isLive: true, viewerCount: 0, source: 'debug_env', title: null, category: null, updatedAt: null };
  }

  if (manualOverride) {
    return { isLive: manualOverride === 'live', viewerCount: 0, source: 'manual_override', title: null, category: null, updatedAt: new Date().toISOString() };
  }

  if (config.ERWIN_GATEWAY_ENABLED || config.ERWIN_GATEWAY_REQUIRED) {
    try {
      const gatewayState = await refreshGatewayStreamCache();
      if (gatewayState) return gatewayState;
    } catch {
      const cached = await loadCachedStreamState();
      if (cached) return { ...cached, source: 'cache' };
      return { isLive: false, viewerCount: 0, source: 'fallback_offline', title: null, category: null, updatedAt: null };
    }
  }

  try {
    const payload = await twitchApi<{ data?: HelixStream[] }>(`/streams?user_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`);
    const stream = payload.data?.[0];
    return {
      isLive: Boolean(stream),
      viewerCount: Math.max(0, Number(stream?.viewer_count ?? 0)),
      source: 'twitch_helix_rollback',
      title: stream?.title ?? null,
      category: stream?.game_name ?? null,
      updatedAt: new Date().toISOString()
    };
  } catch {
    const cached = await loadCachedStreamState();
    if (cached) return { ...cached, source: 'cache' };
    return { isLive: false, viewerCount: 0, source: 'fallback_offline', title: null, category: null, updatedAt: null };
  }
}

export type PublicStreamPanel = {
  broadcaster: {
    id: string;
    login: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  stream: {
    isLive: boolean;
    viewerCount: number;
    title: string | null;
    category: string | null;
    startedAt: string | null;
    source: StreamStateSource;
  };
  nextStream: {
    id: string;
    title: string | null;
    startTime: string;
    endTime: string | null;
    category: string | null;
  } | null;
};

export async function getPublicStreamPanel(): Promise<PublicStreamPanel> {
  const streamState = await getCurrentStreamState();
  const fallback: PublicStreamPanel = {
    broadcaster: {
      id: config.TWITCH_BROADCASTER_ID,
      login: null,
      displayName: null,
      avatarUrl: null
    },
    stream: {
      isLive: streamState.isLive,
      viewerCount: streamState.viewerCount,
      title: streamState.title ?? null,
      category: streamState.category ?? null,
      startedAt: null,
      source: streamState.source
    },
    nextStream: null
  };

  if (config.ERWIN_GATEWAY_ENABLED || config.ERWIN_GATEWAY_REQUIRED) {
    try {
      const client = createErwinGatewayClient();
      if (!client) return fallback;
      const channelsResult = await client.getChannels();
      const channel = normalizeGatewayChannel(channelsResult.channels ?? []);
      const channelId = stringValue(channel?.id) ?? stringValue(channel?.channelId) ?? stringValue(channel?.channel_id) ?? config.TWITCH_BROADCASTER_ID;
      const [profile, schedule] = await Promise.all([
        client.getChannelProfile(channelId).catch(() => null),
        client.getChannelSchedule(channelId).catch(() => null)
      ]);
      const normalizedProfile = normalizeGatewayProfile(profile, channel);
      const cached = await loadCachedStreamState();
      return {
        broadcaster: normalizedProfile,
        stream: {
          isLive: streamState.isLive,
          viewerCount: streamState.viewerCount,
          title: streamState.title ?? cached?.title ?? null,
          category: streamState.category ?? cached?.category ?? null,
          startedAt: cached?.startedAt ?? null,
          source: streamState.source
        },
        nextStream: normalizeGatewaySchedule(schedule)
      };
    } catch {
      return fallback;
    }
  }

  try {
    const [usersPayload, streamsPayload, schedulePayload] = await Promise.all([
      twitchApi<{ data?: HelixUser[] }>(`/users?id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`),
      twitchApi<{ data?: HelixStream[] }>(`/streams?user_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`),
      twitchApi<{ data?: { segments?: HelixScheduleSegment[] } }>(`/schedule?broadcaster_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}&first=1&start_time=${encodeURIComponent(new Date().toISOString())}`).catch(() => null)
    ]);

    const broadcaster = usersPayload.data?.[0];
    const stream = streamsPayload.data?.[0];
    const nextSegment = schedulePayload?.data?.segments?.find((segment) => !segment.canceled_until) ?? null;

    return {
      broadcaster: {
        id: broadcaster?.id ?? config.TWITCH_BROADCASTER_ID,
        login: broadcaster?.login ?? null,
        displayName: broadcaster?.display_name ?? null,
        avatarUrl: broadcaster?.profile_image_url ?? null
      },
      stream: {
        isLive: Boolean(stream) || fallback.stream.isLive,
        viewerCount: Math.max(0, Number(stream?.viewer_count ?? 0)),
        title: stream?.title ?? fallback.stream.title,
        category: stream?.game_name ?? fallback.stream.category,
        startedAt: stream?.started_at ?? null,
        source: stream ? 'twitch_helix_rollback' : fallback.stream.source
      },
      nextStream: nextSegment
        ? {
            id: nextSegment.id,
            title: nextSegment.title ?? null,
            startTime: nextSegment.start_time,
            endTime: nextSegment.end_time ?? null,
            category: nextSegment.category?.name ?? null
          }
        : null
    };
  } catch {
    return fallback;
  }
}

export function computeIncubationMultiplier(input: { isLive: boolean; viewerCount: number }): number {
  if (!input.isLive) return Math.max(0.1, config.INCUBATION_OFFLINE_MULTIPLIER);
  const liveMultiplier = config.INCUBATION_LIVE_BASE_MULTIPLIER + (Math.max(0, input.viewerCount) * config.INCUBATION_VIEWER_MULTIPLIER_PER_VIEWER);
  return Math.min(config.INCUBATION_MAX_MULTIPLIER, liveMultiplier);
}
