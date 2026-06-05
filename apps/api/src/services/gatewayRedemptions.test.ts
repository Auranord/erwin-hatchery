import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeGatewayRedemptionPayload,
  processGatewayRedemptionObserveOnly,
  type GatewayRedemptionStore,
  type GatewayRewardMapping,
  type NormalizedGatewayRedemption
} from './gatewayRedemptions.js';

function redemption(overrides: Partial<NormalizedGatewayRedemption> = {}): NormalizedGatewayRedemption {
  return {
    gatewayDeliveryId: 'delivery-1',
    gatewayEventId: 'event-1',
    eventType: 'twitch.channel_points.custom_reward_redemption.add',
    twitchRedemptionId: 'redemption-1',
    twitchRewardId: 'twitch-reward-1',
    gatewayRewardId: 'gateway-reward-1',
    rewardTitle: 'Runtime Reward',
    rewardCost: 1000,
    rewardPrompt: 'Ei!',
    twitchUserId: 'twitch-user-1',
    twitchUserLogin: 'viewer',
    twitchUserDisplayName: 'Viewer',
    status: 'UNFULFILLED',
    userInput: 'hello',
    rawPayload: {},
    ...overrides
  };
}

function memoryStore(mapping: GatewayRewardMapping | null = {
  id: 'mapping-1',
  localRewardType: 'runtime_reward_type',
  displayName: 'Runtime Reward',
  gatewayRewardId: 'gateway-reward-1',
  twitchRewardId: 'twitch-reward-1',
  isActive: true
}): GatewayRedemptionStore & {
  users: string[];
  redemptions: NormalizedGatewayRedemption[];
  fulfillCalls: Array<{ redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping }>;
  cancelCalls: Array<{ redemption: NormalizedGatewayRedemption; mapping: GatewayRewardMapping | null; reason: string }>;
} {
  return {
    observeOnly: true,
    users: [],
    redemptions: [],
    fulfillCalls: [],
    cancelCalls: [],
    async findRewardMapping() {
      return mapping;
    },
    async upsertProvisionalUser(input) {
      this.users.push(input.twitchUserId);
      return { userId: `user-${input.twitchUserId}`, createdOrUpdated: true };
    },
    async upsertChannelPointRedemption(input) {
      this.redemptions.push(input.redemption);
    },
    async fulfillRedemption(input) {
      this.fulfillCalls.push(input);
    },
    async cancelRedemption(input) {
      this.cancelCalls.push(input);
    }
  };
}

test('normalizes redemption add payload from gateway shape', () => {
  const normalized = normalizeGatewayRedemptionPayload({
    deliveryId: 'delivery-1',
    eventId: 'event-1',
    eventType: 'twitch.channel_points.custom_reward_redemption.add',
    payload: {
      event_id: 'event-1',
      type: 'twitch.channel_points.custom_reward_redemption.add',
      redemption: { id: 'redemption-1', status: 'UNFULFILLED', user_input: 'hi' },
      reward: { id: 'gateway-reward-1', twitch_reward_id: 'twitch-reward-1', title: 'Runtime Reward', cost: 1000, prompt: 'prompt' },
      user: { id: 'user-1', login: 'viewer', display_name: 'Viewer' }
    }
  });

  assert.equal(normalized?.twitchRedemptionId, 'redemption-1');
  assert.equal(normalized?.twitchRewardId, 'twitch-reward-1');
  assert.equal(normalized?.gatewayRewardId, 'gateway-reward-1');
  assert.equal(normalized?.twitchUserId, 'user-1');
});

test('keeps raw Twitch event reward id compatibility', () => {
  const normalized = normalizeGatewayRedemptionPayload({
    deliveryId: 'delivery-1',
    eventId: 'event-1',
    eventType: 'twitch.channel_points.custom_reward_redemption.add',
    payload: {
      event: {
        id: 'redemption-1',
        reward_id: 'twitch-reward-1',
        reward_title: 'Runtime Reward',
        reward_cost: 1000,
        user_id: 'user-1'
      }
    }
  });

  assert.equal(normalized?.twitchRedemptionId, 'redemption-1');
  assert.equal(normalized?.twitchRewardId, 'twitch-reward-1');
  assert.equal(normalized?.gatewayRewardId, null);
});

test('redemption add creates or updates provisional user and stores redemption', async () => {
  const store = memoryStore();
  await processGatewayRedemptionObserveOnly(redemption(), store);

  assert.deepEqual(store.users, ['twitch-user-1']);
  assert.equal(store.redemptions.length, 1);
});

test('observe-only redemption does not call gateway fulfill/cancel', async () => {
  const store = memoryStore();
  await processGatewayRedemptionObserveOnly(redemption(), store);

  assert.equal(store.fulfillCalls.length, 0);
  assert.equal(store.cancelCalls.length, 0);
});

test('unknown reward is ignored safely and stored for diagnostics', async () => {
  const store = memoryStore(null);
  const result = await processGatewayRedemptionObserveOnly(redemption({ gatewayRewardId: 'unknown' }), store);

  assert.equal(result.processed, true);
  assert.equal('mappingStatus' in result && result.mappingStatus, 'unknown');
  assert.equal(store.redemptions.length, 1);
});

test('redemption update updates stored status/cache without economy effects', async () => {
  const store = memoryStore();
  const result = await processGatewayRedemptionObserveOnly(
    redemption({ eventType: 'twitch.channel_points.custom_reward_redemption.update', status: 'FULFILLED' }),
    store
  );

  assert.equal(result.processed, true);
  assert.equal(store.redemptions[0]?.status, 'FULFILLED');
  assert.equal(store.fulfillCalls.length, 0);
  assert.equal(store.cancelCalls.length, 0);
});

test('active grant passes mapping to fulfillment for gateway reward id fallback', async () => {
  const store = memoryStore();
  store.observeOnly = false;
  store.processMappedRedemption = async () => ({ status: 'granted' });

  const result = await processGatewayRedemptionObserveOnly(redemption({ gatewayRewardId: null }), store);

  assert.equal(result.processed, true);
  assert.equal(store.fulfillCalls.length, 1);
  assert.equal(store.fulfillCalls[0]?.redemption.gatewayRewardId, null);
  assert.equal(store.fulfillCalls[0]?.mapping.gatewayRewardId, 'gateway-reward-1');
});

test('mapped cancellation passes mapping to cancel for gateway reward id fallback', async () => {
  const store = memoryStore();
  store.observeOnly = false;
  store.processMappedRedemption = async () => ({ status: 'canceled', reason: 'test cancellation' });

  const result = await processGatewayRedemptionObserveOnly(redemption({ gatewayRewardId: null }), store);

  assert.equal(result.processed, true);
  assert.equal(result.ignored, true);
  assert.equal(store.cancelCalls.length, 1);
  assert.equal(store.cancelCalls[0]?.redemption.gatewayRewardId, null);
  assert.equal(store.cancelCalls[0]?.mapping?.gatewayRewardId, 'gateway-reward-1');
  assert.equal(store.cancelCalls[0]?.reason, 'test cancellation');
});
