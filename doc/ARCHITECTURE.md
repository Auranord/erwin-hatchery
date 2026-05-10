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
- mystery egg balance increments/decrements
- egg content rolls at identify/open time
- incubation calculations
- pet instance generation from species defaults plus hatch variance
- admin panel API
- battle/event resolution; future boss-event RPG combat rules remain documentation-only until explicitly implemented
- leaderboard updates
- audit/ledger/revert logic
- Server-Sent Events for overlays and live UI updates; alert overlays consume normalized `overlay_alert` events for pet hatches now and future in-game event messages later

## Frontend responsibilities

The frontend owns:

- mobile-first authenticated player UI
- public leaderboard
- Twitch login button
- inventory screens
- egg identification actions
- incubator management
- pet inventory, fixed Event-Pet drop target, and selected pet stat summary
- account deletion UI
- admin UI for authorized roles
- OBS overlay pages (`/overlay/alerts` is a transparent 600x260 temporary alert source; `/overlay/battle` remains a larger event presentation source)

The frontend must never decide final outcomes. It only sends user intent to the backend.


## Pet RPG model boundaries

The backend remains authoritative for hatch generation and later training. `pet_species` stores species templates/default stats and the default ability, while `pets` stores each owned instance with permanent base stats derived from species defaults plus hatch variance and an individual `ability_id` copied from the species at hatch. That pet-level ability is intentionally mutable by future training without changing the species template. The MVP seed uses one active `beta_egg` loot table with integer pet weights totaling 1200. Each seeded pet has exactly one class, one element, and the shared `beta_instinct` placeholder ability; no traits are included in the seeded MVP pool. `pet_traits` and `pet_trait_assignments` remain available for future training/content systems. Each pet may equip one cosmetic hat. Hats must not affect combat stats, AP gain, ability effects, or boss-event stack logic. Gems are intentionally out of scope for this pass.

Future boss-event state such as current AP, current HP, attacks made, effective stats, class stacks, and element stacks belongs on event participant runtime state, not on pet rows. Ability trigger logic is documented for later implementation only: attacks grant 20 base AP, GAIN modifies AP gained per attack, POW scales ability effects, and abilities auto-trigger when AP and minimum-attack requirements are met.

## Realtime MVP

Use Server-Sent Events first:

```text
GET /api/events/player
GET /api/events/overlay/alerts/stream?token=...
GET /api/events/overlay/battle?token=...
GET /api/events/overlay/battle/stream?token=...
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

### Implemented in Milestone 3

- `POST /api/twitch/eventsub` now validates EventSub signatures, handles challenge verification, persists raw webhook events, and processes eligible Channel Point redemptions idempotently.
- Redemption processing creates/uses provisional users, resolves hidden mystery egg outcomes server-side, updates inventory, and writes economy ledger events in one database transaction.

### EventSub subscription lifecycle

- API startup runs an idempotent EventSub subscription sync against Twitch Helix for channel point redemption events.
- If one correct subscription already exists, it is reused.
- If duplicates are found, extras are cleaned up and a warning status is exposed.
- Sync errors do not crash startup by default; status is exposed via admin debug API/UI for operator troubleshooting.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` and `voucher` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies only to slotted inventories: unhatched eggs, pets, consumables, equipment, and hats. Incubators are fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion.
- Standard grid dimensions are 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables, equipment, and hats.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- The Event-Pet selector is a fixed drop target directly above the pet inventory. It accepts pet drag/drop or tap selection, displays selected pet stats, and highlights the selected pet in its original pet inventory slot instead of acting as extra storage. A separate trashcan-style fixed slot asks for confirmation before scrapping a pet into `cracked_eggs`.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the job stays running, the egg stays incubating, no pet is created, and the incubator remains occupied.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables, equipment, and cosmetic hats are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Unhatched eggs, consumables, equipment, and hats expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.
