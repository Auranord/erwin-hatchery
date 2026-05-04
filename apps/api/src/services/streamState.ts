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

export function setManualStreamStateOverride(next: LiveOverride): void {
  manualOverride = next;
}

export function getManualStreamStateOverride(): LiveOverride {
  return manualOverride;
}

export async function getCurrentStreamState(): Promise<{ isLive: boolean; viewerCount: number; source: 'manual_override' | 'twitch_helix' | 'fallback_offline' }> {
  if (manualOverride) {
    return { isLive: manualOverride === 'live', viewerCount: 0, source: 'manual_override' };
  }

  try {
    const token = await getAppAccessToken();
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(config.TWITCH_BROADCASTER_ID)}`, {
      headers: { 'Client-Id': config.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Twitch streams response ${response.status}`);
    const payload = await response.json() as { data?: Array<{ viewer_count?: number }> };
    const stream = payload.data?.[0];
    return { isLive: Boolean(stream), viewerCount: Math.max(0, Number(stream?.viewer_count ?? 0)), source: 'twitch_helix' };
  } catch {
    return { isLive: false, viewerCount: 0, source: 'fallback_offline' };
  }
}

export function computeIncubationMultiplier(input: { isLive: boolean; viewerCount: number }): number {
  if (!input.isLive) return Math.max(0.1, config.INCUBATION_OFFLINE_MULTIPLIER);
  const liveMultiplier = config.INCUBATION_LIVE_BASE_MULTIPLIER + (Math.max(0, input.viewerCount) * config.INCUBATION_VIEWER_MULTIPLIER_PER_VIEWER);
  return Math.max(0.1, Math.min(config.INCUBATION_MAX_MULTIPLIER, liveMultiplier));
}
