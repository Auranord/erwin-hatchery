import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  handleErwinGatewayWebhook,
  signGatewayWebhook,
  type GatewayWebhookRecord,
  type GatewayWebhookStore
} from './erwinGatewayWebhook.js';

function memoryStore(): GatewayWebhookStore & { records: GatewayWebhookRecord[] } {
  const records: GatewayWebhookRecord[] = [];
  return {
    records,
    async insertEvent(record: GatewayWebhookRecord) {
      const duplicate = records.find(
        (existing) =>
          existing.deliveryId === record.deliveryId ||
          existing.eventId === record.eventId ||
          (record.twitchRedemptionId !== null && existing.twitchRedemptionId === record.twitchRedemptionId)
      );
      if (duplicate) return { inserted: false, status: duplicate.processingStatus };
      records.push(record);
      return { inserted: true };
    }
  };
}

function signedInput(payload: object, overrides: Partial<{ deliveryId: string; eventId: string; timestamp: string; secret: string }> = {}) {
  const secret = overrides.secret ?? 'webhook-secret';
  const deliveryId = overrides.deliveryId ?? 'delivery-1';
  const eventId = overrides.eventId ?? 'event-1';
  const timestamp = overrides.timestamp ?? '2026-06-04T12:00:00.000Z';
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    secret,
    deliveryId,
    headerEventId: eventId,
    timestamp,
    signature: signGatewayWebhook({ secret, deliveryId, timestamp, rawBody }),
    rawBody,
    maxAgeSeconds: 300,
    observeOnly: true,
    nowMs: Date.parse('2026-06-04T12:00:30.000Z')
  };
}

test('webhook accepts valid signature and observes without side effects', async () => {
  const store = memoryStore();
  const result = await handleErwinGatewayWebhook({
    ...signedInput({ event_id: 'event-1', type: 'twitch.channel_points.custom_reward_redemption.add', data: { redemption: { id: 'redemption-1' } } }),
    store
  });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 202);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0]?.processingStatus, 'observed');
  assert.equal(store.records[0]?.twitchRedemptionId, 'redemption-1');
});

test('webhook rejects invalid signature', async () => {
  const store = memoryStore();
  const result = await handleErwinGatewayWebhook({
    ...signedInput({ event_id: 'event-1', type: 'twitch.chat.message' }),
    signature: 'sha256=bad',
    store
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  if (!result.ok) assert.match(result.message, /Invalid/);
  assert.equal(store.records.length, 0);
});

test('webhook rejects stale timestamp', async () => {
  const store = memoryStore();
  const result = await handleErwinGatewayWebhook({
    ...signedInput(
      { event_id: 'event-1', type: 'twitch.chat.message' },
      { timestamp: '2026-06-04T11:00:00.000Z' }
    ),
    store
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 400);
  if (!result.ok) assert.match(result.message, /Stale/);
  assert.equal(store.records.length, 0);
});

test('duplicate delivery returns 2xx without duplicate processing', async () => {
  const store = memoryStore();
  const first = signedInput({ event_id: 'event-1', type: 'twitch.chat.message' });
  const second = signedInput({ event_id: 'event-2', type: 'twitch.chat.message' }, { deliveryId: 'delivery-1', eventId: 'event-2' });

  await handleErwinGatewayWebhook({ ...first, store });
  const result = await handleErwinGatewayWebhook({ ...second, store });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal('duplicate' in result && result.duplicate, true);
  assert.equal(store.records.length, 1);
});

test('duplicate event id returns 2xx without duplicate processing', async () => {
  const store = memoryStore();
  const first = signedInput({ event_id: 'event-1', type: 'twitch.chat.message' });
  const second = signedInput({ event_id: 'event-1', type: 'twitch.chat.message' }, { deliveryId: 'delivery-2' });

  await handleErwinGatewayWebhook({ ...first, store });
  const result = await handleErwinGatewayWebhook({ ...second, store });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal('duplicate' in result && result.duplicate, true);
  assert.equal(store.records.length, 1);
});


test('duplicate Twitch redemption id does not duplicate processing', async () => {
  const store = memoryStore();
  const first = signedInput({
    event_id: 'event-1',
    type: 'twitch.channel_points.custom_reward_redemption.add',
    redemption: { id: 'redemption-1' }
  });
  const second = signedInput(
    { event_id: 'event-2', type: 'twitch.channel_points.custom_reward_redemption.update', redemption: { id: 'redemption-1' } },
    { deliveryId: 'delivery-2', eventId: 'event-2' }
  );

  await handleErwinGatewayWebhook({ ...first, store });
  const result = await handleErwinGatewayWebhook({ ...second, store });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal('duplicate' in result && result.duplicate, true);
  assert.equal(store.records.length, 1);
});
