# Codex Task Plan - Erwin Hatchery MVP

## Progress status

- ✅ Milestone 0 foundation created.
- ✅ Milestone 1 foundation created (health route, DB connection, schema/migration scaffolding).
- ⏳ Milestone 2+ pending.


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
- Seed data for pet types, egg types, loot table.

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
- Process configured reward ID only.
- Create provisional user if needed.
- Create mystery egg with hidden outcome determined at redemption time.
- Idempotency by Twitch event/redemption ID.
- Ledger entry for egg creation.

Acceptance:

- Redeeming `1x Mystery Ei` creates exactly one egg.
- Replayed webhook does not duplicate egg.

## Milestone 4 - Player web UI MVP

- React + Vite mobile-first app.
- German UI labels.
- Login/logout.
- Show resource balance.
- Show mystery eggs.
- Identify egg action.
- Show hidden pet eggs.
- Show incubator slot(s).
- Start incubation.
- Show hatched pets.
- Select event pet.
- Public leaderboard page.

Acceptance:

- Logged-in user can go from egg -> identify -> incubate -> hatch -> select pet.

## Milestone 5 - Incubation engine

- Implement hatch progress calculation based on timestamps.
- Support offline/live multiplier config.
- Support viewer count multiplier field/config.
- Add manual/admin stream state override if live Twitch polling is not ready.
- Finish hatch action creates pet instance with stat variance.
- Ledger entries for incubation start and pet hatch.

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

- Admin can start battle event any time.
- Collect all selected pets.
- Randomly choose 1st/2nd/3rd from selected pets.
- Award leaderboard points 3/2/1.
- Deselect participating selected pets after event.
- Store event participants/result JSON.
- Ledger all point awards.
- Add revert battle action.

Acceptance:

- Battle result appears in admin UI and public leaderboard.
- Revert removes awarded points and marks event reverted.

## Milestone 8 - OBS overlays

- `/overlay/alerts`
- `/overlay/battle`
- Route token/secret protection.
- SSE connection to backend.
- Alert overlay shows hatch/rare hatch events.
- Battle overlay shows winners and pet placeholders.
- 1920x1080 safe layout.

Acceptance:

- OBS browser source can display alerts and battle results.

## Milestone 9 - Bits/sub event support foundation

- Add schema/event ingestion for sub/gift sub/Bits events.
- Do not add paid random eggs.
- Implement subscriber extra incubator if sub status can be reliably received.
- Bits effects should be fixed only and can remain disabled behind config.

Acceptance:

- Subbed users can receive one subscriber incubator.
- When sub ends, occupied slot finishes current egg and then disappears.

## Milestone 10 - Deployment hardening

- Docker image produces production build.
- Compose/YAML works with Postgres and Traefik.
- Health check.
- Basic rate limiting.
- CORS config.
- Secure cookies.
- Backup notes/scripts.
- Production env validation.

Acceptance:

- App runs on TrueNAS and survives restart with persistent DB.
