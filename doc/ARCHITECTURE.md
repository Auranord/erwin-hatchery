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


### User report intake

Phase 1 bug/feedback intake stays internal. Authenticated players submit `POST /api/user-reports` from the React app with a German title/message, category (`bug` or `feedback`), current frontend path, and a minimized safe client context. The Fastify route validates the Twitch session, applies basic per-user rate limiting, strips sensitive browser data, and inserts the report into the private `user_reports` database queue for later admin/operator review. No GitHub issue creation or browser-visible GitHub integration exists in this phase.

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

The backend remains authoritative for hatch generation and later training/fusion progression. `pet_species` stores species templates/default stats and the default ability, while `pets` stores each owned instance with permanent base stats derived from species defaults plus hatch variance, an individual `ability_id` copied from the species at hatch, and progression fields. Hatched pets start at level 0 with 0 experience and are not favorites by default. The favorite flag is a server-authoritative protection marker; future fusion selection must not allow favorite pets as materials unless that flag is cleared first. That pet-level ability and progression are intentionally mutable by future training or fusion systems without changing the species template. The MVP seed uses one active `beta_egg` loot table with integer pet weights totaling 1200 plus three `cracked_eggs` resource outcomes weighted 800 each, making pets about one third of identifications and egg resources about two thirds. It also keeps inactive `starter_egg` as the once-per-player first egg with an Uncommon-only loot table. Each seeded pet has exactly one class, one element, and the shared `beta_instinct` MVP baseline ability; class metadata includes one main training stat and two secondary training stats for future class-focused pet training, and no traits are included in the seeded MVP pool. `pet_traits` and `pet_trait_assignments` remain available for future training/content systems. Each pet may equip one cosmetic hat unlocked by its owner. Hats are one-time cosmetic progression unlocks and must not affect combat stats, AP gain, ability effects, or boss-event stack logic. Equipment seed data now includes gem-themed equipment-set items with server-authored config bonuses in three tiers: +1/+2/+3 for ATK, DEF, SPD, GAIN, and POW, and +10/+20/+30 HP. Final event stat aggregation should read these server-side values when combat equipment effects are implemented.

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
- erwin-gateway Channel Point reward permissions for Hatchery-owned egg rewards
- EventSub webhook endpoint
- subscription types for Channel Point redemptions, subscriber status, and gifted subscriptions
- optional future subscriptions for Bits/cheer, stream online/offline, stream updates

Manual setup for MVP is acceptable:

- Complete broadcaster/gateway setup.
- Use the admin panel gateway egg sync so Hatchery creates one reward per `egg_types` row.
- Backend only grants rewards mapped back to active Hatchery egg types.

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

Recommended dev commands:

```bash
pnpm install
pnpm dev
pnpm db:migrate
pnpm db:seed
```

The migration set is intentionally a single consolidated base schema while the MVP database is redeployable from scratch; seed scripts own only baseline content and do not carry legacy cleanup branches.

Local stack should use Docker Compose for PostgreSQL and local API/web dev servers.

### Implemented in Milestone 3

- `POST /api/twitch/eventsub` now validates EventSub signatures, handles challenge verification, persists raw webhook events, and processes eligible Channel Point redemptions idempotently.
- Redemption processing creates/uses provisional users, resolves hidden mystery egg outcomes server-side, updates inventory, and writes economy ledger events in one database transaction.

### EventSub subscription lifecycle

- API startup runs an idempotent EventSub subscription sync against Twitch Helix for Channel Point redemption, subscriber status, and gifted-subscription events.
- If one correct subscription for each target type already exists, it is reused.
- If duplicates are found, extras are cleaned up and a warning status is exposed.
- Sync errors do not crash startup by default; status is exposed via admin debug API/UI for operator troubleshooting.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` and `voucher` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies to slotted inventories and the incubator queue: unhatched eggs, pets, consumables, equipment, and incubator queue slots. Hats are not slotted items; they are one-time per-user unlocks. Incubators remain fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion, including incubator queue rows.
- Standard grid dimensions are 1 column × 1 base row for incubator queue slots, 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables and equipment. The hat screen uses a fixed tiled catalog view showing all active hats and whether each one is unlocked.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- The Event-Pet selector is a fixed drop target directly above the pet inventory. It accepts pet drag/drop or tap selection, displays selected pet stats, and highlights the selected pet in its original pet inventory slot instead of acting as extra storage. A separate trashcan-style fixed slot asks for confirmation before scrapping a pet into `cracked_eggs`.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- When a running job reaches its required progress, queue sync marks it completed and waiting to be claimed, writes a ledger row, and can auto-start the next queued job while the completed egg remains redeemable.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the completed egg stays redeemable, no pet is created, and later queue jobs are not blocked by the unclaimed result.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables and equipment are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Cosmetic hats are represented by `user_hat_unlocks` progression rows keyed by `(user_id, hat_id)` and cannot be moved, discarded, or duplicated. Equipment also supports server-authoritative equipment sets: every player receives one default 3-slot set, items in a set are removed from the normal equipment grid, and one set can be marked as the battle Event-Set. Players can spend `cracked_eggs` on set upgrades: a slot upgrade adds one slot to every current set and all future sets, while an additional-set purchase creates another set with the current upgraded slot count. Unhatched eggs, consumables, and equipment expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.

## Slot asset paths

Slot assets are served from `apps/web/public/assets/slots/`.

Filename format: `{id-or-assetKey}-{size}.png`.

Per-type fallback format: `{type}/fallback-{size}.png`.

Seeded pet assets use `pet_species.asset_key`. Egg, equipment, hat, and future consumable assets use their seeded type IDs.


## Twitch integration setup and repair

The API exposes `/api/setup/status`, `/api/setup/twitch/login`, `/api/setup/twitch/callback`, `/api/setup/run-backfill`, `/api/setup/resync-eventsub`, and `/api/setup/health-check`. Setup persists broadcaster identity, required scopes, EventSub sync time, backfill completion times, health timestamps, repair flags, and last error in `twitch_integration_state`. EventSub subscription status is stored per event type in `twitch_eventsub_subscriptions` instead of relying on process memory alone.

EventSub sync covers channel point redemptions, subscribe, subscription message, subscription end, subscription gift, and Bits cheer events. Startup/admin health checks refresh the broadcaster token, verify scopes through stored token metadata, verify required EventSub rows, and compare the persisted callback URL to `PUBLIC_APP_URL`'s `/api/twitch/eventsub`. Revocation webhook messages move the integration into repair state; authorization revocations require broadcaster reauth, while delivery problems keep EventSub unhealthy for safe resync.


## Weekly player shop

The player UI includes a mobile-first `Shop` box that lists weekly offers for purchasable gem equipment and consumables. Eligible catalog rows are snapshotted into `shop_offer_selections` the first time a UTC-week period is requested, so adding new pets, hats, consumables, or equipment later does not change the active weekly offer set. `SHOP_WEEKLY_EQUIPMENT_OFFER_COUNT` and `SHOP_WEEKLY_CONSUMABLE_OFFER_COUNT` configure how many equipment gems and consumables appear each week; both default to 5.

Purchases are server-authoritative and cost `cracked_eggs`. Each player can buy at most the snapshotted offer `stock` amount per weekly offer. The server enforces this by counting non-reverted `shop_item_purchased` economy ledger rows for the player, week key, item kind, and item type before inserting the new inventory slot and debit ledger entry in one transaction.

The player UI also includes a separate `Subscriber-Shop` box. It snapshots deterministic monthly pairings from `pet_species.is_shop_purchasable = true` and `hats.is_shop_purchasable = true`, each with stock 1 and a fixed 1-`voucher` cost. Purchases debit Gutscheine, create an owned pet with the selected cosmetic hat equipped, and unlock that hat once via `user_hat_unlocks` in one ledgered transaction. If the user already unlocked that hat, the purchase is rejected instead of creating a duplicate hat unlock.

Duplicate pet training lives in the game API as a transaction that marks material pets consumed, applies integer training points to the target, recalculates class-based level bonuses, and writes a single economy ledger entry. Admin ledger revert restores consumed pets and removes the awarded training points only when no later training event depends on the target state.

## erwin-gateway foundation integration

Hatchery now has a disabled-by-default foundation for `erwin-gateway`, the central Twitch transport service. The gateway path is controlled by `ERWIN_GATEWAY_ENABLED`, `ERWIN_GATEWAY_OBSERVE_ONLY`, and `ERWIN_GATEWAY_REQUIRED`. When enabled or required, Hatchery requires `ERWIN_GATEWAY_URL` and `ERWIN_GATEWAY_APP_API_KEY` and uses a typed client for `GET /api/v1/me` and `GET /api/v1/streams/current` with `Authorization: Bearer <app-api-key>`.

The startup smoke check calls `gateway.me()` only when gateway integration is enabled or required. A failed smoke check is logged and startup continues unless `ERWIN_GATEWAY_REQUIRED=true`, in which case startup fails before serving traffic. Operators can also call `GET /api/erwin-gateway/smoke` to validate gateway app identity without exposing the API key.

Hatchery exposes `POST /erwin-gateway/webhook` as the downstream app receiver for gateway deliveries. The receiver verifies `X-Erwin-Gateway-Signature` over `delivery_id + timestamp + raw_body` using HMAC-SHA256 and `ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET`, rejects stale timestamps using `ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS`, parses JSON only after validation, and persists the delivery/event idempotency row before returning success. This PR is observe-only: accepted gateway events are recorded with no egg, voucher, redemption-status, or other economy side effects.

The previous direct Twitch OAuth, EventSub, reward, subscription, Bits, and stream-state code remains in place for the current MVP path. Future migration work should progressively replace direct Twitch transport with gateway APIs after observe-only count comparisons pass.

## Erwin Gateway Channel Point observe-only ingestion

Hatchery now receives Channel Point custom reward redemption transport from `erwin-gateway`; the gateway owns Twitch EventSub delivery, webhook signing, and app API transport, while Hatchery owns reward mapping and all economy decisions. `ERWIN_GATEWAY_OBSERVE_ONLY=true` remains the default so real redemption webhooks are verified, deduped, stored, and mapped without granting Mystery Eggs, writing egg-grant ledger entries, or calling gateway fulfill/cancel.

Reward mappings for egg rewards are authored by Hatchery from the admin panel rather than selected manually. `POST /api/admin/erwin-gateway/egg-rewards/sync` reads `egg_types`, creates or updates one app-owned gateway custom reward per egg type, stores the resulting gateway/Twitch reward IDs as `gateway_reward_mappings` using `egg_type:<egg_type_id>`, and mirrors `egg_types.is_active` to the gateway reward enabled state. For the current MVP seed `beta_egg` is active for Channel Point redemption and `starter_egg` is inactive but kept for each player's first egg. Unknown rewards are stored with `mapping_status='unknown'` for diagnostics and are ignored safely rather than crashing or mutating inventory.

Duplicate gateway deliveries are safe: Hatchery dedupes by gateway delivery ID and gateway event ID before processing. The Channel Point redemption cache is also upserted by Twitch redemption ID so add/update events and retries cannot create duplicate redemption rows or repeated economy effects. Database wipes are acceptable during development, but this idempotency model is still required for the production path.

Inspection endpoints:

- `GET /api/erwin-gateway/smoke` checks gateway app authentication.
- `GET /api/erwin-gateway/diagnostics` returns observe-only status, reward mappings, recent gateway redemption events, recent cached Channel Point redemptions, unmapped rewards, and ignored events.
- Admins use `GET /api/admin/erwin-gateway/egg-rewards` and `POST /api/admin/erwin-gateway/egg-rewards/sync` from the admin panel to let Hatchery create/update one gateway custom reward per database egg type and mirror active/inactive state.
