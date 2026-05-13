# Erwin Hatchery

**Erwin Hatchery** is a mobile-first Twitch community minigame for NTKOH.

Viewers redeem Twitch Channel Points, called **eggs**, to receive mystery eggs in a web app. Eggs can become unhatched eggs or crack into resources. Pets hatch over time with species-based permanent base stats, can later be trained and styled with cosmetic hats, and can participate in stream events such as a simple battle/leaderboard event.

The MVP is designed for a small Twitch Affiliate channel, self-hosted on TrueNAS SCALE behind Traefik, with containers built through GitHub Actions and published to GitHub Container Registry.

## Core MVP loop

1. Viewer redeems Twitch Channel Point reward: `1x Mystery Ei` for 500 channel points.
2. Backend receives the EventSub redemption and creates one mystery egg for that Twitch user.
3. Viewer can log in with Twitch to use the web UI.
4. Viewer identifies eggs in the app.
5. Identified eggs either:
   - become cracked egg resources, or
   - move into an unhatched egg inventory.
6. Viewer chooses unhatched eggs to incubate.
7. The incubator accepts queued eggs; countdown progress is accumulated only while the stream is live.
8. Finished pet eggs hatch into owned pet instances with permanent base stats derived from species defaults plus hatch variance.
9. Viewer selects one pet for the next admin-started stream event by dropping or tap-selecting it into the Event-Pet slot above the pet inventory; the pet remains highlighted in its normal inventory slot. Pets can also be dragged to a trashcan-style `Verwerten` slot, confirmed, and scrapped into Aufgebrochene Eier based on rarity recycle metadata. Pet inventory deliberately has no rewardless `Verwerfen` slot; other discardable slotted inventories keep their confirmed deletion flow without a resource reward.
10. Admin starts a battle event from the admin panel. MVP randomly chooses 1st, 2nd, and 3rd place from selected pets.
11. Winners receive leaderboard points (3/2/1). Event is logged and selected pets are deselected after resolution.


## Pet RPG model direction

- `pet_species` defines species templates, default stats, fixed rarity/class/element assignments, and the default ability; `pets` stores owned instances with permanent base stats, copied rarity/class/element IDs, and an individual `ability_id` copied from the species at hatch so later training can change that one pet without changing the species template.
- Rarity is display/economy/combine/recycle metadata only and must not be used as a stat multiplier.
- Each seeded MVP pet has exactly one class, one element, and the shared `beta_instinct` MVP baseline ability. No traits are included in the seeded MVP pet pool. Hats are cosmetic only. Equipment seeding includes gem-themed gear in three tiers with config-only stat bonuses: +1/+2/+3 for ATK, DEF, SPD, GAIN, and POW, plus +10/+20/+30 HP.
- Future boss-event AP, current HP, attack counts, effective stats, class stacks, and element stacks are runtime participant state, not pet state. Ability logic is documentation-only for now: attacks grant 20 base AP, GAIN modifies AP gain, POW scales ability effects, and abilities auto-trigger after meeting AP and minimum-attack requirements.

## Public vs authenticated access

Public without Twitch login:

- Leaderboard
- Public event results
- Maybe stream overlay pages, if route secret is configured

Requires Twitch login:

- Inventory, including separate consumable, equipment, and cosmetic hat grids
- Egg identification
- Incubation
- Pet selection, cosmetic hat styling
- Consumables/upgrades
- Account deletion

Channel Point redemptions can be received before the viewer logs in. The backend creates a provisional player record using the Twitch user ID from the redemption. The first Twitch login links that player to the interactive account view.

## Deployment target

- Public host: `hatchery.auranord.net`
- Backend container on TrueNAS SCALE
- PostgreSQL container with mounted dataset
- Existing Traefik reverse proxy with HTTPS
- Container registry: `ghcr.io/auranord/erwin-hatchery`

## Documentation map

- `AGENTS.md`: Codex operating instructions
- `MVP_SPEC.md`: game rules and MVP scope
- `ARCHITECTURE.md`: system architecture and tech stack
- `DATA_MODEL.md`: database/entity design
- `SECURITY_AND_COMPLIANCE.md`: Twitch/Germany/legal/security guardrails
- `DEPLOYMENT_TRUENAS.md`: TrueNAS + Traefik deployment guide
- `CODEX_TASKS.md`: implementation checklist
- `.github/workflows/docker.yml`: GHCR build workflow
- `.env.example`: environment variables

## Implementation status snapshot

Last reevaluated: **2026-05-13**.

The current repo implementation includes:

- TypeScript monorepo (`apps/web`, `apps/api`, `packages/shared`)
- React + Vite frontend shell with authenticated slotted player inventory, separate nonstackable consumable/equipment/hat grids, queue/incubate/finish hatch actions, pet event selection, persisted weekly shop offers, monthly Gutschein subscriber-shop pet-hat offers, and public leaderboard view
- Fastify backend with `GET /api/health` and `GET /api/admin/health` readiness checks
- PostgreSQL + a consolidated Drizzle base schema migration and MVP seed scripts
- Twitch OAuth login/logout and `/api/me` identity route
- Twitch EventSub webhook ingestion with signature validation, idempotent redemption processing, subscription/gift subscription auto-sync diagnostics, subscriber status cache updates, and fixed Gutschein grants
- Admin foundation: user search/detail, role mutation, admin action logs, ledger view, test mystery egg grants, and ledger revert
- Battle event flow with persisted results, leaderboard awards, and admin revert action
- Secret-protected OBS overlays (`/overlay/alerts`, `/overlay/battle`) with SSE-backed live updates
- Production Dockerfile for GHCR image builds plus a TrueNAS example deployment with Postgres, init migration/seed job, and container health checks

Still pending for later milestones:

- Admin lifecycle controls (freeze/reset/delete progress and fuller role lifecycle)
- Bits EventSub foundation and fixed, non-random Bits effects
- Deployment hardening beyond the current baseline: rate limiting, explicit CORS middleware, and backup/restore scripts or notes

## Admin testing seed dependency

Admin test mystery egg grants allow active or inactive mystery egg types in `egg_types`; inactivity is informational only for admin grants. The expected seeded default is the single active `beta_egg` (`Beta Ei`).

Operators should verify seed state with the admin active egg type endpoint before testing grants:

```text
GET /api/admin/egg-types/active
```

## Local development commands

```bash
pnpm install
pnpm dev
pnpm db:migrate
pnpm db:seed
pnpm build
```

## Incubation queue behavior

- The player UI shows two standard incubator queue slots at launch.
- Dropping an egg into an empty incubator queue slot removes it from the unhatched egg inventory and creates a queued incubation job.
- If the stream is live and no other egg is running, the backend automatically starts the first queued egg.
- When a running egg reaches its required progress, the backend marks that incubation as completed and waiting to be claimed before pet redemption, so the next queued egg can begin immediately while the finished pet remains available to collect.
- Countdown progress is server-authoritative and accumulates only while Twitch stream state is live. When the stream is offline, queued/running eggs stay in place but do not gain progress.
- The UI refreshes the inventory stream regularly so queued/running/completed state and live-progress countdowns stay close to backend state.

## EventSub webhook processing (Milestone 3)

- Endpoint: `POST /api/twitch/eventsub`
- Verifies Twitch EventSub HMAC signature using `TWITCH_EVENTSUB_SECRET` and raw request body.
- Supports webhook challenge verification requests and returns plain-text challenge.
- Stores every unique EventSub notification in `twitch_events` keyed by Twitch event ID for idempotency.
- Processes only `channel.channel_points_custom_reward_redemption.add` notifications for reward IDs that are mapped to active egg types in the database.
- Creates a provisional user by Twitch user ID when needed.
- Increments the configured mystery egg inventory, currently `beta_egg`, by +1 and writes an immutable `economy_ledger` entry.
- Resolves the mystery egg outcome later when the player identifies/opens the egg. The seeded Beta Ei table now grants a pet about one third of the time and `cracked_eggs` resources about two thirds of the time, split evenly across 50, 100, and 200 resource outcomes.
- Replay-safe: duplicate EventSub event IDs and duplicate redemption IDs are ignored.

## EventSub subscription auto-sync (Milestone 3+)

- On API startup, the backend can automatically ensure the required Twitch EventSub subscriptions exist for:
  - `channel.channel_points_custom_reward_redemption.add`
  - `channel.subscribe`
  - `channel.subscription.message`
  - `channel.subscription.end`
  - `channel.subscription.gift`
- Required env vars: `TWITCH_BROADCASTER_ID`, `TWITCH_EVENTSUB_SECRET`.
- EventSub callback URL is derived from `PUBLIC_APP_URL` + `/api/twitch/eventsub`.
- `TWITCH_EVENTSUB_AUTO_SYNC=true` (default) enables startup sync; set to `false` to disable automatic management.
- `TWITCH_SUBSCRIPTION_RENEWAL_DAYS=31` controls the rolling subscriber status cache end time when subscribe/resubscribe events are received.
- On API startup, subscriber status is first synchronized from Twitch Helix `Get Broadcaster Subscriptions` and cached onto `users.is_subscriber` / `users.subscriber_ends_at`.
- If Twitch subscription sync fails (for example token/scope issues), startup falls back to replaying stored `twitch_events` (`channel.subscribe`, `channel.subscription.message`, `channel.subscription.end`) within the last `TWITCH_SUBSCRIPTION_RENEWAL_DAYS`.
- Admin debug endpoint: `GET /api/admin/debug/eventsub-subscription` (use `?refresh=true` for an on-demand live re-check).
- Admin custom reward sync endpoint: `POST /api/admin/twitch/custom-rewards/sync` creates/updates Twitch channel point rewards for active egg types and removes rewards for inactive egg types.

- EventSub auto-sync for channel point redemptions requires broadcaster OAuth scope `channel:read:redemptions channel:manage:redemptions channel:read:subscriptions`.
- If debug status shows missing authorization, logout/login once with broadcaster account to refresh stored token scopes.

## Twitch reward-ingestion setup

A fresh deployment starts in a Twitch setup/repair state until the configured broadcaster completes `/api/setup/twitch/login`. The setup OAuth flow must be completed by `TWITCH_BROADCASTER_ID` and requests `channel:read:subscriptions`, `channel:read:redemptions`, `channel:manage:redemptions`, and `bits:read`. The setup state is persisted in `twitch_integration_state`, so setup/backfill can resume after restarts.

Subscriptions, gift subs, and Bits grant fixed **Gutscheine** (`voucher`) only. Channel Points remain the only random egg source; paid support events never grant random rewards. Twitch does not provide complete historical EventSub replay. The setup backfill imports currently visible subscriptions and Bits leaderboard baselines best-effort only.
