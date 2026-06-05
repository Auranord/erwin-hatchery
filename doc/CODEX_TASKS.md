# Codex Task Plan - Erwin Hatchery MVP

## Progress status

Last reevaluated: **2026-05-13**.

- ✅ Milestone 0 completed (repo skeleton and workspace baseline).
- ✅ Milestone 1 completed (Fastify server, config validation, PostgreSQL, Drizzle migrations/seeds, health route, container baseline).
- ✅ Milestone 2 completed (Twitch OAuth login/logout, OAuth state validation, secure session cookie, `/api/me`, owner bootstrap via broadcaster ID).
- ✅ Milestone 3 completed (EventSub webhook ingestion + idempotent Channel Point redemption processing + startup subscription auto-sync + admin status debug implemented).
- ✅ Milestone 4 completed (authenticated player shell, live slotted inventory stream, mystery egg identify, incubate -> hatch flow, pet selection, consumable/equipment/hat/pet/egg slot moves, and public leaderboard are implemented).
- ✅ Milestone 5 completed (timestamp-based incubation start/finish flow, queue-based live-progress accumulation, live/viewer multipliers, admin stream-state override, and hatch pet creation are implemented).
- 🟨 Milestone 6 partially completed (admin route protection, role mutation, user search/detail, admin logs, ledger view, test mystery egg grants + ledger revert are implemented; freeze/reset/delete progress and full role lifecycle controls are still pending).
- ✅ Milestone 7 completed (admin battle event start with random winners, 3/2/1 leaderboard award, participant/result persistence, pet deselection, and dedicated battle revert action are implemented).
- ✅ Milestone 8 completed (secret-protected overlay routes `/overlay/alerts` + `/overlay/battle`, SSE streams, hatch alert display, battle winner/top-3 display, leaderboard snapshot, and OBS-safe layout are implemented).
- 🟨 Milestone 9 partially completed (subscription EventSub auto-sync/ingestion, subscriber status cache, gift-sub ingestion, fixed Gutschein grants, and Gutschein subscriber shop spending are implemented; Bits ingestion/effects remain pending).
- 🟨 Milestone 10 partially completed (production Docker image, GHCR branch tagging, TrueNAS example with Postgres/init/health checks, production env validation, secure production cookies, and frontend fallback routing are implemented; rate limiting, explicit CORS middleware, and backup scripts/restore notes remain pending).

Reevaluation notes for 2026-05-11:

- No milestone changed completion category after comparing the task list with the current API/web code and deployment docs.
- Milestone 6 remains partial because admin user search/detail, role mutation, admin logs, ledger view, test mystery egg grant, and test grant revert exist, but freeze/reset/delete progress controls are not implemented.
- Milestone 9 remains partial because subscription and gift-sub EventSub paths now grant fixed Gutschein resources and the subscriber shop can spend them on fixed pet-hat pairs, while Bits/cheer EventSub subscription, ingestion, and fixed-effect application are still absent.
- Milestone 10 remains partial because the production image, GHCR workflow, TrueNAS example, health checks, production cookie behavior, and SPA fallback exist, while Fastify-level rate limiting, explicit CORS origin enforcement, and executable backup/restore automation are still missing.


- ✅ Added persisted `shop_offer_selections` rows for basic weekly shop and monthly subscriber-shop periods so active offers do not change when new catalog entries are added mid-period.
- ✅ Added a player UI Subscriber-Shop box with monthly pet-hat pairs, 1 Gutschein price, stock 1, and server-authoritative ledgered purchases that now unlock hats once instead of creating hat item slots.

## Milestone 0 - Repo skeleton

- Create monorepo layout:
  - `apps/web`
  - `apps/api`
  - `packages/shared`
- Add pnpm workspace.
- Add TypeScript strict config.
- Add ESLint/Prettier or minimal linting.
- Add Dockerfile.
- Add GitHub Actions Docker workflow.
- Add `.env.example`.
- Add basic README scripts.

Acceptance:

- `pnpm install` works.
- `pnpm build` works.
- Docker image builds locally.

## Milestone 1 - Backend foundation

- Fastify server.
- Health route.
- Config loader with validation.
- PostgreSQL connection.
- Migration tooling.
- Basic schema from `DATA_MODEL.md`.
- Seed data for pet species, pet rarities/classes/elements/abilities, egg types, loot table.

Acceptance:

- API starts with Postgres.
- `/api/health` returns ok.
- Seed data exists.

## Milestone 2 - Twitch OAuth login

- Add Twitch OAuth login route.
- Validate OAuth state.
- Session cookie.
- Fetch/store Twitch user profile.
- If user ID matches `TWITCH_BROADCASTER_ID`, grant owner role.
- Add `/api/me`.
- Add logout.

Acceptance:

- User can log in with Twitch.
- Owner gets admin access automatically.

## Milestone 3 - EventSub Channel Point redemptions

- Add EventSub webhook endpoint.
- Validate Twitch signature.
- Handle challenge verification.
- Store raw events.
- Process gateway-mapped active Hatchery egg reward IDs only.
- Create provisional user if needed.
- Create counted mystery egg inventory; hidden outcomes are determined later when the player identifies/opens the egg.
- Idempotency by Twitch event/redemption ID.
- Ledger entry for egg creation.

Acceptance:

- Redeeming the Hatchery-synced `Beta Ei` reward creates exactly one egg.
- Replayed webhook does not duplicate egg.

## Milestone 4 - Player web UI MVP

- React + Vite mobile-first app.
- German UI labels.
- Login/logout.
- Show resource balance.
- Show mystery eggs.
- Identify egg action.
- Show unhatched eggs.
- Show fixed incubator drop target(s).
- Start incubation.
- Show hatched pets.
- Select event pet through the fixed Event-Pet drop target above the pet inventory; keep the selected pet highlighted in its original inventory slot.
- Public leaderboard page.

Acceptance:

- Logged-in user can go from egg -> identify -> incubate -> hatch -> select pet.

## Milestone 5 - Incubation engine

- Implement hatch progress calculation based on timestamps.
- Support offline/live multiplier config.
- Support viewer count multiplier field/config.
- Add manual/admin stream state override if live Twitch polling is not ready.
- Finish hatch action creates pet instance with stat variance.
- Fully progressed jobs are marked completed before redemption so the next queued incubation can start while the result waits to be claimed.
- Ledger entries for incubation start, queue auto-start, completed-waiting-claim, and pet hatch.

Acceptance:

- Incubation progresses without background per-second jobs.
- Hatch creates stable unique pet stats server-side.

## Milestone 6 - Admin panel

- Admin route protected by role checks.
- User search/list.
- Inventory summary.
- Ledger/event view.
- Grant test egg.
- Freeze/reset/delete user progress.
- Promote/demote roles.

Acceptance:

- Owner can promote another user.
- Admin actions are ledgered.

## Milestone 7 - Battle event MVP

- ✅ Admin can start a battle event from admin UI (`POST /api/admin/events/start`) any time.
- Collect all selected pets.
- Randomly choose 1st/2nd/3rd from selected pets.
- ✅ Start flow awards leaderboard points 3/2/1 to random winners from selected pets.
- ✅ Event start flow deselects all pets marked for event participation after resolution.
- ✅ Store event participants/result JSON.
- Ledger all point awards.
- ✅ Add revert battle action.

Acceptance:

- Battle result appears in admin UI and public leaderboard.
- Revert removes awarded points and marks event reverted.

## Milestone 8 - OBS overlays

- ✅ `/overlay/alerts`
- ✅ `/overlay/battle`
- Route token/secret protection.
- ✅ SSE connection to backend.
- ✅ Alert overlay shows hatch/rare hatch events.
- ✅ Battle overlay shows winners and pet placeholders.
- ✅ 1920x1080 safe layout.

Acceptance:

- OBS browser source can display alerts and battle results.

## Milestone 9 - Bits/sub event support foundation

- 🟨 Add schema/event ingestion for sub/gift sub/Bits events. Subscription and gift-sub ingestion are implemented; Bits/cheer ingestion remains pending.
- ✅ Add schema/event ingestion for sub status events (`channel.subscribe`, `channel.subscription.message`, `channel.subscription.end`) with persisted renewal/end cache on `users`.
- ✅ Add gift-sub EventSub subscription type and fixed Gutschein processing for gifter/recipient where Twitch identity is available.
- ⏳ Add Bits/cheer EventSub subscription type, webhook processing, and fixed effect application once fixed effects are defined.
- ✅ Do not add paid random eggs.
- ✅ Remove subscriber incubators; subscriptions now grant fixed Gutschein resources instead.
- ⏳ Bits effects should be fixed only and can remain disabled behind config.

Acceptance:

- ✅ Subbed users receive fixed Gutschein resources instead of incubators.
- ✅ Gift-sub ingestion grants Gutschein resources to the gifter and recipient when Twitch identity is available.
- ⏳ Bits/cheer EventSub subscription, ingestion, and fixed-effect application are still pending.

## Milestone 10 - Deployment hardening

- ✅ Docker image produces production build for both API and web assets.
- ✅ Compose/YAML example works with Postgres/init job and Traefik-facing port configuration.
- ✅ Health check.
- ⏳ Basic rate limiting.
- ⏳ Explicit CORS middleware/config enforcement.
- ✅ Secure cookies in production.
- ⏳ Backup scripts and restore notes.
- ✅ Production env validation.

Acceptance:

- 🟨 TrueNAS deployment baseline exists with persistent Postgres volume and init migration/seed job; backup/restore documentation still needs hardening.
- ✅ `GET /` returns the landing page and frontend route fallback works without impacting `/api/*` routes.


## Pet RPG data model revision

- Use `pet_species` for species templates/default stats and species default abilities, and `pets` for owned pet instances with permanent base stats derived from species defaults plus hatch variance, an individual ability copied from the species at hatch, server-authoritative level/experience progression fields, and a favorite flag that future fusion material selection must honor.
- Do not use rarity as a stat multiplier; `pet_rarities` is for rank, display/economy metadata, combine progression, and recycle value only.
- Each pet has exactly one class, one element, one individual ability, level 0, 0 experience, favorite false, and a trait list via `pet_trait_assignments` when created. Each class defines one main training stat and two secondary training stats for future stat increases. Each trait defines positive or negative modifiers for every base stat. Each pet may equip one cosmetic hat; hats never affect combat stats.
- Gem equipment seed data exists for three stat-bonus tiers; future work must keep any equipment stat aggregation server-authoritative and ledger relevant grants/mutations.
- Keep current AP, current HP, attacks made, effective stats, boss class stacks, and boss element stacks on boss-event participant runtime state, not on pets.
- Future ability rules are documentation-only for now: `pet_abilities.ap_required` is the AP auto-trigger threshold; trigger when current AP and minimum attacks are met; attacks grant 20 base AP; GAIN modifies AP gained; POW scales ability effects.
- Do not implement boss-event battle logic in code until explicitly requested.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` and `voucher` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies to slotted inventories and the incubator queue: unhatched eggs, pets, consumables, equipment, hats, and incubator queue slots. Incubators remain fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion, including incubator queue rows.
- Standard grid dimensions are 1 column × 1 base row for incubator queue slots, 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables, equipment, and hats.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- The Event-Pet selector sits directly above the pet inventory as a fixed drop target with pet stat labels; it marks a pet for events without moving it out of the pet inventory. A trashcan-style fixed slot scraps a pet into Aufgebrochene Eier after confirmation.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- Queue sync marks a fully progressed running job as completed before pet redemption and can then auto-start the next queued job. Finishing incubation first requires free pet inventory space. If the pet inventory is full, the completed egg stays redeemable, no pet is created, and later queue jobs are not blocked by the unclaimed result.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables and equipment are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Cosmetic hats are represented as one-time unlock progression rows and are shown in a tiled locked/unlocked catalog. Unhatched eggs, consumables, and equipment expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.

## Completed: Twitch reward ingestion milestone

Implemented persisted Twitch setup state, broadcaster setup OAuth, EventSub sync/status persistence, subscription/gift-sub/Bits voucher handling, subscription and Bits backfill tables, setup/admin observability, revocation repair state, and documentation of Twitch historical replay limitations. Follow-up test work should add a real API test harness when the project introduces one; package scripts currently only contain placeholder tests.

- Duplicate pet training implemented: active same-species duplicate materials can be consumed into one target, training points/levels/stat bonuses are calculated server-side, ledgered transactionally, and reversible by admins when no newer dependent training event exists.

## erwin-gateway migration follow-ups

- Keep the current gateway path observe-only until production/staging delivery counts match the old direct Twitch path.
- Add active gateway redemption processing only after explicitly requested; it must ledger every economy mutation and remain idempotent by gateway event id and Twitch redemption id.
- Add gateway redemption fulfill/cancel calls only in a later PR after reward grants are durable and retry-safe.
- Replace direct stream/profile/schedule reads with gateway `GET /api/v1/streams/current` and related APIs after smoke checks are stable.
- Remove direct Twitch EventSub/reward/token ownership only after the gateway cutover has rollback coverage.

## PR 2 completed: gateway redemption observe-only ingestion

- [x] Added runtime-admin-synced gateway reward mappings for local Hatchery reward types.
- [x] Extended the erwin-gateway app client with reward sync/list, create/update, redemption status, and redemption list helpers.
- [x] Moved egg Channel Point custom reward authority to Hatchery: the admin panel now syncs gateway rewards directly from `egg_types`, with Beta Ei as the active Channel Point egg type and Starter Ei preserved as the ledgered first egg.
- [x] Normalized signed gateway Channel Point redemption add/update webhooks into Hatchery redemption cache rows.
- [x] Kept observe-only as the default: no Mystery Egg grants, no egg-grant ledger entries, and no gateway fulfill/cancel calls.
- [x] Stored unknown rewards for diagnostics and made duplicate delivery/event/redemption processing safe.
- [ ] Implement active post-observe redemption economy effects in a later PR.
