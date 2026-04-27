# Erwin Hatchery

**Erwin Hatchery** is a mobile-first Twitch community minigame for NTKOH.

Viewers redeem Twitch Channel Points, called **eggs**, to receive mystery eggs in a web app. Eggs can become hidden pet eggs or crack into resources. Pets hatch over time, can later be trained/equipped/styled, and can participate in stream events such as a simple battle/leaderboard event.

The MVP is designed for a small Twitch Affiliate channel, self-hosted on TrueNAS SCALE behind Traefik, with containers built through GitHub Actions and published to GitHub Container Registry.

## Core MVP loop

1. Viewer redeems Twitch Channel Point reward: `1x Mystery Ei` for 500 channel points.
2. Backend receives the EventSub redemption and creates one mystery egg for that Twitch user.
3. Viewer can log in with Twitch to use the web UI.
4. Viewer identifies eggs in the app.
5. Identified eggs either:
   - become cracked egg resources, or
   - move into a hidden pet egg inventory.
6. Viewer chooses hidden pet eggs to incubate.
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
- `docker-compose.example.yml`: deployment reference
- `.env.example`: environment variables

## Phase 1 implementation status

The current repo implementation includes:

- TypeScript monorepo (`apps/web`, `apps/api`, `packages/shared`)
- React + Vite frontend shell
- Fastify backend with `GET /api/health`
- PostgreSQL client and Drizzle schema/migration scaffolding
- Local `docker-compose.yml` and production Dockerfile

Not yet implemented in Phase 1:

- Twitch OAuth/EventSub integration
- Game economy and battle logic

## Local development commands

```bash
pnpm install
pnpm dev
pnpm db:migrate
pnpm build
```

Local Docker run:

```bash
docker compose up --build
```
