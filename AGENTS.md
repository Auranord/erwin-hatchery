# AGENTS.md - Codex Instructions for Erwin Hatchery

## Project

Working title: **erwin-hatchery**.
Repository: `Auranord/erwin-hatchery`.
Primary goal: build a secure MVP for a Twitch-integrated, mobile-first egg hatching and pet battler minigame for the NTKOH stream.

## Read this first

This file is the routing guide for Codex. Do **not** read every document by default.

For every task:

1. Read this `AGENTS.md`.
2. Identify the task type.
3. Read only the documents listed for that task type.
4. Do not read `docs/archive/*` unless the user explicitly asks for historical context or an old implementation decision.
5. Prefer current compact docs over old milestone docs.
6. If a task touches a feature with safety or economy effects, always read `docs/SECURITY_COMPLIANCE.md`.

When in doubt, ask for the smallest missing context instead of loading every doc.

## Documentation routing

### General gameplay or product scope

Read:

- `docs/PRODUCT_MVP.md`
- `docs/SECURITY_COMPLIANCE.md`

Use for:

- game loop changes
- egg/pet/resource behavior
- subscriptions, Bits, or Channel Point reward meaning
- UI feature scope
- compliance-sensitive mechanics

### Runtime architecture, API, backend, frontend, or overlays

Read:

- `docs/ARCHITECTURE_RUNTIME.md`
- `docs/DATA_MODEL_COMPACT.md`
- `docs/SECURITY_COMPLIANCE.md`

Use for:

- Fastify routes
- React/mobile UI
- server-authoritative state
- SSE/overlay work
- admin routes
- game/economy mutations

### Database, migrations, seeds, and economy transactions

Read:

- `docs/DATA_MODEL_COMPACT.md`
- `docs/SECURITY_COMPLIANCE.md`

Use for:

- schema changes
- Drizzle migrations
- seed data
- ledger entries
- idempotency
- inventory and resource mutations

### erwin-gateway integration for Hatchery

Read:

- `docs/GATEWAY_HATCHERY_INTEGRATION.md`
- `docs/DATA_MODEL_COMPACT.md`
- `docs/SECURITY_COMPLIANCE.md`

Use for:

- `/erwin-gateway/webhook`
- gateway app API client
- Channel Point rewards
- reward adoption/mapping
- redemption ingestion
- redemption fulfill/cancel
- stream/sub/Bits gateway migration
- disabling old direct Twitch transport

### erwin-gateway integration for erwin-music

Read:

- `docs/GATEWAY_MUSIC_INTEGRATION.md`
- `docs/SECURITY_COMPLIANCE.md`

Use for:

- chat receive/send through gateway
- command intake
- static text command migration
- stream status for music features

### Deployment, TrueNAS, GHCR, env vars, or operations

Read:

- `docs/DEPLOYMENT_TRUENAS.md`
- relevant integration doc if the task touches gateway secrets
- `docs/SECURITY_COMPLIANCE.md` if secrets, cookies, OAuth, or webhook signatures are involved

### Planning or task status

Read:

- `docs/CURRENT_TASKS.md`
- only the specific feature doc routed above

Do not use old milestone checklists as the primary source of truth.

## Operating rules

- Prefer boring, maintainable TypeScript over clever abstractions.
- Keep the game economy server-authoritative. Never trust the browser for economy changes.
- User-facing UI should be mostly German. Internal docs, comments, APIs, and code should be English.
- Build mobile-first. Desktop should be acceptable, not the primary target.
- Keep downstream docs concise. Do not add broad documentation updates for small bugfixes unless behavior changes.
- For debugging tasks, make the smallest targeted change that proves or fixes the issue.
- Do not add new platform scope such as Discord unless explicitly requested.

## Economy and compliance rules

- Do not implement paid random rewards.
- Channel Points can create random mystery eggs only because outcomes are stream-only, non-transferable, and have no real-world value.
- Bits and subscriptions must be fixed and transparent. They must not grant random eggs, random pets, mystery rewards, prize chances, or giveaway entries.
- No trading, cash-out, marketplace, betting, wagering, paid lootbox, giveaway ticket, real prize, gift card, key, merch, or money reward mechanics.
- Avoid gambling language in UI and docs. Prefer: mystery egg, hatch, incubator, pet egg, cracked eggs, stream event, leaderboard points.

## Server-authoritative rules

- Every economy mutation must run inside a database transaction.
- Every economy mutation must create an immutable `economy_ledger` or game-event row.
- External Twitch/gateway events must be idempotent.
- Use gateway event IDs, gateway delivery IDs, Twitch EventSub message IDs, and Twitch redemption IDs as unique keys where applicable.
- Do not process redemptions for unknown or inactive reward mappings.
- Do not fulfill Twitch/Channel Point redemptions until local domain work has committed.
- Return `2xx` for duplicate already-recorded webhook deliveries without repeating side effects.
- The frontend may send intent only. It must never decide egg contents, pet species, stats, balances, battle winners, redemption status, or stream/sub/Bits state.

## erwin-gateway boundary

`erwin-gateway` owns Twitch transport:

- Twitch bot/broadcaster OAuth for gateway-owned Twitch features
- Twitch EventSub subscriptions
- raw Twitch webhook verification
- app-facing signed webhooks
- app API keys
- chat send/receive transport
- Channel Point reward transport
- redemption status transport
- stream/sub/Bits transport

`erwin-hatchery` owns gameplay and economy meaning:

- which egg types exist
- reward-to-egg mapping
- whether a redemption grants an egg
- economy ledger
- inventory state
- mystery egg identification
- pet/incubation systems
- fixed sub/Bits gameplay effects when implemented

## Code style

- TypeScript strict mode.
- No `any` unless justified with a comment.
- Keep API validation explicit, using Zod or equivalent.
- Use migrations for all database schema changes.
- Use structured logging.
- Never log access tokens, refresh tokens, webhook secrets, raw authorization headers, API keys, cookies, or Twitch tokens.
- Put all environment variables in `.env.example`.

## Branch workflow

Use three long-lived branches:

- `dev`: active development. Every commit builds a `dev` image.
- `testing`: pre-production testing. Every commit builds a `testing` image.
- `main`: stable production. Every commit builds `main`, `stable`, and `latest` images.

No direct production deployment from CI in the MVP. GitHub Actions should build and push containers to GHCR only. TrueNAS updates are manual.

## Recommended stack

- Frontend: React + Vite + TypeScript, static mobile-first PWA.
- Backend: Fastify + TypeScript.
- Database: PostgreSQL with mounted TrueNAS dataset.
- ORM/migrations: Drizzle.
- Realtime: Server-Sent Events for MVP alerts/overlay updates.
- Auth: Twitch OAuth login.
- Twitch transport: erwin-gateway for migrated Twitch features.
- Containers: Docker, built by GitHub Actions, pushed to GHCR.
- Reverse proxy: existing Traefik on TrueNAS SCALE.
