# Deployment - TrueNAS SCALE + Traefik

## Target setup

- TrueNAS SCALE host
- Existing Traefik reverse proxy
- Public HTTPS already handled by Traefik
- App URL: `hatchery.auranord.net`
- Container image: `ghcr.io/auranord/erwin-hatchery`
- Database: PostgreSQL container in same YAML stack
- Persistent database storage: mounted TrueNAS dataset

## Recommended dataset layout

Example:

```text
/mnt/tank/apps/erwin-hatchery/postgres
/mnt/tank/apps/erwin-hatchery/backups
/mnt/tank/apps/erwin-hatchery/uploads
```

Adjust to the actual TrueNAS pool/dataset names.

## Deployment modes

### Mode A: simplest all-in-one web serving

The API container also serves the built React app from `apps/web/dist` (built during Docker image build). Traefik routes all `hatchery.auranord.net` traffic to the API container. `GET /` must return the frontend page, unknown non-API routes should fallback to `index.html`, and API stays namespaced under `/api/*`.

Pros:

- simplest setup
- one domain
- no Cloudflare Pages needed

Cons:

- static traffic hits home server unless Cloudflare cache is configured

### Mode B: traffic-saving static frontend

Cloudflare Pages serves the React app. TrueNAS serves only API/EventSub/SSE.

Recommended host split:

```text
hatchery.auranord.net      -> Cloudflare Pages frontend
api.hatchery.auranord.net  -> TrueNAS API via Traefik
```

Pros:

- much less traffic on home internet
- frontend remains online even if API is briefly down

Cons:

- needs another DNS route/subdomain
- CORS/cookie setup must be correct

For MVP, implement the code so both modes are possible.

## TrueNAS YAML / Compose reference

Use `truenas-deployment.yml` as the single deployment template. Adjust datasets, image tag, and Traefik labels based on your TrueNAS Apps setup.

Expected services:

- `init`: one-shot migration+seed job (`db:migrate` then `db:seed`)
- `api`: Erwin Hatchery backend container
- `postgres`: PostgreSQL database

Expected networks:

- internal app network for API ↔ Postgres
- external Traefik/proxy network for API public access

## Environment variables

Copy `.env.example` to your TrueNAS app environment and fill values.

Important values for Milestone 1 foundation:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgres://...
PUBLIC_APP_URL=https://hatchery.auranord.net
```

Values below are already documented in `.env.example` but are only required once Twitch/Auth/EventSub milestones are implemented:

```text
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_BROADCASTER_ID=...
TWITCH_EVENTSUB_SECRET=...
SESSION_SECRET=...
OVERLAY_SECRET=...
```

If using Cloudflare Pages frontend and API subdomain:

```text
PUBLIC_APP_URL=https://hatchery.auranord.net
PUBLIC_API_URL=https://api.hatchery.auranord.net
CORS_ORIGIN=https://hatchery.auranord.net
```

## GitHub Actions / GHCR

The workflow builds and pushes images to GitHub Container Registry.

Image tags:

```text
dev branch      -> ghcr.io/auranord/erwin-hatchery:dev
testing branch  -> ghcr.io/auranord/erwin-hatchery:testing
main branch     -> ghcr.io/auranord/erwin-hatchery:main
main branch     -> ghcr.io/auranord/erwin-hatchery:stable
main branch     -> ghcr.io/auranord/erwin-hatchery:latest
every commit    -> ghcr.io/auranord/erwin-hatchery:sha-<shortsha>
```

MVP deployment is manual:

1. Push to `dev`.
2. GitHub builds image.
3. TrueNAS pulls the selected tag.
4. Start/update the stack; the `init` service runs migrations and seed data automatically, then exits successfully.
5. API starts only after `init` completes successfully (plus Postgres health), so traffic is not routed before DB bootstrap finishes.
6. Verify logs and health endpoint.

API container startup order is enforced in-container:

1. `node dist/db/migrate.js`
2. `node dist/db/seed.js`
3. `node dist/server.js`

The production image runs the compiled JavaScript files directly instead of invoking `pnpm` at runtime. This keeps startup independent from Corepack/package-manager cache writes in the read-only `/app` deployment tree. The startup script logs each step with a `[startup]` prefix and exits immediately on migrate/seed failure, so the server will not boot with a partially prepared database.

The MVP database is currently treated as redeployable from scratch: Drizzle migrations are consolidated into the single base schema migration, and legacy incremental migration support has been removed. Preserve or export production data before replacing a mounted Postgres dataset.

Seeding is idempotent: baseline records are upserted, and the mystery egg loot table is rebuilt deterministically on each run so repeated restarts converge on the same state.

Prerequisite: at least one active egg type must exist before API startup and admin operations. The startup seed step ensures this baseline exists; `GET /api/admin/health` still returns `503` with `NO_ACTIVE_EGG_TYPES` if seed is skipped or fails.

## Health endpoint

Backend must expose:

```text
GET /api/health
```

Expected response:

```json
{"ok":true,"database":"ok","version":"..."}
```

Admin/game-economy readiness check:

```text
GET /api/admin/health
```

Expected response when configured correctly:

```json
{"ok":true,"code":"OK"}
```

Expected response when seed prerequisite is missing:

```json
{"ok":false,"code":"NO_ACTIVE_EGG_TYPES","message":"No active egg types configured."}
```

Use `GET /api/admin/health` as the container health/readiness probe so orchestrators wait for init completion and seed prerequisites before routing traffic.

## Backup plan

Minimum backup:

- daily `pg_dump`
- gzip or zstd compression
- encrypted if stored off-box
- keep at least 7 daily backups

MVP can start with a simple cron job on TrueNAS or a small backup sidecar later.

## Rollback plan

- Keep previous working GHCR image tag.
- If deployment breaks, set TrueNAS image tag back to previous SHA/stable tag.
- Restore DB only if migration caused irreversible damage.
- Avoid destructive migrations during MVP.

## Local testing before deployment

Minimum checks before pushing to `testing` or `main`:

```bash
pnpm lint
pnpm test
pnpm build
pnpm db:migrate
pnpm db:seed
```

Codex should add these scripts to `package.json` during implementation.


## EventSub auto-sync operations

Set and verify the following production env vars:

- `TWITCH_BROADCASTER_ID`
- `TWITCH_EVENTSUB_SECRET`
- `PUBLIC_APP_URL` must be the public HTTPS origin so callback resolves to `${PUBLIC_APP_URL}/api/twitch/eventsub`.
- `TWITCH_EVENTSUB_AUTO_SYNC=true` (set `false` to disable startup sync)

Troubleshooting:

1. Check API logs for `EventSub sync failed` and HTTP status hints.
2. Call `GET /api/admin/debug/eventsub-subscription?refresh=true` as admin/owner.
3. Verify callback URL reachability and Twitch app credentials.


- EventSub auto-sync for channel point redemptions requires broadcaster OAuth scope `channel:read:redemptions channel:manage:redemptions channel:read:subscriptions`.
- If debug status shows missing authorization, logout/login once with broadcaster account to refresh stored token scopes.

## First-run Twitch setup on TrueNAS

Set `TWITCH_BITS_PER_VOUCHER` and the Twitch OAuth/EventSub variables before first boot. After migrations run, open the web app and complete the German setup screen with the configured broadcaster account. The app will persist setup state, sync EventSub subscriptions against `PUBLIC_APP_URL/api/twitch/eventsub`, run active-subscription backfill, and import the Bits leaderboard baseline.

If OAuth scopes are revoked or EventSub is revoked/unhealthy, the UI enters repair state. Use the admin/setup buttons to re-run health checks, resync EventSub, continue backfill, or reauthenticate the broadcaster. No automatic production deployment is added by this milestone.

## erwin-gateway foundation deployment variables

Gateway integration is safe to deploy disabled or observe-only while Hatchery still uses its direct Twitch path:

```env
ERWIN_GATEWAY_ENABLED=false
ERWIN_GATEWAY_OBSERVE_ONLY=true
ERWIN_GATEWAY_REQUIRED=false
ERWIN_GATEWAY_URL=https://gateway.example.com
ERWIN_GATEWAY_APP_API_KEY=<secret app key>
ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET=<secret webhook signing key>
ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS=300
```

For staging observe-only tests, set `ERWIN_GATEWAY_ENABLED=true`, keep `ERWIN_GATEWAY_OBSERVE_ONLY=true`, and leave `ERWIN_GATEWAY_REQUIRED=false` until gateway availability and credentials are proven. Configure the gateway app webhook URL to `https://<hatchery-host>/erwin-gateway/webhook`. Do not enable active reward granting or redemption fulfill/cancel during this foundation phase.

After deployment, validate `GET /api/health`, then `GET /api/erwin-gateway/smoke`, then send a signed test webhook from the gateway Admin UI and confirm a `2xx` response plus a `gateway_webhook_events` row.

## Erwin Gateway Channel Point observe-only ingestion

Hatchery now receives Channel Point custom reward redemption transport from `erwin-gateway`; the gateway owns Twitch EventSub delivery, webhook signing, and app API transport, while Hatchery owns reward mapping and all economy decisions. `ERWIN_GATEWAY_OBSERVE_ONLY=true` remains the default so real redemption webhooks are verified, deduped, stored, and mapped without granting Mystery Eggs, writing egg-grant ledger entries, or calling gateway fulfill/cancel.

Reward mappings are created at runtime from the admin panel's erwin-gateway reward sync. Admins choose the gateway reward and local Hatchery reward type; Hatchery persists the gateway reward ID and Twitch reward ID plus enabled state, last sync time, and metadata. Unknown rewards are stored with `mapping_status='unknown'` for diagnostics and are ignored safely rather than crashing or mutating inventory.

Duplicate gateway deliveries are safe: Hatchery dedupes by gateway delivery ID and gateway event ID before processing. The Channel Point redemption cache is also upserted by Twitch redemption ID so add/update events and retries cannot create duplicate redemption rows or repeated economy effects. Database wipes are acceptable during development, but this idempotency model is still required for the production path.

Inspection endpoints:

- `GET /api/erwin-gateway/smoke` checks gateway app authentication.
- `GET /api/erwin-gateway/diagnostics` returns observe-only status, reward mappings, recent gateway redemption events, recent cached Channel Point redemptions, unmapped rewards, and ignored events.
- Admins use `GET /api/admin/erwin-gateway/rewards` and `POST /api/admin/erwin-gateway/rewards/sync` from the admin panel to sync gateway rewards and create local Hatchery reward mappings at runtime.
