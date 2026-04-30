# AGENTS.md - Codex Instructions for Erwin Hatchery

## Project
Working title: **erwin-hatchery**.
Repository: `Auranord/erwin-hatchery`.
Primary goal: build a secure MVP for a Twitch-integrated, mobile-first egg hatching and pet battler minigame for the NTKOH stream.

## Operating rules for Codex
- Treat this document set as the source of truth for the MVP.
- Prefer boring, maintainable TypeScript over clever abstractions.
- Keep the game economy server-authoritative. Never trust the browser for economy changes.
- Do not implement paid random rewards. Channel Points can create random eggs. Bits/subs must be fixed and transparent.
- Every economy mutation must create an immutable ledger/game event row.
- All external Twitch events must be idempotent. Use Twitch redemption/event IDs as unique keys.
- Design database structures for future expansion: more egg types, pets, fusion, training, consumables, events, roles.
- User-facing UI should be mostly German. Internal docs, comments, APIs, and code should be English.
- Build mobile-first. Desktop should be acceptable, not the primary target.

## Branch workflow
Use three long-lived branches:

- `dev`: active development. Every commit builds a `dev` image.
- `testing`: pre-production testing. Every commit builds a `testing` image.
- `main`: stable production. Every commit builds `main`, `stable`, and `latest` images.

No direct production deployment from CI in the MVP. GitHub Actions should build and push containers to GHCR only. TrueNAS updates are manual at first.

## Required docs to keep current
When changing architecture, game rules, or deployment, update the relevant docs:

- `doc/README.md`
- `doc/MVP_SPEC.md`
- `doc/ARCHITECTURE.md`
- `doc/DATA_MODEL.md`
- `doc/SECURITY_AND_COMPLIANCE.md`
- `doc/DEPLOYMENT_TRUENAS.md`
- `doc/CODEX_TASKS.md`

## Recommended stack
- Frontend: React + Vite + TypeScript, static mobile-first PWA.
- Backend: Fastify + TypeScript.
- Database: PostgreSQL, running as a container with a mounted TrueNAS dataset.
- ORM/migrations: Drizzle ORM or Prisma. Prefer Drizzle for lightweight schema control.
- Realtime: Server-Sent Events for MVP alerts/overlay updates. WebSockets can be added later.
- Auth: Twitch OAuth login.
- Twitch events: EventSub webhooks.
- Containers: Docker, built by GitHub Actions, pushed to GHCR.
- Reverse proxy: existing Traefik on TrueNAS SCALE.

## Code style
- TypeScript strict mode.
- No `any` unless justified with a comment.
- Keep API validation explicit, using Zod or equivalent.
- Use migrations for all database schema changes.
- Use structured logging. Never log access tokens, refresh tokens, webhook secrets, or raw authorization headers.
- Put all environment variables in `.env.example`.

## Security rules
- Validate Twitch EventSub signatures before processing webhook payloads.
- Validate OAuth `state` and use secure cookies.
- Store Twitch user IDs as the stable identity key. Display names can change.
- Economy actions must be done inside database transactions.
- Idempotency is mandatory for Twitch redemptions, subscription events, Bits events, battle events, and admin actions.
- Admin actions must be permission-checked and ledgered.
- Account deletion must remove or anonymize personal user data while preserving non-personal audit integrity where needed.

## MVP non-goals
Do not implement these unless explicitly requested later:

- Pet fusion.
- Detailed pet training progression.
- Real prize giveaways.
- Trading between users.
- Cash-out or marketplace mechanics.
- Betting/wagering on battles.
- Paid random eggs via Bits or subs.
- Native Twitch Extension review flow.
- Automatic TrueNAS deployment from GitHub Actions.
