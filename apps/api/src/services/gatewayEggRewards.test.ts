import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test';
process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? 'test-client';
process.env.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? 'test-secret';
process.env.TWITCH_BROADCASTER_ID = process.env.TWITCH_BROADCASTER_ID ?? '123';
process.env.TWITCH_EVENTSUB_SECRET = process.env.TWITCH_EVENTSUB_SECRET ?? 'eventsub-secret';
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'x'.repeat(32);
process.env.ERWIN_GATEWAY_ENABLED = 'false';

const {
  appOwnershipKeyForEggType,
  gatewayLocalRewardTypeForEggType,
  gatewayRewardPlanForEggType,
  localRewardTypeForEggType
} = await import('./gatewayEggRewards.js');

test('beta egg uses first-class Hatchery adoption identity', () => {
  assert.equal(appOwnershipKeyForEggType('beta_egg'), 'hatchery:basic_mystery_egg');
  assert.equal(gatewayLocalRewardTypeForEggType('beta_egg'), 'basic_mystery_egg');
  assert.equal(localRewardTypeForEggType('beta_egg'), 'egg_type:beta_egg');
});

test('egg reward plan carries ownership metadata for gateway adoption', () => {
  const plan = gatewayRewardPlanForEggType({
    id: 'beta_egg',
    displayName: 'Beta Ei',
    twitchRewardId: null,
    twitchRewardTitle: null,
    twitchRewardPrompt: null,
    twitchRewardCost: null,
    twitchRewardBackgroundColor: null,
    twitchRewardGlobalCooldownMinutes: null,
    twitchRewardMaxPerStream: null,
    twitchRewardMaxPerUserPerStream: 1,
    isActive: true
  });

  assert.equal(plan.metadata.appOwnershipKey, 'hatchery:basic_mystery_egg');
  assert.equal(plan.metadata.gatewayLocalRewardType, 'basic_mystery_egg');
  assert.equal(plan.localRewardType, 'egg_type:beta_egg');
});
