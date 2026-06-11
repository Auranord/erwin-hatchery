# Current Tasks and Milestone State

This file should stay short. Move old milestone history into archived notes if needed.

## Current high-priority direction

1. Finish erwin-gateway migration for Hatchery Channel Point rewards/redemptions.
2. Ensure old direct Twitch EventSub redemption processing cannot duplicate active gateway grants.
3. Keep Hatchery authoritative for game/economy meaning of rewards.
4. Keep gateway authoritative for Twitch transport.
5. After Hatchery stabilizes, migrate erwin-music chat receive/send and static commands.

## Current Hatchery gateway status

Implemented:

- Gateway config flags.
- Gateway API client and `/api/erwin-gateway/smoke`.
- Signed raw-body gateway webhook receiver at `/erwin-gateway/webhook`.
- Durable gateway webhook idempotency storage.
- Gateway reward sync/list/create/update/adopt integration.
- Hatchery-authored egg reward mapping from `egg_types`.
- Observe-only redemption ingestion.
- Active grant path under feature flags.
- Direct Twitch Channel Point redemption processing is guarded off when `ERWIN_GATEWAY_ENABLED=true`; the old EventSub route acknowledges retries but does not grant eggs.
- Gateway redemption fulfillment state is recorded as fulfilled, pending manual fulfill, fulfillment failed, canceled, or ignored/duplicate.
- Gateway subscription, resub, gift-sub, subscription-end, and Bits/cheer events are durably stored and deduped. Active mode applies only fixed Gutschein effects for identifiable users; anonymous paid events are audited without gifter credit.
- Gateway stream online/offline and channel update events update the local stream cache. Public stream/profile/schedule reads use erwin-gateway while `ERWIN_GATEWAY_ENABLED=true`, with direct Twitch Helix reads retained only as rollback when gateway mode is off.
- Direct Twitch EventSub sync for migrated redemptions, sub/Bits, stream state, and channel update transport is disabled when `ERWIN_GATEWAY_ENABLED=true`; Twitch player OAuth login remains in Hatchery. Gateway mode setup completion no longer requires Hatchery-held broadcaster OAuth or direct EventSub health.

Known focus areas:

- Monitor active gateway redemptions in `/api/erwin-gateway/diagnostics` for duplicate/ignored reasons and fulfillment failures.
- Keep `ERWIN_GATEWAY_AUTO_FULFILL_REDEMPTIONS=false` unless the gateway status API is verified in the target environment.

## Active grant acceptance

A successful Channel Point redemption in active mode must:

1. verify gateway webhook signature
2. dedupe delivery/event/redemption IDs
3. find active reward mapping
4. create/update provisional user
5. increment mystery egg balance
6. write economy ledger
7. commit DB transaction
8. call gateway fulfillment only after commit
9. record fulfillment success/failure
10. never grant twice on retry

## Pending broader milestones

- Admin lifecycle controls: freeze/reset/delete progress and fuller role lifecycle.
- Monitor gateway sub/Bits and stream/channel diagnostics and confirm gateway backfill/read behavior in the target environment.
- Deployment hardening: rate limiting, strict CORS, backup/restore automation.
- erwin-music gateway migration.
