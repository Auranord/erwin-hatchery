import { config } from '../config.js';

export type GatewayErrorStatus = 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504;

export class ErwinGatewayError extends Error {
  public readonly status: GatewayErrorStatus | number;
  public readonly retryable: boolean;
  public readonly responseBody: string | null;

  constructor(input: { status: number; message: string; retryable: boolean; responseBody: string | null }) {
    super(input.message);
    this.name = 'ErwinGatewayError';
    this.status = input.status;
    this.retryable = input.retryable;
    this.responseBody = input.responseBody;
  }
}

export type GatewayAppIdentity = {
  app: {
    id: string;
    slug: string;
    name?: string;
    enabled: boolean;
    permissions: string[];
  };
  key?: {
    id?: string;
    name?: string;
    prefix?: string;
  };
};

export type GatewayCurrentStream = {
  stream: null | Record<string, unknown>;
  channel?: Record<string, unknown>;
};

export type GatewayChannelPointReward = {
  id: string;
  twitch_reward_id?: string | null;
  twitchRewardId?: string | null;
  title?: string | null;
  display_name?: string | null;
  cost?: number | null;
  prompt?: string | null;
  enabled?: boolean;
  is_enabled?: boolean;
  metadata?: Record<string, unknown>;
};

export type GatewayRewardList = { rewards: GatewayChannelPointReward[]; diagnostics?: Record<string, unknown> };
export type GatewayRewardSync = GatewayRewardList & { synced?: boolean; syncedAt?: string };

export type GatewayChannelPointRedemption = {
  id: string;
  twitch_redemption_id?: string | null;
  twitchRedemptionId?: string | null;
  reward_id?: string | null;
  twitch_reward_id?: string | null;
  status?: string | null;
  raw?: Record<string, unknown>;
};

export type GatewayRedemptionList = { redemptions: GatewayChannelPointRedemption[] };

export type GatewayListRedemptionsParams = { rewardId?: string; status?: string; limit?: number; after?: string };

export class ErwinGatewayClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = new URL(input.baseUrl);
    this.apiKey = input.apiKey;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async me(): Promise<GatewayAppIdentity> {
    return this.request<GatewayAppIdentity>('/api/v1/me');
  }

  async getCurrentStream(): Promise<GatewayCurrentStream> {
    return this.request<GatewayCurrentStream>('/api/v1/streams/current');
  }

  async listRewards(): Promise<GatewayRewardList> {
    return this.request<GatewayRewardList>('/api/v1/channel-points/rewards');
  }

  async syncRewards(): Promise<GatewayRewardSync> {
    return this.request<GatewayRewardSync>('/api/v1/channel-points/rewards/sync', { method: 'POST' });
  }

  async listRedemptions(params: GatewayListRedemptionsParams = {}): Promise<GatewayRedemptionList> {
    const searchParams = new URLSearchParams();
    if (params.rewardId) searchParams.set('rewardId', params.rewardId);
    if (params.status) searchParams.set('status', params.status);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.after) searchParams.set('after', params.after);
    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
    return this.request<GatewayRedemptionList>(`/api/v1/channel-points/redemptions${suffix}`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => null);
      throw new ErwinGatewayError({
        status: response.status,
        message: `erwin-gateway request failed with HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
        responseBody: responseBody ? responseBody.slice(0, 500) : null
      });
    }

    return (await response.json()) as T;
  }
}

export function createErwinGatewayClient(): ErwinGatewayClient | null {
  if (!config.ERWIN_GATEWAY_ENABLED && !config.ERWIN_GATEWAY_REQUIRED) {
    return null;
  }

  if (!config.ERWIN_GATEWAY_URL || !config.ERWIN_GATEWAY_APP_API_KEY) {
    return null;
  }

  return new ErwinGatewayClient({
    baseUrl: config.ERWIN_GATEWAY_URL,
    apiKey: config.ERWIN_GATEWAY_APP_API_KEY
  });
}

export async function smokeCheckErwinGateway(): Promise<{ ok: true; enabled: boolean; required: boolean; appSlug?: string } | { ok: false; enabled: boolean; required: boolean; error: string; retryable: boolean }> {
  const client = createErwinGatewayClient();
  if (!client) {
    return { ok: true, enabled: false, required: config.ERWIN_GATEWAY_REQUIRED };
  }

  try {
    const identity = await client.me();
    return {
      ok: true,
      enabled: true,
      required: config.ERWIN_GATEWAY_REQUIRED,
      appSlug: identity.app.slug
    };
  } catch (error) {
    const gatewayError = error instanceof ErwinGatewayError ? error : null;
    return {
      ok: false,
      enabled: true,
      required: config.ERWIN_GATEWAY_REQUIRED,
      error: gatewayError ? gatewayError.message : 'erwin-gateway smoke check failed',
      retryable: gatewayError?.retryable ?? false
    };
  }
}
