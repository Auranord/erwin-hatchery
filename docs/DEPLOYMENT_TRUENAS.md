# Deployment: TrueNAS SCALE + Traefik

## Target

- TrueNAS SCALE host
- Existing Traefik reverse proxy with HTTPS
- Host: `hatchery.auranord.net`
- Image: `ghcr.io/auranord/erwin-hatchery`
- PostgreSQL container in same stack
- Persistent mounted dataset

## Dataset layout example

```text
/mnt/tank/apps/erwin-hatchery/postgres
/mnt/tank/apps/erwin-hatchery/backups
/mnt/tank/apps/erwin-hatchery/uploads
```

## Services

Expected stack:

- `postgres`
- `init`: one-shot migrate + seed job
- `api`: Fastify API and optionally static frontend serving

Startup order:

1. run migrations
2. run seeds
3. start API

The API must not serve traffic with a half-prepared database.

## Environment basics

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgres://...
PUBLIC_APP_URL=https://hatchery.auranord.net
SESSION_SECRET=...
OVERLAY_SECRET=...
```

If using separate frontend/API origins:

```env
PUBLIC_APP_URL=https://hatchery.auranord.net
PUBLIC_API_URL=https://api.hatchery.auranord.net
CORS_ORIGIN=https://hatchery.auranord.net
```

## Gateway env

Safe disabled/default shape:

```env
ERWIN_GATEWAY_ENABLED=false
ERWIN_GATEWAY_OBSERVE_ONLY=true
ERWIN_GATEWAY_REQUIRED=false
ERWIN_GATEWAY_URL=https://erwin-gateway.auranord.net
ERWIN_GATEWAY_APP_API_KEY=<full raw app API key>
ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET=<app webhook signing secret>
ERWIN_GATEWAY_WEBHOOK_MAX_AGE_SECONDS=300
ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=false
```

For staging gateway tests:

```env
ERWIN_GATEWAY_ENABLED=true
ERWIN_GATEWAY_OBSERVE_ONLY=true
ERWIN_GATEWAY_REQUIRED=false
```

For active redemption grants after validation:

```env
ERWIN_GATEWAY_OBSERVE_ONLY=false
ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=true
```

## Health

```text
GET /api/health
GET /api/admin/health
GET /api/erwin-gateway/smoke
GET /api/erwin-gateway/diagnostics
```

Use `/api/admin/health` as readiness when available because it validates seed prerequisites.

## First deploy/check

1. Push branch/tag and let GHCR build.
2. Pull image in TrueNAS.
3. Run stack.
4. Confirm init migration/seed success.
5. Check `/api/health`.
6. Check `/api/admin/health`.
7. If gateway enabled, check `/api/erwin-gateway/smoke`.
8. Send gateway test webhook and confirm `2xx`.
9. Verify no secrets appear in logs.

## Backup

Minimum MVP:

- daily `pg_dump`
- compressed
- encrypted if off-box
- keep at least 7 daily backups

## Rollback

- keep previous working GHCR image tag
- switch image tag back on failure
- restore DB only when migration/data caused damage
- avoid destructive migrations during MVP unless DB wipe is intentionally accepted
