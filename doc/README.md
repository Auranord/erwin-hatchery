# Erwin Hatchery

**Erwin Hatchery** is a mobile-first Twitch community minigame for NTKOH.

Viewers redeem Twitch Channel Points, called **eggs**, to receive mystery eggs in a web app. Eggs can become unhatched eggs or crack into resources. Pets hatch over time, can later be trained/equipped/styled, and can participate in stream events such as a simple battle/leaderboard event.

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
7. Incubation progresses over time and speeds up while the stream is live.
8. Finished pet eggs hatch into pets with type-based stats and slight per-pet variance.
9. Viewer selects one pet for the next admin-started stream event.
10. Admin starts a battle event. MVP randomly chooses 1st, 2nd, and 3rd place from selected pets.
11. Winners receive leaderboard points. Event is logged and can be reverted.

## Public vs authenticated access

Public without Twitch login:

- Leaderboard
- Public event results
- Maybe stream overlay pages, if route secret is configured

Requires Twitch login:

- Inventory
- Egg identification
- Incubation
- Pet selection
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

## Phase 1 implementation status

The current repo implementation includes:

- TypeScript monorepo (`apps/web`, `apps/api`, `packages/shared`)
- React + Vite frontend shell
- Fastify backend with `GET /api/health`
- PostgreSQL client and Drizzle schema/migration scaffolding
- Seed script for MVP egg types, pet types, and loot table
- Production Dockerfile for GHCR image builds

Not yet implemented in Phase 1:

- Twitch OAuth/EventSub integration
- Game economy and battle logic

## Admin testing seed dependency

Admin test mystery egg grants require at least one active mystery egg type in `egg_types` (`is_active = true`). The expected seeded defaults are `common_mystery_egg`, `uncommon_mystery_egg`, and `rare_mystery_egg`.

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



## EventSub webhook processing (Milestone 3)

- Endpoint: `POST /api/twitch/eventsub`
- Verifies Twitch EventSub HMAC signature using `TWITCH_EVENTSUB_SECRET` and raw request body.
- Supports webhook challenge verification requests and returns plain-text challenge.
- Stores every unique EventSub notification in `twitch_events` keyed by Twitch event ID for idempotency.
- Processes only `channel.channel_points_custom_reward_redemption.add` notifications for configured `TWITCH_CHANNEL_POINT_REWARD_ID`.
- Creates a provisional user by Twitch user ID when needed.
- Resolves mystery egg outcome at redemption time and stores unhatched egg immediately.
- Increments `common_mystery_egg` inventory by +1 and writes immutable `economy_ledger` entry.
- Replay-safe: duplicate EventSub event IDs and duplicate redemption IDs are ignored.


## EventSub subscription auto-sync (Milestone 3+)

- On API startup, the backend can automatically ensure the required Twitch EventSub subscription exists for `channel.channel_points_custom_reward_redemption.add`.
- Required env vars: `TWITCH_BROADCASTER_ID`, `TWITCH_EVENTSUB_SECRET`.
- EventSub callback URL is derived from `PUBLIC_APP_URL` + `/api/twitch/eventsub`.
- `TWITCH_EVENTSUB_AUTO_SYNC=true` (default) enables startup sync; set to `false` to disable automatic management.
- Admin debug endpoint: `GET /api/admin/debug/eventsub-subscription` (use `?refresh=true` for an on-demand live re-check).


- EventSub auto-sync for channel point redemptions requires broadcaster OAuth scope `channel:read:redemptions`.
- If debug status shows missing authorization, logout/login once with broadcaster account to refresh stored token scopes.
