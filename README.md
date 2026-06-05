# Erwin Hatchery

Erwin Hatchery is a mobile-first Twitch community minigame for **NTKOH**.

Viewers redeem the Hatchery-synced Twitch Channel Point reward for a **Beta Ei**, collect mystery eggs, identify them into pet eggs or cracked egg resources, incubate pet eggs while the stream is live, hatch fantasy birds, and send a selected pet into admin-started stream events.

The project is self-hosted on TrueNAS SCALE behind Traefik, built with GitHub Actions, and published to GitHub Container Registry.

## Links

- Twitch: [NTKOH on Twitch](https://www.twitch.tv/notthatkindofheroes)
- Stable app: [hatchery.auranord.net](https://hatchery.auranord.net)
- Testing app: [test.hatchery.auranord.net](https://test.hatchery.auranord.net)

## Current status

The project is in MVP development.

Implemented or partially implemented areas include:

- Twitch login and provisional users
- mystery egg inventory
- egg identification
- incubation and hatching
- pet collection
- cracked egg resources
- weekly shop and subscriber shop foundations
- admin testing tools
- simple battle/leaderboard events
- OBS overlays
- erwin-gateway integration for Channel Point reward transport and redemption webhooks

The gateway migration is in progress. `erwin-gateway` owns Twitch transport, while Hatchery owns game/economy meaning.

## Safety rules

Erwin Hatchery is designed to stay conservative around Twitch and German compliance risk.

- Channel Points may create random mystery eggs.
- All rewards are stream-only digital items with no real-world value.
- Items cannot be traded, sold, transferred, cashed out, or redeemed for prizes.
- The game does not award giveaway tickets, money, merch, game keys, gift cards, or other real prizes.
- No betting or wagering is allowed.
- Bits and subscriptions must only trigger fixed and clearly described perks.
- Bits and subscriptions must not trigger random eggs, random pets, mystery rewards, or prize chances.

## Tech stack

- TypeScript
- React + Vite
- Fastify API
- PostgreSQL
- Drizzle ORM
- Docker
- GitHub Container Registry
- TrueNAS SCALE deployment
- Traefik reverse proxy
- Twitch OAuth
- erwin-gateway for Twitch transport

## Branches

- `dev`: active development
- `testing`: test deployment
- `main`: stable production deployment

Container images are built through GitHub Actions and published to GHCR.

## Documentation map

Start with:

- `AGENTS.md`: Codex routing and project rules

Current compact docs:

- `docs/PRODUCT_MVP.md`: current game loop, feature scope, and gameplay rules
- `docs/ARCHITECTURE_RUNTIME.md`: runtime architecture, app/backend/frontend responsibilities, overlays
- `docs/DATA_MODEL_COMPACT.md`: database concepts, invariants, and key tables
- `docs/SECURITY_COMPLIANCE.md`: Twitch/Germany/compliance, secrets, economy guardrails
- `docs/DEPLOYMENT_TRUENAS.md`: TrueNAS, Traefik, GHCR, env vars, operations
- `docs/GATEWAY_HATCHERY_INTEGRATION.md`: implementation reference for Hatchery ↔ erwin-gateway
- `docs/GATEWAY_MUSIC_INTEGRATION.md`: implementation reference for Music ↔ erwin-gateway
- `docs/CURRENT_TASKS.md`: active work and near-term task state

Archive docs:

- `docs/archive/*`: old milestones, historical plans, and pre-compaction references. Do not use as the primary source of truth unless historical context is needed.

## Local development

```bash
pnpm install
pnpm dev
pnpm db:migrate
pnpm db:seed
pnpm build
```

## Deployment target

- Public host: `hatchery.auranord.net`
- Testing host: `test.hatchery.auranord.net`
- Backend container on TrueNAS SCALE
- PostgreSQL container with mounted dataset
- Existing Traefik reverse proxy with HTTPS
- Container registry: `ghcr.io/auranord/erwin-hatchery`

## Repository visibility and license

This repository is public for transparency, collaboration, review, and issue tracking.

It is **source-available**, not open source.

You may view the code and submit pull requests, but you may not deploy, redistribute, publish modified versions, or create derivative works without written permission.

See [`LICENSE.md`](./LICENSE.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Contributing

Contributions are welcome only under the terms in `LICENSE.md` and `CONTRIBUTING.md`.

Before opening a pull request, please read:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`AGENTS.md`](./AGENTS.md)

By submitting a pull request, you agree that Auranord may use, modify, sublicense, and relicense your contribution as part of Erwin Hatchery or related NTKOH projects.

## Security

Please do not open public issues for security problems.

Security-sensitive reports should be sent privately to the project maintainer.

## Association

Erwin Hatchery is an NTKOH community project.

It is not an official Twitch product and is not endorsed by Twitch.
