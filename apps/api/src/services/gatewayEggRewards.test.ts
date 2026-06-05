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

const { z } = await import('zod');
const { rewardPayload } = await import('./gatewayEggRewards.js');

const currentGatewayRewardSchema = z.object({
  title: z.string().min(1).max(45),
  prompt: z.string().max(200),
  cost: z.number().int().positive(),
  background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  is_enabled: z.boolean(),
  is_global_cooldown_enabled: z.boolean(),
  global_cooldown_seconds: z.number().int().positive().optional(),
  is_max_per_stream_enabled: z.boolean(),
  max_per_stream: z.number().int().positive().optional(),
  is_max_per_user_per_stream_enabled: z.boolean(),
  max_per_user_per_stream: z.number().int().positive().optional()
}).strict();

function baseRewardPlan() {
  return gatewayRewardPlanForEggType({
    id: 'beta_egg',
    displayName: 'Beta Ei',
    twitchRewardId: null,
    twitchRewardTitle: null,
    twitchRewardPrompt: null,
    twitchRewardCost: null,
    twitchRewardBackgroundColor: null,
    twitchRewardGlobalCooldownMinutes: null,
    twitchRewardMaxPerStream: null,
    twitchRewardMaxPerUserPerStream: null,
    isActive: true
  });
}

test('disabled reward limits produce no numeric limit fields', () => {
  const payload = rewardPayload(baseRewardPlan());

  assert.equal(payload.is_global_cooldown_enabled, false);
  assert.equal(payload.is_max_per_stream_enabled, false);
  assert.equal(payload.is_max_per_user_per_stream_enabled, false);
  assert.equal('global_cooldown_seconds' in payload, false);
  assert.equal('max_per_stream' in payload, false);
  assert.equal('max_per_user_per_stream' in payload, false);
  assert.equal('enabled' in payload, false);
  assert.equal('metadata' in payload, false);
});

test('enabled cooldown with a positive value includes global_cooldown_seconds', () => {
  const plan = { ...baseRewardPlan(), isGlobalCooldownEnabled: true, globalCooldownSeconds: 300 };
  const payload = rewardPayload(plan);

  assert.equal(payload.is_global_cooldown_enabled, true);
  assert.equal(payload.global_cooldown_seconds, 300);
});

test('enabled max per stream with a positive value includes max_per_stream', () => {
  const plan = { ...baseRewardPlan(), isMaxPerStreamEnabled: true, maxPerStream: 25 };
  const payload = rewardPayload(plan);

  assert.equal(payload.is_max_per_stream_enabled, true);
  assert.equal(payload.max_per_stream, 25);
});

test('enabled max per user per stream with a positive value includes max_per_user_per_stream', () => {
  const plan = { ...baseRewardPlan(), isMaxPerUserPerStreamEnabled: true, maxPerUserPerStream: 2 };
  const payload = rewardPayload(plan);

  assert.equal(payload.is_max_per_user_per_stream_enabled, true);
  assert.equal(payload.max_per_user_per_stream, 2);
});

test('generated reward payload passes the current erwin-gateway reward schema shape', () => {
  const plan = {
    ...baseRewardPlan(),
    isGlobalCooldownEnabled: true,
    globalCooldownSeconds: 180,
    isMaxPerStreamEnabled: true,
    maxPerStream: 50,
    isMaxPerUserPerStreamEnabled: true,
    maxPerUserPerStream: 3
  };

  const parsed = currentGatewayRewardSchema.safeParse(rewardPayload(plan));
  assert.equal(parsed.success, true);
});
