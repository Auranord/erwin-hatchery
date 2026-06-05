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

const { ErwinGatewayClient, ErwinGatewayError } = await import('./erwinGatewayClient.js');

test('gateway client sends Authorization header', async () => {
  let authorization: string | null = null;
  const client = new ErwinGatewayClient({
    baseUrl: 'https://gateway.example.test',
    apiKey: 'secret-api-key',
    fetchImpl: async (_url: URL | RequestInfo, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization');
      return Response.json({ app: { id: 'app-id', slug: 'erwin-hatchery', enabled: true, permissions: [] } });
    }
  });

  await client.me();
  assert.equal(authorization, 'Bearer secret-api-key');
});

for (const status of [401, 403, 404, 409, 429, 500, 502, 503, 504] as const) {
  test(`gateway client handles HTTP ${status}`, async () => {
    const client = new ErwinGatewayClient({
      baseUrl: 'https://gateway.example.test',
      apiKey: 'secret-api-key',
      fetchImpl: async () => new Response(JSON.stringify({ message: 'failed' }), { status })
    });

    await assert.rejects(
      () => client.getCurrentStream(),
      (error: unknown) => {
        assert.ok(error instanceof ErwinGatewayError);
        const gatewayError = error as InstanceType<typeof ErwinGatewayError>;
        assert.equal(gatewayError.status, status);
        assert.equal(gatewayError.retryable, status === 429 || status >= 500);
        assert.match(gatewayError.message, new RegExp(String(status)));
        assert.doesNotMatch(gatewayError.message, /secret-api-key/);
        return true;
      }
    );
  });
}


test('gateway client exposes Channel Point reward and redemption helpers', async () => {
  const calls: string[] = [];
  const client = new ErwinGatewayClient({
    baseUrl: 'https://gateway.example.test',
    apiKey: 'secret-api-key',
    fetchImpl: async (url: URL | RequestInfo) => {
      calls.push(String(url));
      return Response.json({ rewards: [], redemptions: [] });
    }
  });

  await client.listRewards();
  await client.syncRewards();
  await client.listRedemptions({ status: 'UNFULFILLED', limit: 10 });

  assert.equal(calls[0], 'https://gateway.example.test/api/v1/channel-points/rewards');
  assert.equal(calls[1], 'https://gateway.example.test/api/v1/channel-points/rewards/sync');
  assert.equal(calls[2], 'https://gateway.example.test/api/v1/channel-points/redemptions?status=UNFULFILLED&limit=10');
});
