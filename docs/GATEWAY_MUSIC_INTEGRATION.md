# erwin-gateway Compact Implementation Reference for erwin-music

Purpose: this file is the compact gateway implementation reference for migrating `erwin-music`. It keeps only what Codex needs for implementation and day-to-day debugging.

## Responsibility split

`erwin-gateway` owns Twitch transport:

- Twitch bot OAuth and token refresh.
- Twitch chat receive through EventSub.
- Twitch chat send through Send Chat Message API.
- Stream online/offline EventSub and current stream reads.
- Static text commands that do not require music state.
- Signed webhook delivery, retries, and dead-letter diagnostics.

`erwin-music` owns music domain behavior:

- Vote/session state.
- Song queue and request validation.
- Skip/pause/resume behavior.
- Music overlay/dashboard updates.
- Permissions for music actions.
- Any Discord/live-notification behavior unless intentionally moved later.

Do not grant Channel Point, Bits, subscription, or admin permissions to `erwin-music` unless a future feature explicitly needs them.

## Required gateway state

Gateway must be deployed and healthy:

```text
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/health/deep
```

Gateway Twitch setup must include:

- Bot account connected with `user:read:chat`, `user:write:chat`, `user:bot`.
- Broadcaster connected with `channel:bot`.
- EventSub healthy for `channel.chat.message`, `stream.online`, `stream.offline`.
- Outgoing chat queue can send as the bot.

## Register the Music app in gateway

App slug: `erwin-music`

Webhook URL:

```text
https://<music-host>/erwin-gateway/webhook
```

Permissions:

```json
[
  "chat:messages:send",
  "chat:messages:receive",
  "chat:commands:receive",
  "streams:read",
  "logs:read_own"
]
```

Webhook filters:

```text
twitch.chat.message
twitch.stream.online
twitch.stream.offline
```

Do not add `twitch.chat.command`; commands are delivered as `twitch.chat.message` with command fields.

Use the full raw app API key:

```text
egw_live_<keyId>_<secret>
```

The shorter `egw_live_<keyId>` prefix is not usable for auth.

## erwin-music environment variables

```env
ERWIN_GATEWAY_ENABLED=true
ERWIN_GATEWAY_OBSERVE_ONLY=true
ERWIN_GATEWAY_REQUIRED=false

ERWIN_GATEWAY_URL=https://erwin-gateway.auranord.net
ERWIN_GATEWAY_APP_API_KEY=<full raw app API key>
ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET=<gateway app webhook signing secret>
ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS=300
```

Recommended transport flags:

```env
ERWIN_MUSIC_GATEWAY_CHAT_RECEIVE_ENABLED=false
ERWIN_MUSIC_GATEWAY_CHAT_SEND_ENABLED=false
ERWIN_MUSIC_GATEWAY_STREAM_READ_ENABLED=false
ERWIN_MUSIC_OLD_IRC_RECEIVE_ENABLED=true
ERWIN_MUSIC_OLD_IRC_SEND_ENABLED=true
```

Cut over one direction at a time. Do not let old IRC receive and gateway receive both mutate music state unless duplicate protection is already proven.

## Gateway client requirements

Every `/api/v1/*` request:

```text
Authorization: Bearer <ERWIN_GATEWAY_APP_API_KEY>
Accept: application/json
Content-Type: application/json when body is present
```

Required client methods:

```text
GET  /api/v1/me
GET  /api/v1/streams/current
POST /api/v1/chat/messages
GET  /api/v1/chat/messages/:messageId
GET  /api/v1/webhook-deliveries
GET  /api/v1/webhook-deliveries/:deliveryId
POST /api/v1/webhook-deliveries/:deliveryId/retry
```

Handle status codes:

- `401`: app API key invalid/revoked/malformed.
- `403`: app lacks permission.
- `404`: resource missing or not owned by app.
- `409`: idempotency key reused with different payload.
- `429`: back off, retry with same idempotency key.
- `5xx`: retry with backoff where safe.

Never log API keys, webhook secrets, Twitch secrets, cookies, Authorization headers, or raw signed payloads unless explicitly redacted.

## Sending chat through gateway

Endpoint:

```text
POST /api/v1/chat/messages
```

Permission:

```text
chat:messages:send
```

Example:

```json
{
  "message": "Vote opened!",
  "idempotency_key": "erwin-music:vote-round:<roundId>:open:v1",
  "for_source_only": true,
  "priority": 0
}
```

Idempotency keys must be stable across retries, restarts, and deploys. Good keys:

```text
erwin-music:vote-round:<roundId>:open:v1
erwin-music:vote-round:<roundId>:result:v1
erwin-music:song-request:<requestId>:accepted:v1
erwin-music:skip-vote:<voteId>:passed:v1
```

Do not use a random UUID per retry. Same key + same payload should return existing queued/sent message. Same key + different payload should return `409`.

## Receiving webhooks

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
- Verify exact raw bytes, not parsed JSON.
- Reject stale timestamps, default max age 300 seconds.
- Parse JSON after verification.
- Store/dedupe before changing music state or emitting dashboard updates.
- Return `2xx` only after durable record or safe duplicate detection.

Dedupe by:

```text
delivery_id
event_id
twitch_message_id for chat messages
```

## Chat message event handling

Event type:

```text
twitch.chat.message
```

Expected payload content:

```text
event_id / delivery_id
channel id/login
chatter user id/login/display name
message id
message text
fragments
badges
role booleans: is_broadcaster, is_mod, is_vip, is_subscriber
chat.is_command
chat.command_name
chat.command_args
raw EventSub references
```

Commands are not a separate event type. Route messages where `chat.is_command = true` to existing command handlers.

Music commands that stay in `erwin-music`:

```text
!vote
!song
!skip
!pause
!resume
```

`erwin-music` still decides:

- who is allowed to use the command
- queue/vote effects
- cooldowns that depend on music state
- overlay/dashboard broadcasts
- response messages

Use role booleans from the webhook to preserve broadcaster/mod/VIP/subscriber behavior.

## Static text commands

Move simple state-free commands into the gateway Text Commands UI:

```text
!dc
!discord
!youtube
!socials
!commands
!lurk
```

Configure in gateway:

```text
command name
aliases
response text
role requirement
reply mode
global cooldown
per-user cooldown
enabled state
```

Static command messages may still be delivered to `erwin-music` as `twitch.chat.message`. If `erwin-music` also has handlers for them, disable the local handler to avoid duplicate replies.

## Stream status

Use:

```text
GET /api/v1/streams/current
```

and/or webhooks:

```text
twitch.stream.online
twitch.stream.offline
```

Use gateway stream state for:

- deciding whether to run live-only features
- dashboard state
- stream-aware timers
- reconnect behavior

Keep Discord live notification dispatch in `erwin-music` unless intentionally moved later.

## Suggested cutover plan

### Phase 1: Foundation only

- Add gateway env vars.
- Add gateway client.
- Add webhook receiver.
- Verify `/api/v1/me`.
- Verify signed webhook test.
- No music state changes yet.

### Phase 2: Observe-only receive

- Enable gateway webhook receive.
- Keep old IRC receive active.
- Count gateway chat messages vs IRC messages for one test session.
- Store gateway messages, but do not mutate music queue/votes yet.
- Confirm dedupe by event ID/message ID.

### Phase 3: Command receive

- Route `!song`, `!vote`, `!skip`, `!pause`, `!resume` from gateway to existing handlers.
- Disable old IRC receive after duplicate counts match.
- Keep old send path until receive is stable.

### Phase 4: Chat send

- Replace one low-risk response path with gateway `POST /api/v1/chat/messages`.
- Use stable idempotency keys.
- Monitor outgoing queue and dead letters.
- Then migrate vote/timer/domain responses.

### Phase 5: Static commands and stream

- Move state-free commands to gateway Text Commands UI.
- Replace direct stream polling with `/streams/current` or stream webhooks.
- Remove old IRC/bot OAuth ownership from `erwin-music` startup.

## Manual tests

### App smoke

```bash
curl https://erwin-gateway.auranord.net/api/v1/me \
  -H 'Authorization: Bearer <full erwin-music app key>'
```

Expected slug:

```text
erwin-music
```

### Music app smoke route

If implemented:

```bash
curl https://<music-host>/api/erwin-gateway/smoke
```

Expected:

```json
{"ok":true,"enabled":true,"appSlug":"erwin-music"}
```

### Webhook signature

Use gateway Admin UI test webhook. Expected:

- Music app returns `2xx`.
- Event is stored.
- Invalid signature test returns `401` or `403`.

### Chat receive

Send:

```text
!song smoke-test
```

Expected:

- gateway delivery appears as delivered
- music app stores event
- command fields are parsed
- observe-only mode does not change queue
- active mode calls existing `!song` handler once

### Chat send

```bash
curl -X POST https://erwin-gateway.auranord.net/api/v1/chat/messages \
  -H 'Authorization: Bearer <full erwin-music app key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Music gateway smoke test",
    "idempotency_key": "erwin-music:smoke:<date>:v1",
    "for_source_only": true
  }'
```

Expected:

- message appears in Twitch chat
- retry with same payload does not send twice
- different payload with same key returns `409`

## Common failure map

| Symptom | Likely cause |
| --- | --- |
| `/api/v1/me` returns 401 | Prefix copied instead of full API key, revoked key, wrong app key. |
| Chat send returns 403 | Missing `chat:messages:send`. |
| Chat webhook not delivered | App filter missing `twitch.chat.message`, gateway EventSub unhealthy, webhook URL wrong. |
| Signature verification fails | Missing raw body parser or wrong webhook signing secret. |
| Commands arrive as normal messages | Use `chat.is_command` and parsed command fields; no separate command event exists. |
| Duplicate command handling | Old IRC receive and gateway receive both active without dedupe. |
| Duplicate chat replies | Old IRC send and gateway send both active, or static command exists in both app and gateway. |
| Chat send 409 | Same idempotency key reused with different message payload. |
| Stream status wrong | Old direct polling and gateway stream state disagree; choose one authoritative path. |

## Rollback

- Re-enable old IRC receive/send flags.
- Disable `erwin-music` gateway webhook filters or endpoint in gateway.
- Disable gateway send flags in `erwin-music`.
- Keep API key valid until rollback verification is done.
- Retry only idempotent deliveries after rollback.
- Do not replay commands that already changed music state.

## Token-saving rule for future Codex tasks

For normal debugging tasks, do not ask Codex to update all docs. Use:

```text
Do not update broad docs. Keep changes focused. Add only a short operational note if needed.
```
