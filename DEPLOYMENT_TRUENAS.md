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

The API container also serves the built React app. Traefik routes all `hatchery.auranord.net` traffic to the API container.

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

Use `docker-compose.example.yml` as the starting point. TrueNAS YAML may require adjustments depending on the Apps UI and your existing Traefik network.
For a single-environment app YAML template (copy once per `dev` / `testing` / `main`) with dataset separation and `pull_policy: always`, see `truenas-multi-env.example.yml`.
A practical option is 2 dataset roots: `/mnt/fast/config/erwin-hatchery` for `main` and `/mnt/fast/config/erwin-hatchery-test` for `dev` + `testing`.

Expected services:

- `api`: Erwin Hatchery backend container
- `postgres`: PostgreSQL database

Expected networks:

- internal app network for API ↔ Postgres
- external Traefik/proxy network for API public access

## Environment variables

Copy `.env.example` to your TrueNAS app environment and fill values.

Important values:

```text
PUBLIC_APP_URL=https://hatchery.auranord.net
PUBLIC_API_URL=https://hatchery.auranord.net
DATABASE_URL=postgres://...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_BROADCASTER_ID=...
TWITCH_CHANNEL_POINT_REWARD_ID=...
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
4. Restart app.
5. Verify logs and health endpoint.

## Health endpoint

Backend must expose:

```text
GET /api/health
```

Expected response:

```json
{"ok":true,"database":"ok","version":"..."}
```

Traefik/monitoring can use this route.

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
```

Codex should add these scripts to `package.json` during implementation.
