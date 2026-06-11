import { config } from '../config.js';

export type GatewayErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504;

export class ErwinGatewayError extends Error {
  public readonly status: GatewayErrorStatus | number;
  public readonly retryable: boolean;
  public readonly responseBody: string | null;
  public readonly code: string | null;
  public readonly details: unknown;
  public readonly twitchStatus: number | null;
  public readonly twitchErrorExcerpt: string | null;
  public readonly issues: unknown;

  constructor(input: {
    status: number;
    message: string;
    retryable: boolean;
    responseBody: string | null;
    code?: string | null;
    details?: unknown;
    twitchStatus?: number | null;
    twitchErrorExcerpt?: string | null;
    issues?: unknown;
  }) {
    super(input.message);
    this.name = 'ErwinGatewayError';
    this.status = input.status;
    this.retryable = input.retryable;
    this.responseBody = input.responseBody;
    this.code = input.code ?? null;
    this.details = input.details;
    this.twitchStatus = input.twitchStatus ?? null;
    this.twitchErrorExcerpt = input.twitchErrorExcerpt ?? null;
    this.issues = input.issues;
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
export type GatewayChannel = Record<string, unknown>;
export type GatewayChannels = { channels?: GatewayChannel[]; data?: GatewayChannel[] };
export type GatewayChannelProfile = Record<string, unknown>;
export type GatewayChannelSchedule = Record<string, unknown>;

export type GatewayChannelPointReward = {
  id: string;
  twitch_reward_id?: string | null;
  twitchRewardId?: string | null;
  title?: string | null;
  display_name?: string | null;
  cost?: number | null;
  prompt?: string | null;
  background_color?: string | null;
  is_global_cooldown_enabled?: boolean | null;
  global_cooldown_seconds?: number | null;
  is_max_per_stream_enabled?: boolean | null;
  max_per_stream?: number | null;
  is_max_per_user_per_stream_enabled?: boolean | null;
  max_per_user_per_stream?: number | null;
  enabled?: boolean;
  is_enabled?: boolean;
  manageable?: boolean;
  owningAppId?: string | null;
  owning_app_id?: string | null;
  appOwnershipKey?: string | null;
  app_ownership_key?: string | null;
  ownershipStatus?: 'unowned' | 'owned_by_you' | 'owned_by_other' | string | null;
  ownership_status?: 'unowned' | 'owned_by_you' | 'owned_by_other' | string | null;
  canAdopt?: boolean;
  can_adopt?: boolean;
  canMutate?: boolean;
  can_mutate?: boolean;
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

export type GatewayRedemptionList = { redemptions: GatewayChannelPointRedemption[]; pagination?: Record<string, unknown>; diagnostics?: Record<string, unknown> };

export type GatewayListRedemptionsParams = { rewardId?: string; status?: string; limit?: number; after?: string };
export type GatewayListRewardRedemptionsParams = Omit<GatewayListRedemptionsParams, 'rewardId'>;

export type GatewayChatMessagePayload = {
  message: string;
  channelId?: string;
  replyParentMessageId?: string;
  idempotencyKey?: string;
};
export type GatewayChatMessageResult = { status?: string; message?: Record<string, unknown>; data?: Record<string, unknown> } & Record<string, unknown>;

export type GatewayWebhookDelivery = Record<string, unknown>;
export type GatewayWebhookDeliveryList = { deliveries: GatewayWebhookDelivery[]; pagination?: Record<string, unknown>; diagnostics?: Record<string, unknown> };
export type GatewayListWebhookDeliveriesParams = { status?: string; eventType?: string; limit?: number; after?: string };
export type GatewayWebhookDeliveryRetryResult = { status?: string; delivery?: GatewayWebhookDelivery; queued?: boolean; retried?: boolean } & Record<string, unknown>;

export type GatewaySubscriptionList = { subscriptions: Record<string, unknown>[]; pagination?: Record<string, unknown>; diagnostics?: Record<string, unknown> };
export type GatewayBackfillRunResult = { status?: string; runId?: string; started?: boolean; completed?: boolean; diagnostics?: Record<string, unknown> } & Record<string, unknown>;
export type GatewayBitsLeaderboard = { entries?: Record<string, unknown>[]; data?: Record<string, unknown>[]; leaderboard?: Record<string, unknown>[]; diagnostics?: Record<string, unknown> };

export type GatewayRewardMutationPayload = Record<string, unknown>;

export type GatewayRewardAdoptionPayload = {
  app_ownership_key: string;
  expected_twitch_reward_id?: string;
  local_reward_type: string;
};

type GatewayErrorBody = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
  details?: unknown;
  twitchStatus?: unknown;
  twitchErrorExcerpt?: unknown;
  issues?: unknown;
};

function parseGatewayErrorBody(responseBody: string | null): GatewayErrorBody | null {
  if (!responseBody) return null;
  try {
    const parsed = JSON.parse(responseBody) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as GatewayErrorBody) : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function appendGatewayListParams(searchParams: URLSearchParams, params: { status?: string; limit?: number; after?: string; eventType?: string }): void {
  if (params.status) searchParams.set('status', params.status);
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.after) searchParams.set('after', params.after);
  if (params.eventType) searchParams.set('eventType', params.eventType);
}


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

  async getChannels(): Promise<{ channels: GatewayChannel[] }> {
    const result = await this.request<GatewayChannels>('/api/v1/channels');
    return { channels: result.channels ?? result.data ?? [] };
  }

  async getChannelProfile(channelId: string): Promise<GatewayChannelProfile> {
    return this.request<GatewayChannelProfile>(`/api/v1/channels/${encodeURIComponent(channelId)}/profile`);
  }

  async getChannelSchedule(channelId: string): Promise<GatewayChannelSchedule> {
    return this.request<GatewayChannelSchedule>(`/api/v1/channels/${encodeURIComponent(channelId)}/schedule`);
  }

  async listRewards(): Promise<GatewayRewardList> {
    return this.request<GatewayRewardList>('/api/v1/channel-points/rewards');
  }

  async syncRewards(): Promise<GatewayRewardSync> {
    return this.request<GatewayRewardSync>('/api/v1/channel-points/rewards/sync', { method: 'POST' });
  }

  async createReward(payload: GatewayRewardMutationPayload): Promise<GatewayChannelPointReward> {
    const result = await this.request<{ reward?: GatewayChannelPointReward; rewards?: GatewayChannelPointReward[] } | GatewayChannelPointReward>(
      '/api/v1/channel-points/rewards',
      { method: 'POST', body: JSON.stringify(payload) }
    );
    if ('id' in result) return result;
    const reward = result.reward ?? result.rewards?.[0];
    if (!reward) throw new Error('erwin-gateway create reward response did not include a reward');
    return reward;
  }

  async adoptReward(rewardId: string, payload: GatewayRewardAdoptionPayload): Promise<GatewayChannelPointReward> {
    const result = await this.request<{ reward?: GatewayChannelPointReward } | GatewayChannelPointReward>(
      `/api/v1/channel-points/rewards/${encodeURIComponent(rewardId)}/adopt`,
      { method: 'POST', body: JSON.stringify(payload) }
    );
    if ('id' in result) return result;
    if (!result.reward) throw new Error('erwin-gateway adopt reward response did not include a reward');
    return result.reward;
  }

  async updateReward(rewardId: string, payload: GatewayRewardMutationPayload): Promise<GatewayChannelPointReward> {
    const result = await this.request<{ reward?: GatewayChannelPointReward; rewards?: GatewayChannelPointReward[] } | GatewayChannelPointReward>(
      `/api/v1/channel-points/rewards/${encodeURIComponent(rewardId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    );
    if ('id' in result) return result;
    const reward = result.reward ?? result.rewards?.[0];
    if (!reward) throw new Error('erwin-gateway update reward response did not include a reward');
    return reward;
  }

  async deleteReward(rewardId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/v1/channel-points/rewards/${encodeURIComponent(rewardId)}`, { method: 'DELETE' });
  }

  async releaseReward(rewardId: string): Promise<GatewayChannelPointReward | Record<string, unknown>> {
    const result = await this.request<{ reward?: GatewayChannelPointReward } | GatewayChannelPointReward | Record<string, unknown>>(
      `/api/v1/channel-points/rewards/${encodeURIComponent(rewardId)}/release`,
      { method: 'POST' }
    );
    if ('id' in result) return result as GatewayChannelPointReward;
    const wrapped = result as { reward?: GatewayChannelPointReward };
    if (wrapped.reward) return wrapped.reward;
    return result;
  }

  async listSubscriptions(): Promise<GatewaySubscriptionList> {
    return this.request<GatewaySubscriptionList>('/api/v1/subscriptions');
  }

  async runSubscriptionBackfill(): Promise<GatewayBackfillRunResult> {
    return this.request<GatewayBackfillRunResult>('/api/v1/subscriptions/backfill', { method: 'POST' });
  }

  async getBitsLeaderboard(): Promise<GatewayBitsLeaderboard> {
    return this.request<GatewayBitsLeaderboard>('/api/v1/bits/leaderboard');
  }

  async runBitsBackfill(): Promise<GatewayBackfillRunResult> {
    return this.request<GatewayBackfillRunResult>('/api/v1/bits/backfill', { method: 'POST' });
  }

  async updateRedemptionStatus(input: { rewardId: string; redemptionId: string; status: 'FULFILLED' | 'CANCELED'; reason: string }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/v1/channel-points/rewards/${encodeURIComponent(input.rewardId)}/redemptions/${encodeURIComponent(input.redemptionId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: input.status, reason: input.reason.slice(0, 500) }) }
    );
  }

  async listRedemptions(params: GatewayListRedemptionsParams = {}): Promise<GatewayRedemptionList> {
    const searchParams = new URLSearchParams();
    if (params.rewardId) searchParams.set('rewardId', params.rewardId);
    appendGatewayListParams(searchParams, params);
    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
    return this.request<GatewayRedemptionList>(`/api/v1/channel-points/redemptions${suffix}`);
  }

  async listRewardRedemptions(rewardId: string, params: GatewayListRewardRedemptionsParams = {}): Promise<GatewayRedemptionList> {
    const searchParams = new URLSearchParams();
    appendGatewayListParams(searchParams, params);
    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
    return this.request<GatewayRedemptionList>(`/api/v1/channel-points/rewards/${encodeURIComponent(rewardId)}/redemptions${suffix}`);
  }

  async sendChatMessage(payload: GatewayChatMessagePayload): Promise<GatewayChatMessageResult> {
    return this.request<GatewayChatMessageResult>('/api/v1/chat/messages', { method: 'POST', body: JSON.stringify(payload) });
  }

  async listWebhookDeliveries(params: GatewayListWebhookDeliveriesParams = {}): Promise<GatewayWebhookDeliveryList> {
    const searchParams = new URLSearchParams();
    appendGatewayListParams(searchParams, params);
    const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : '';
    return this.request<GatewayWebhookDeliveryList>(`/api/v1/webhook-deliveries${suffix}`);
  }

  async retryWebhookDelivery(deliveryId: string): Promise<GatewayWebhookDeliveryRetryResult> {
    return this.request<GatewayWebhookDeliveryRetryResult>(`/api/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}/retry`, { method: 'POST' });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => null);
      const safeResponseBody = responseBody ? responseBody.slice(0, 1000) : null;
      const parsed = parseGatewayErrorBody(safeResponseBody);
      const errorText = stringField(parsed?.error) ?? stringField(parsed?.message);
      const code = stringField(parsed?.code);
      const twitchStatus = numberField(parsed?.twitchStatus);
      const twitchErrorExcerpt = stringField(parsed?.twitchErrorExcerpt);
      throw new ErwinGatewayError({
        status: response.status,
        message: [
          `erwin-gateway request failed with HTTP ${response.status}`,
          code ? `code=${code}` : null,
          errorText ? `error=${errorText.slice(0, 200)}` : null
        ].filter(Boolean).join(' '),
        retryable: response.status === 429 || response.status >= 500,
        responseBody: safeResponseBody,
        code,
        details: parsed?.details,
        twitchStatus,
        twitchErrorExcerpt,
        issues: parsed?.issues
      });
    }

    if (response.status === 204) {
      return {} as T;
    }

    const responseText = await response.text();
    if (responseText.trim() === '') {
      return {} as T;
    }

    return JSON.parse(responseText) as T;
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
