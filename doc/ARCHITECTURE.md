# Architecture - Erwin Hatchery MVP

## Deployment shape

The codebase should be a monorepo with separate frontend and backend apps:

```text
apps/
  web/       React + Vite mobile-first app and overlay routes
  api/       Fastify TypeScript backend
packages/
  shared/    shared types, zod schemas, constants
```

The backend is deployed as a container on TrueNAS SCALE. The database is a PostgreSQL container in the same TrueNAS YAML/Compose stack with a mounted dataset.

The frontend should be buildable as static assets. Preferred production options:

1. **Traffic-saving mode**: deploy `apps/web` to Cloudflare Pages and point it at the API host.
2. **Simplest fallback mode**: serve the built frontend from the backend container behind Traefik.

For all-in-one deployments, the Fastify container must serve the compiled `apps/web/dist` assets and provide SPA fallback behavior: `GET /` returns `index.html`, unknown non-API frontend routes return `index.html`, and API endpoints stay reserved under `/api/*`.

Codex should implement the repo so both modes remain possible.

## External endpoints

Initial public domain:

```text
hatchery.auranord.net
```

Recommended API subdomain if using Cloudflare Pages for frontend:

```text
api.hatchery.auranord.net
```

If only one host is used, route API and overlay paths through the same origin:

```text
/api/*
/auth/*
/eventsub/*
/overlay/*
```

## Components

```text
Twitch Channel Points / Subs / Bits / Stream Events
                  ↓
          Twitch EventSub Webhooks
                  ↓
          Traefik on TrueNAS SCALE
                  ↓
          Fastify API container
                  ↓
          PostgreSQL container + mounted dataset
                  ↓
       React PWA + OBS overlay via API/SSE
```

## Backend responsibilities

The backend owns:

- Twitch OAuth login
- Twitch EventSub webhooks
- EventSub signature verification
- Channel Point reward redemption processing
- provisional player creation
- user account/session state
- all inventory/economy mutations
- egg content rolls
- incubation calculations
- pet stat generation
- admin panel API
- battle/event resolution
- leaderboard updates
- audit/ledger/revert logic
- Server-Sent Events for overlays and live UI updates

## Frontend responsibilities

The frontend owns:

- mobile-first authenticated player UI
- public leaderboard
- Twitch login button
- inventory screens
- egg identification actions
- incubator management
- pet list and selected event pet
- account deletion UI
- admin UI for authorized roles
- OBS overlay pages

The frontend must never decide final outcomes. It only sends user intent to the backend.

## Realtime MVP

Use Server-Sent Events first:

```text
GET /api/events/player
GET /api/events/overlay/alerts?token=...
GET /api/events/overlay/battle?token=...
```

SSE is simpler than WebSockets for the MVP because most updates are server-to-client broadcasts.

## Twitch integration

Required MVP Twitch pieces:

- Twitch OAuth app credentials
- broadcaster Twitch user ID
- Channel Point reward ID for `1x Mystery Ei`
- EventSub webhook endpoint
- subscription types for Channel Point redemptions
- optional future subscriptions for subs, gifted subs, Bits/cheer, stream online/offline, stream updates

Manual setup for MVP is acceptable:

- Create the Channel Point reward manually in Twitch.
- Paste the reward ID into `.env`.
- Backend only processes redemptions for that configured reward ID.

## Event ingestion philosophy

Ingest all Twitch events into a durable table before applying gameplay logic.

Event handling pattern:

1. Validate signature/authenticity.
2. Store raw event with unique Twitch event ID.
3. If already processed, return success without duplicate effects.
4. Process inside a database transaction.
5. Create ledger/game event rows.
6. Emit overlay/player update.

## Stream state and viewer count

The system should track stream state and current viewer count for incubation modifiers.

MVP can update this by one of these methods:

- EventSub stream online/offline + periodic Helix poll for viewer count.
- Manual admin override if Twitch API work is delayed.

Viewer count should not be trusted from the client.

## Admin panel

Admin panel is part of the authenticated web app.

Initial owner/admin:

- The configured `TWITCH_BROADCASTER_ID` becomes the first owner/admin on login.

Roles should be expandable:

- `owner`
- `admin`
- `moderator`
- `user`

MVP admin features:

- view users
- view inventory summary
- view ledger/game events
- grant test egg
- reset/freeze/delete user progress
- promote/demote roles
- start battle event
- revert battle event
- resend overlay event if needed

## Scalability target

Budget target: 0 to 15 EUR/month.

Expected MVP scale:

- small to medium stream traffic
- possibly up to 1000 viewers on public pages/overlays
- much fewer active economy interactions per minute

To support this cheaply:

- keep frontend static where possible
- cache static assets via Cloudflare if available
- use SSE carefully and only where useful
- batch or throttle overlay notifications
- calculate incubation from timestamps, not background ticking jobs per egg
- use database transactions and indexes

## Local development

Recommended dev commands, to be implemented by Codex:

```bash
pnpm install
pnpm dev
pnpm db:migrate
pnpm db:seed
```

Local stack should use Docker Compose for PostgreSQL and local API/web dev servers.
