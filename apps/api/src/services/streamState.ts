import { config } from '../config.js';

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

type StreamStateSource = 'debug_env' | 'manual_override' | 'twitch_helix' | 'fallback_offline';

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

export async function getCurrentStreamState(): Promise<{ isLive: boolean; viewerCount: number; source: StreamStateSource }> {
  if (config.DEBUG_MODE) {
    return { isLive: true, viewerCount: 0, source: 'debug_env' };
  }

  if (manualOverride) {
    return { isLive: manualOverride === 'live', viewerCount: 0, source: 'manual_override' };
  }

  try {
    const payload = await twitchApi<{ data?: HelixStream[] }>(`/streams?user_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`);
    const stream = payload.data?.[0];
    return { isLive: Boolean(stream), viewerCount: Math.max(0, Number(stream?.viewer_count ?? 0)), source: 'twitch_helix' };
  } catch {
    return { isLive: false, viewerCount: 0, source: 'fallback_offline' };
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
  const fallback: PublicStreamPanel = {
    broadcaster: {
      id: config.TWITCH_BROADCASTER_ID,
      login: null,
      displayName: null,
      avatarUrl: null
    },
    stream: {
      isLive: config.DEBUG_MODE || manualOverride === 'live',
      viewerCount: 0,
      title: null,
      category: null,
      startedAt: null,
      source: config.DEBUG_MODE ? 'debug_env' : manualOverride ? 'manual_override' : 'fallback_offline'
    },
    nextStream: null
  };

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
        title: stream?.title ?? null,
        category: stream?.game_name ?? null,
        startedAt: stream?.started_at ?? null,
        source: stream ? 'twitch_helix' : fallback.stream.source
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
  return Math.max(0.1, Math.min(config.INCUBATION_MAX_MULTIPLIER, liveMultiplier));
}
