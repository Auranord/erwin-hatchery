# erwin-gateway Compact Implementation Reference for erwin-hatchery

Purpose: this file replaces the larger gateway-related docs inside `erwin-hatchery` for day-to-day implementation. Keep it small and focused. Use the full gateway docs only when changing gateway internals.

## Responsibility split

`erwin-gateway` owns Twitch transport:

- Twitch OAuth, token refresh, EventSub subscriptions, EventSub raw-body verification.
- Twitch bot chat receive/send.
- Channel Point reward create/update/delete/sync.
- Channel Point redemption transport and status API.
- Subscription, Bits, stream, channel profile, and schedule API access.
- Signed webhook delivery and retry/dead-letter handling.

`erwin-hatchery` owns gameplay and economy:

- Egg reward mapping.
- Provisional users and Hatchery accounts.
- Mystery egg inventory, hidden outcomes, ledger entries, incubators.
- Deciding whether a redemption is fulfilled, canceled, ignored, or retryable.
- Idempotency for gateway deliveries and Twitch redemption IDs.

Do not store broadcaster Twitch access/refresh tokens in Hatchery for gateway-owned transport.

## Required gateway state

The gateway must already be deployed and healthy:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health/deep
```

Expected: live/ready 2xx. Deep health should show healthy Twitch auth, EventSub, reward sync, and queues.

Gateway Twitch identities:

- Bot account: chat receive/send.
- Broadcaster account: Channel Points, redemptions, subscriptions, Bits, stream/profile/schedule.

Required broadcaster scopes in gateway: `channel:bot`, `channel:manage:redemptions`, `channel:read:redemptions`, `channel:read:subscriptions`, `bits:read`.

## Register the Hatchery app in gateway

App slug: `erwin-hatchery`

Webhook URL:

```text
https://<hatchery-host>/erwin-gateway/webhook
```

Permissions:

```json
[
  "chat:messages:send",
  "channel_points:rewards:read",
  "channel_points:rewards:create",
  "channel_points:rewards:update",
  "channel_points:rewards:delete",
  "channel_points:redemptions:read",
  "channel_points:redemptions:manage",
  "channel_points:events:receive",
  "subscriptions:read",
  "subscriptions:backfill",
  "bits:read",
  "bits:backfill",
  "streams:read",
  "events:receive_twitch_events",
  "logs:read_own"
]
```

Webhook filters:

```text
twitch.channel_points.custom_reward_redemption.add
twitch.channel_points.custom_reward_redemption.update
twitch.channel.subscribe
twitch.channel.subscription.end
twitch.channel.subscription.message
twitch.channel.subscription.gift
twitch.channel.cheer
twitch.stream.online
twitch.stream.offline
twitch.channel.update
```

Use the full raw app API key. It has this shape:

```text
egw_live_<keyId>_<secret>
```

The shorter `egw_live_<keyId>` prefix is only an identifier and will fail authentication.

## Hatchery environment variables

```env
ERWIN_GATEWAY_ENABLED=true
ERWIN_GATEWAY_OBSERVE_ONLY=true
ERWIN_GATEWAY_REQUIRED=false
ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=false

ERWIN_GATEWAY_URL=https://erwin-gateway.auranord.net
ERWIN_GATEWAY_APP_API_KEY=<full raw app API key>
ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET=<gateway app webhook signing secret>
ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS=300
```

Safe defaults:

- `ERWIN_GATEWAY_OBSERVE_ONLY=true`: receive and store events without granting.
- `ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=false`: grant logic may run, but Twitch fulfillment is manual/off unless enabled.
- `ERWIN_GATEWAY_REQUIRED=false`: app can start even if gateway is temporarily unavailable.

For active dev tests:

```env
ERWIN_GATEWAY_OBSERVE_ONLY=false
ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=true
```

## Gateway client requirements

Every `/api/v1/*` request uses:

```text
Authorization: Bearer <ERWIN_GATEWAY_APP_API_KEY>
Accept: application/json
Content-Type: application/json when body is present
```

Required client methods for Hatchery:

```text
GET  /api/v1/me
GET  /api/v1/streams/current
GET  /api/v1/channels
GET  /api/v1/channels/:channelId/profile
GET  /api/v1/channels/:channelId/schedule

GET  /api/v1/channel-points/rewards
POST /api/v1/channel-points/rewards/sync
POST /api/v1/channel-points/rewards
PATCH /api/v1/channel-points/rewards/:rewardId
DELETE /api/v1/channel-points/rewards/:rewardId
POST /api/v1/channel-points/rewards/:rewardId/adopt
POST /api/v1/channel-points/rewards/:rewardId/release
GET  /api/v1/channel-points/redemptions
GET  /api/v1/channel-points/rewards/:rewardId/redemptions
PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status

GET  /api/v1/subscriptions
POST /api/v1/subscriptions/backfill
GET  /api/v1/bits/leaderboard
POST /api/v1/bits/backfill
POST /api/v1/chat/messages
GET  /api/v1/webhook-deliveries
POST /api/v1/webhook-deliveries/:deliveryId/retry
```

Handle status codes:

- `401`: key missing, malformed, revoked, wrong full/prefix key.
- `403`: app lacks permission or does not own resource.
- `404`: resource not found or not visible to app.
- `409`: ownership/idempotency conflict.
- `429`: back off and retry with same idempotency key.
- `5xx`: retry with backoff where safe.

Never log API keys, webhook signing secrets, Twitch secrets, cookies, or raw Authorization headers.

## Webhook receiver

Route:

```text
POST /erwin-gateway/webhook
```

Headers:

```text
X-Erwin-Gateway-Delivery-Id
X-Erwin-Gateway-Event-Id
X-Erwin-Gateway-Timestamp
X-Erwin-Gateway-Signature
X-Erwin-Gateway-App-Id
```

Signature input:

```text
delivery_id + timestamp + raw_body
```

Verification rules:

- Verify HMAC-SHA256 with `ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET`.
- Use timing-safe comparison.
- Verify against exact raw bytes, never `JSON.stringify(parsedBody)`.
- Reject stale timestamps, default max age 300 seconds.
- Parse JSON only after signature verification.
- Return `2xx` only after durable event record or safe duplicate detection.

Dedupe table should include:

```text
delivery_id unique
event_id unique
event_type
twitch_redemption_id unique where present
twitch_message_id where present
processing_status
error
created_at
processed_at
raw_payload jsonb
```


## Subscription and Bits ingestion

Gateway-owned Twitch transport now covers these paid event webhooks:

```text
twitch.channel.subscribe
twitch.channel.subscription.end
twitch.channel.subscription.message
twitch.channel.subscription.gift
twitch.channel.cheer
```

Hatchery behavior:

- Store each delivery/event idempotently with gateway delivery ID, gateway event ID, Twitch EventSub message ID when present, Twitch user identity when present, raw payload, status, and error/reason.
- Apply only fixed Gutschein effects in active mode.
- `twitch.channel.subscribe` grants +1 Gutschein to the identifiable subscriber.
- `twitch.channel.subscription.message` grants +1 Gutschein to the identifiable resubscriber, matching the current MVP direct EventSub behavior.
- `twitch.channel.subscription.gift` preserves the MVP fixed gift behavior: identifiable gifters receive fixed Gutscheine based on the gift count, identifiable recipients receive a fixed recipient Gutschein when present, and anonymous gifters are not credited.
- `twitch.channel.subscription.end` updates local subscriber status only; it does not grant resources.
- `twitch.channel.cheer` uses the existing Bits threshold Gutschein counter. Anonymous cheers are audited without voucher credit.
- No sub/Bits path grants random eggs, random pets, mystery rewards, prize entries, giveaway chances, trading value, cash-out, or betting effects.

When `ERWIN_GATEWAY_ENABLED=true`, the old direct Twitch EventSub route acknowledges migrated sub/Bits notifications but does not mutate economy for them.

Admin diagnostics:

```text
GET /api/admin/erwin-gateway/sub-bits-diagnostics
GET /api/erwin-gateway/diagnostics
```

Gateway client methods used for paid-event operations:

```text
GET  /api/v1/subscriptions
POST /api/v1/subscriptions/backfill
GET  /api/v1/bits/leaderboard
POST /api/v1/bits/backfill
```

## Channel Point reward management

### Sync

```text
POST /api/v1/channel-points/rewards/sync
GET  /api/v1/channel-points/rewards
```

Sync is discovery. It should not silently make Hatchery owner of every reward.

### Existing rewards and adoption

Use adoption when Hatchery should manage an existing Twitch reward:

```text
POST /api/v1/channel-points/rewards/:rewardId/adopt
```

Body:

```json
{
  "app_ownership_key": "hatchery:basic_mystery_egg",
  "expected_twitch_reward_id": "<optional twitch reward id>",
  "local_reward_type": "basic_mystery_egg"
}
```

Adoption rules:

- Reward must exist.
- Reward must be manageable by the Twitch client.
- Reward must be unowned or already owned by `erwin-hatchery`.
- Rewards owned by another app return `409`.
- Non-manageable rewards can be observed/mapped but cannot be updated/deleted.

Track locally:

```text
gateway_reward_id
twitch_reward_id
local_reward_type
app_ownership_key
ownership_status
manageable
can_adopt
can_mutate
is_active
last_synced_at
metadata
```

### Create/update payload rules

Gateway reward create/update payloads should contain only gateway-supported Twitch reward fields plus supported ownership metadata if gateway supports it.

Safe payload:

```json
{
  "title": "[Erwin Hatchery] Beta Ei",
  "cost": 1000,
  "prompt": "Gibt dir ein Beta Ei in Erwin Hatchery.",
  "background_color": "#9147ff",
  "is_enabled": true,
  "is_global_cooldown_enabled": false,
  "is_max_per_stream_enabled": false,
  "is_max_per_user_per_stream_enabled": false
}
```

Do not send zero numeric limit fields. Omit these unless enabled and positive:

```text
global_cooldown_seconds
max_per_stream
max_per_user_per_stream
```

Do not send unsupported fields such as `enabled` or `metadata` unless the gateway schema explicitly accepts them.

## Redemption ingestion and processing

Webhook event types:

```text
twitch.channel_points.custom_reward_redemption.add
twitch.channel_points.custom_reward_redemption.update
```

Normalization must extract:

```text
gateway delivery id
gateway event id
event type
gateway reward id if present
Twitch reward id
Twitch redemption id
Twitch user id/login/display name
status
user input
reward title/cost/prompt
raw payload
```

Important: some webhook payloads may lack `gatewayRewardId`. Use local reward mapping by Twitch reward ID or ownership key to recover the gateway reward ID before fulfillment.

### Observe-only behavior

When `ERWIN_GATEWAY_OBSERVE_ONLY=true`:

- Store gateway event.
- Create/update provisional user.
- Store/update Channel Point redemption.
- Do not grant egg.
- Do not write egg grant ledger.
- Do not fulfill/cancel Twitch redemption.
- Return `2xx`.

### Active behavior

When `ERWIN_GATEWAY_OBSERVE_ONLY=false`:

Run one DB transaction:

1. Create/update provisional user.
2. Insert/update redemption.
3. Check duplicate Twitch redemption ID.
4. Apply domain effect, for example increment mystery egg inventory.
5. Write immutable economy ledger.
6. Mark local redemption state as granted/processed.

After transaction commit only:

```text
PATCH /api/v1/channel-points/rewards/:rewardId/redemptions/:redemptionId/status
```

Body:

```json
{
  "status": "FULFILLED",
  "reason": "Erwin Hatchery granted the egg and recorded the ledger entry."
}
```

Fulfillment must use:

1. `redemption.gatewayRewardId` if present.
2. else `mapping.gatewayRewardId`.

Do not silently skip fulfillment if the reward ID is missing. Record a visible failed/pending fulfillment state.

Cancel only on safe validation failures, such as unknown mapping or disabled reward. Do not cancel on transient internal errors by default.

## Subscriptions, Bits, stream state

Handle and store:

```text
twitch.channel.subscribe
twitch.channel.subscription.end
twitch.channel.subscription.message
twitch.channel.subscription.gift
twitch.channel.cheer
twitch.stream.online
twitch.stream.offline
twitch.channel.update
```

Rules:

- Subs may grant fixed transparent perks, for example a subscriber incubator.
- If a sub ends and the subscriber incubator is occupied, mark `remove_when_empty`.
- Bits may be stored for future fixed transparent perks.
- Bits and subs must never create random eggs, random pets, mystery prizes, giveaways, cash-out, trading, betting, or weighted reward chances.
- Stream state is cached server-side and can drive incubation modifiers.

## Manual tests

### Smoke

```bash
curl https://<hatchery>/api/erwin-gateway/smoke
```

Expected:

```json
{"ok":true,"enabled":true,"appSlug":"erwin-hatchery"}
```

### Signed webhook

Use gateway Admin UI test webhook. Hatchery should return `2xx` and store the event.

### Reward sync/adopt/create

Run Hatchery admin reward sync. Expected outcomes:

- Existing manageable unowned reward: discovered or adopted.
- Existing non-manageable reward: discovered, cannot mutate.
- Missing reward: created by Hatchery, owned by Hatchery.
- No `Invalid reward payload` from zero limit fields.

### Observe-only redemption

Redeem a test reward. Expected:

- Gateway delivery delivered.
- Hatchery stores event, user, redemption.
- No egg inventory increment.
- No ledger entry.
- No Twitch fulfill/cancel.

### Active redemption

With `ERWIN_GATEWAY_OBSERVE_ONLY=false` and `ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=true`:

- One redemption creates exactly one inventory increment and one ledger row.
- Duplicate delivery does not increment again.
- Twitch redemption becomes fulfilled.
- If it grants locally but does not fulfill, check `gatewayRewardId`, mapping, and auto-fulfill flag.

## Common failure map

| Symptom | Likely cause |
| --- | --- |
| `/api/v1/me` returns 401 | Prefix copied instead of full API key, revoked key, wrong app key. |
| Webhook signature fails | Missing raw body parser or wrong signing secret. |
| Reward sync 400 `Invalid reward payload` | Zero numeric limit fields or unsupported `metadata`/`enabled` fields sent to gateway. |
| Reward update/delete 403 | Reward not owned by Hatchery. Adopt first if manageable. |
| Reward update/delete 409 | Reward is not manageable by this Twitch client. |
| Redemption grants locally but stays unfulfilled | Auto-fulfill disabled, missing gateway reward ID, or fulfill call failed. |
| Duplicate grant | Dedupe missing on Twitch redemption ID or event ID. |
| Both `/api/twitch/eventsub` and `/erwin-gateway/webhook` receive redemptions | Old direct EventSub still active. Disable old transport before active grants. |

## Token-saving rule for future Codex tasks

For normal debugging tasks, do not ask Codex to update all docs. Use:

```text
Do not update broad docs. Keep changes focused. Add only a short operational note if needed.
```
