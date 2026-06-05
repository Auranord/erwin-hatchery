# Data Model Compact Reference

This is the practical schema reference for implementation. Exact names may differ, but invariants should remain.

## Principles

- Twitch user ID is canonical identity.
- Provisional users can be created before first login.
- All economy mutations are server-side, transactional, and ledgered.
- Mystery eggs are counted integer balances per egg type.
- Slotted inventories have capacity; counted balances do not.
- Gateway/Twitch events are stored before side effects and deduped by external identifiers.
- Events should be reversible where practical.

## Key tables/concepts

### users

Stores Twitch-linked and provisional users.

Important fields:

- `twitch_user_id` unique
- `twitch_login`
- `display_name`
- `avatar_url`
- `is_provisional`
- `is_deleted`
- `is_subscriber`
- `subscriber_ends_at`

### roles

Server-side roles per user: owner, admin, moderator, user.

### gateway_webhook_events

Stores verified erwin-gateway deliveries before side effects.

Important uniqueness:

- `delivery_id` unique
- `event_id` unique
- `twitch_redemption_id` unique when non-null

Stores:

- event type
- raw payload
- processing status
- error
- timestamps

### twitch_events

Legacy/direct Twitch EventSub and backfill audit table. Still relevant while old direct Twitch path exists.

### channel_point_redemptions

Normalized redemption cache.

Important fields:

- `twitch_redemption_id` unique
- `twitch_reward_id`
- `gateway_reward_id` if available
- user reference
- cost
- status
- mapping status
- raw payload
- processed/fulfilled/canceled timestamps if implemented

### gateway_reward_mappings

Maps gateway/Twitch rewards to Hatchery economy reward types.

Important fields:

- `local_reward_type`, e.g. `egg_type:beta_egg`
- `gateway_reward_id`
- `twitch_reward_id`
- `app_ownership_key`, e.g. `hatchery:basic_mystery_egg`
- `ownership_status`
- `manageable`
- `can_adopt`
- `can_mutate`
- `is_active`
- metadata
- last synced timestamp

### economy_ledger

Immutable economy audit log.

Every economy mutation writes one or more ledger rows.

Typical event types:

- `egg.created_from_channel_points`
- `starter_egg_default_granted`
- `egg.identified_as_resource`
- `egg.identified_as_pet_egg`
- `incubation.started`
- `incubation.completed`
- `pet.hatched`
- `resource.spend`
- `battle.points_awarded`
- `admin.grant_test_egg`
- `subscriber_shop_pair_purchased`
- `pet.training_applied`

### egg_types

Config table. MVP:

- `beta_egg`: active Channel Point egg
- `starter_egg`: inactive first-login egg

Relevant fields:

- display name
- base incubation seconds
- active flag
- optional Twitch/gateway reward config fields

### egg_loot_table_entries

Integer-weighted outcomes for each egg type.

Outcome types:

- resource
- unhatched/pet egg

### mystery_egg_inventory

Counted per-user mystery egg balances:

- primary key user + egg type
- amount

### resources

Counted per-user resources:

- `cracked_eggs`
- `voucher`

### inventory_dimensions

Per-user grid dimensions for slotted inventories.

### unhatched_eggs

Known pet-containing eggs with hidden pet species.

States include:

- ready_for_incubation
- incubating
- hatched
- deleted

### incubator_slots and incubation_jobs

Queue and progress model.

Rules:

- one default slot per player
- queue slots can be upgraded/purchased
- progress accumulates only while stream is live
- do not tick every second in DB

### pet config

- `pet_rarities`: display/economy/recycle metadata only, no stat multiplier.
- `pet_classes`: class identity and training stat focus.
- `elements`: static element identity.
- `pet_abilities`: ability metadata for future combat.
- `pet_species`: species templates/default stats/fixed rarity/class/element/default ability.
- `pets`: owned pet instances with copied identity, permanent stats, level/XP, favorite, selected-for-event, status.

### consumables/equipment/hats

- Consumables are nonstackable slotted items.
- Equipment is nonstackable and can be assigned to equipment sets.
- Hats are one-time unlock rows, not items.
- Hats never affect stats.

### shops

`shop_offer_selections` snapshots weekly/monthly offers so current offer sets do not change when catalog rows change.

## Server-side invariants

- Browser may send intent IDs only.
- Browser cannot set outcomes, balances, stats, stream state, or winners.
- Every placement/inventory mutation validates ownership and capacity.
- Every successful economy mutation writes `economy_ledger`.
- Duplicate external events must not double-grant.
