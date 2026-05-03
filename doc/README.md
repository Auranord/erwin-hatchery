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
10. Admin starts a battle event from the admin panel. MVP randomly chooses 1st, 2nd, and 3rd place from selected pets.
11. Winners receive leaderboard points (3/2/1). Event is logged and selected pets are deselected after resolution.

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

## Implementation status snapshot

Last reevaluated: **2026-05-03**.

The current repo implementation includes:

- TypeScript monorepo (`apps/web`, `apps/api`, `packages/shared`)
- React + Vite frontend shell with authenticated player inventory, incubate/finish hatch actions, pet event selection, and public leaderboard view
- Fastify backend with `GET /api/health` and `GET /api/admin/health` readiness checks
- PostgreSQL + Drizzle schema/migration scaffolding and MVP seed scripts
- Twitch OAuth login/logout and `/api/me` identity route
- Twitch EventSub webhook ingestion with signature validation, idempotent redemption processing, and subscription auto-sync diagnostics
- Admin foundation: user search/detail, role mutation, admin action logs, ledger view, test mystery egg/incubator grants, and ledger revert
- Production Dockerfile for GHCR image builds

Still pending for later milestones:

- Stream-state incubation multipliers (live/viewer-based acceleration)
- Admin lifecycle controls (freeze/reset/delete progress and fuller role lifecycle)
- Battle event persistence/revert completeness, overlays, and bits/sub feature foundation
- Deployment hardening milestones beyond the current baseline

## Admin testing seed dependency

Admin test mystery egg grants allow active or inactive mystery egg types in `egg_types`; inactivity is informational only for admin grants. The expected seeded defaults are `common_mystery_egg`, `uncommon_mystery_egg`, and `rare_mystery_egg`.

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

## Incubation countdown quirk (known behavior)

- The player UI computes remaining incubation time from the browser clock (`Date.now()`) to reduce polling and keep traffic lower.
- If a player's system clock is wrong (ahead/behind), the shown remaining timer can be significantly incorrect.
- API hatch validation remains server-authoritative. The backend decides whether finish is too early based on server time.
- Operational symptom: an egg may still appear as `incubating` in the UI even when enough real time has passed, until the client-side countdown reaches zero and the finish action is triggered.
- Troubleshooting: first verify/correct the device system clock (including automatic time sync) before investigating backend incubation logic.



## EventSub webhook processing (Milestone 3)

- Endpoint: `POST /api/twitch/eventsub`
- Verifies Twitch EventSub HMAC signature using `TWITCH_EVENTSUB_SECRET` and raw request body.
- Supports webhook challenge verification requests and returns plain-text challenge.
- Stores every unique EventSub notification in `twitch_events` keyed by Twitch event ID for idempotency.
- Processes only `channel.channel_points_custom_reward_redemption.add` notifications for reward IDs that are mapped to active egg types in the database.
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
- Admin custom reward sync endpoint: `POST /api/admin/twitch/custom-rewards/sync` creates/updates Twitch channel point rewards for active egg types and removes rewards for inactive egg types.


- EventSub auto-sync for channel point redemptions requires broadcaster OAuth scope `channel:read:redemptions channel:manage:redemptions`.
- If debug status shows missing authorization, logout/login once with broadcaster account to refresh stored token scopes.
