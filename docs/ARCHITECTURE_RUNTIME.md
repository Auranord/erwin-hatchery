# Architecture and Runtime

## Monorepo shape

```text
apps/
  web/       React + Vite mobile-first app and overlay routes
  api/       Fastify TypeScript backend
packages/
  shared/    shared types, zod schemas, constants
```

## Deployment shape

- Fastify API container on TrueNAS SCALE.
- PostgreSQL container in same stack.
- Built React frontend can be served from API container or Cloudflare Pages.
- Traefik terminates public HTTPS.
- All-in-one mode: Fastify serves `apps/web/dist` and SPA fallback for non-API routes.

## API route conventions

- API routes live under `/api/*`.
- Gateway downstream webhook is `/erwin-gateway/webhook`.
- Legacy/direct Twitch EventSub may exist at `/api/twitch/eventsub` during migration.
- Overlay routes are under `/overlay/*`.
- Unknown frontend routes should serve `index.html`; API/webhook routes must not fall through to SPA.

## Backend owns

- Twitch player login/session and player-authorized subscription status checks.
- Gateway webhook verification and ingestion.
- Direct Twitch transport only while migration requires it.
- Inventory, economy, rolls, ledger, incubations, hatches, pets, battle/event resolution.
- Admin APIs.
- Server-Sent Events.
- Overlay event normalization.

## Frontend owns

- Mobile-first authenticated UI.
- German labels and player interactions.
- Public leaderboard.
- Inventory display and user intent actions.
- Admin UI.
- OBS overlay pages.

Frontend must never decide final outcomes.

## Realtime

Use SSE first:

```text
GET /api/events/player
GET /api/events/overlay/alerts/stream?token=...
GET /api/events/overlay/battle?token=...
GET /api/events/overlay/battle/stream?token=...
```

## Event ingestion pattern

1. Verify authenticity/signature.
2. Store raw event or gateway event with unique external identifiers.
3. Return success for duplicate already-recorded events without repeated effects.
4. Process side effects in DB transaction.
5. Write `economy_ledger` and game/event rows.
6. Emit overlay/player events after commit.

## Stream state

Track stream online/offline and viewer count for incubation modifiers.

Preferred source during gateway migration:

- `erwin-gateway` stream online/offline webhooks.
- `GET /api/v1/streams/current`.

Viewer count must not be trusted from the client.

## Player subscription status

- Player login requests `user:read:subscriptions` in addition to identity/profile scope.
- `GET /api/me/subscription` checks the authenticated player's subscription to the configured broadcaster with the player's Twitch OAuth token.
- Subscription, resubscription, gift-subscription, and subscription-end events remain voucher/audit inputs only and must not derive subscriber status.

## Admin UI

Initial owner/admin is the configured broadcaster Twitch user.

Roles:

- owner
- admin
- moderator
- user

Admin features include user search, inventory summary, ledger/events, test grants, role changes, battle start/revert, and diagnostics.

## Overlay routes

- `/overlay/alerts`: compact transparent alert source.
- `/overlay/battle`: larger event/battle presentation source.
- Protect overlay routes with token/secret.
