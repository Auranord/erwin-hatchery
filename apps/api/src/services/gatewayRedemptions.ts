export const GATEWAY_REDEMPTION_EVENT_TYPES = [
  'twitch.channel_points.custom_reward_redemption.add',
  'twitch.channel_points.custom_reward_redemption.update'
] as const;

export type GatewayRedemptionEventType = (typeof GATEWAY_REDEMPTION_EVENT_TYPES)[number];

export type GatewayRewardMapping = {
  id: string;
  localRewardType: string;
  displayName: string;
  gatewayRewardId: string;
  twitchRewardId: string;
  isActive: boolean;
};

export type NormalizedGatewayRedemption = {
  gatewayDeliveryId: string;
  gatewayEventId: string;
  eventType: GatewayRedemptionEventType;
  twitchRedemptionId: string;
  twitchRewardId: string;
  gatewayRewardId: string | null;
  rewardTitle: string | null;
  rewardCost: number;
  rewardPrompt: string | null;
  twitchUserId: string | null;
  twitchUserLogin: string | null;
  twitchUserDisplayName: string | null;
  status: string;
  userInput: string | null;
  rawPayload: Record<string, unknown>;
};

export type GatewayRedemptionProcessingResult =
  | { processed: true; ignored: false; mappingStatus: 'mapped' | 'unknown'; userCreatedOrUpdated: boolean }
  | { processed: true; ignored: true; reason: string };

export type GatewayMappedRedemptionResult = { status: 'granted' | 'already_granted' | 'canceled'; reason?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return null;
}

function nested(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return null;
}

function get(record: Record<string, unknown> | null, key: string): unknown {
  return record?.[key];
}

export function isGatewayRedemptionEventType(eventType: string): eventType is GatewayRedemptionEventType {
  return GATEWAY_REDEMPTION_EVENT_TYPES.includes(eventType as GatewayRedemptionEventType);
}

export function normalizeGatewayRedemptionPayload(input: {
  deliveryId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): NormalizedGatewayRedemption | null {
  if (!isGatewayRedemptionEventType(input.eventType)) return null;

  const data = nested(input.payload.data);
  const event = nested(get(data, 'event'), input.payload.event, data);
  const redemption = nested(input.payload.redemption, get(data, 'redemption'), event);
  const reward = nested(input.payload.reward, get(data, 'reward'), get(event, 'reward'));
  const user = nested(input.payload.user, get(data, 'user'), get(event, 'user'));
  const twitch = nested(input.payload.twitch, get(data, 'twitch'));

  const twitchRedemptionId =
    stringValue(get(redemption, 'id')) ??
    stringValue(get(event, 'id')) ??
    stringValue(get(data, 'redemption_id')) ??
    stringValue(get(input.payload, 'redemption_id'));

  const rewardTwitchRewardId = stringValue(get(reward, 'twitch_reward_id')) ?? stringValue(get(reward, 'twitchRewardId'));
  const rawRewardId = stringValue(get(reward, 'id'));
  const eventRewardId = stringValue(get(event, 'reward_id'));
  const dataRewardId = stringValue(get(data, 'reward_id'));
  const payloadRewardId = stringValue(get(input.payload, 'reward_id'));

  const twitchRewardId =
    rewardTwitchRewardId ??
    eventRewardId ??
    dataRewardId ??
    payloadRewardId ??
    rawRewardId;

  if (!twitchRedemptionId || !twitchRewardId) return null;

  const gatewayRewardId =
    stringValue(get(reward, 'gateway_reward_id')) ??
    stringValue(get(reward, 'gatewayRewardId')) ??
    stringValue(get(data, 'gateway_reward_id')) ??
    stringValue(get(input.payload, 'gateway_reward_id')) ??
    (rewardTwitchRewardId ? rawRewardId : null);

  const twitchUserId =
    stringValue(get(user, 'id')) ??
    stringValue(get(user, 'user_id')) ??
    stringValue(get(event, 'user_id')) ??
    stringValue(get(data, 'user_id')) ??
    stringValue(get(twitch, 'user_id'));

  const twitchUserLogin =
    stringValue(get(user, 'login')) ??
    stringValue(get(user, 'user_login')) ??
    stringValue(get(event, 'user_login')) ??
    stringValue(get(data, 'user_login'));

  const twitchUserDisplayName =
    stringValue(get(user, 'display_name')) ??
    stringValue(get(user, 'user_name')) ??
    stringValue(get(event, 'user_name')) ??
    stringValue(get(data, 'user_name'));

  return {
    gatewayDeliveryId: input.deliveryId,
    gatewayEventId: input.eventId,
    eventType: input.eventType,
    twitchRedemptionId,
    twitchRewardId,
    gatewayRewardId,
    rewardTitle: stringValue(get(reward, 'title')) ?? stringValue(get(event, 'reward_title')) ?? stringValue(get(data, 'reward_title')),
    rewardCost: numberValue(get(reward, 'cost')) ?? numberValue(get(event, 'reward_cost')) ?? numberValue(get(data, 'reward_cost')) ?? 0,
    rewardPrompt: stringValue(get(reward, 'prompt')) ?? stringValue(get(event, 'reward_prompt')) ?? stringValue(get(data, 'reward_prompt')),
    twitchUserId,
    twitchUserLogin,
    twitchUserDisplayName,
    status: stringValue(get(redemption, 'status')) ?? stringValue(get(event, 'status')) ?? stringValue(get(data, 'status')) ?? 'UNKNOWN',
    userInput: stringValue(get(redemption, 'user_input')) ?? stringValue(get(event, 'user_input')) ?? stringValue(get(data, 'user_input')),
    rawPayload: input.payload
  };
}

export type GatewayRedemptionStore = {
  findRewardMapping(redemption: NormalizedGatewayRedemption): Promise<GatewayRewardMapping | null>;
  upsertProvisionalUser(input: {
    twitchUserId: string;
    twitchLogin: string | null;
    displayName: string | null;
  }): Promise<{ userId: string; createdOrUpdated: boolean }>;
  upsertChannelPointRedemption(input: {
    redemption: NormalizedGatewayRedemption;
    userId: string | null;
    mapping: GatewayRewardMapping | null;
    mappingStatus: 'mapped' | 'unknown';
  }): Promise<void>;
  observeOnly: boolean;
  processMappedRedemption?(input: { redemption: NormalizedGatewayRedemption; userId: string | null; mapping: GatewayRewardMapping }): Promise<GatewayMappedRedemptionResult>;
  fulfillRedemption?(input: { redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping }): Promise<void>;
  cancelRedemption?(input: { redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping | null; reason: string }): Promise<void>;
};

export async function processGatewayRedemptionObserveOnly(
  redemption: NormalizedGatewayRedemption,
  store: GatewayRedemptionStore
): Promise<GatewayRedemptionProcessingResult> {
  const mapping = await store.findRewardMapping(redemption);
  const mappingStatus = mapping ? 'mapped' : 'unknown';

  let userId: string | null = null;
  let userCreatedOrUpdated = false;
  if (redemption.twitchUserId) {
    const userResult = await store.upsertProvisionalUser({
      twitchUserId: redemption.twitchUserId,
      twitchLogin: redemption.twitchUserLogin,
      displayName: redemption.twitchUserDisplayName
    });
    userId = userResult.userId;
    userCreatedOrUpdated = userResult.createdOrUpdated;
  }

  await store.upsertChannelPointRedemption({ redemption, userId, mapping, mappingStatus });

  if (!store.observeOnly) {
    if (!mapping) {
      await store.cancelRedemption?.({
        redemption,
        mapping: null,
        reason: 'No active Hatchery reward mapping exists for this Channel Point reward.'
      });
      return { processed: true, ignored: true, reason: 'unknown_reward_mapping' };
    }
    if (!store.processMappedRedemption) {
      return { processed: true, ignored: true, reason: 'active_redemption_processing_not_configured' };
    }
    const mappedResult = await store.processMappedRedemption({ redemption, userId, mapping });
    if (mappedResult.status === 'already_granted') {
      return { processed: true, ignored: true, reason: mappedResult.reason ?? 'duplicate_twitch_redemption_id' };
    }
    if (mappedResult.status === 'canceled') {
      await store.cancelRedemption?.({
        redemption,
        mapping,
        reason: mappedResult.reason ?? 'Reward could not be processed.'
      });
      return { processed: true, ignored: true, reason: mappedResult.reason ?? 'mapped_redemption_canceled' };
    }
    await store.fulfillRedemption?.({ redemption, mapping });
  }

  return { processed: true, ignored: false, mappingStatus, userCreatedOrUpdated };
}
