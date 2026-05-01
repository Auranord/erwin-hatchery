# Data Model - Erwin Hatchery MVP

This document describes the recommended database shape. Exact names can change, but the concepts should remain.

## Principles

- Twitch user ID is the canonical identity.
- All economy mutations are server-side and ledgered.
- Mystery eggs are stored as per-user integer balances by egg type.
- Egg contents are determined at identify/open time for mystery eggs and are ledgered.
- Database should support future features: more egg types, fusion, training, items, buffs, battle formulas.
- Events must be reversible where practical, especially admin-started battles.

## Core tables

### users

Stores Twitch-linked user accounts and provisional users.

Suggested fields:

```text
id uuid primary key
twitch_user_id text unique not null
twitch_login text
display_name text
avatar_url text
is_provisional boolean not null default true
is_deleted boolean not null default false
created_at timestamp
updated_at timestamp
last_login_at timestamp
```

A provisional user is created from a Channel Point redemption before first login. On Twitch login, update the same row.

### roles

```text
id uuid primary key
user_id uuid references users(id)
role text not null -- owner, admin, moderator, user
created_by_user_id uuid nullable
created_at timestamp
```

The configured broadcaster Twitch ID should receive `owner` on first login.

### twitch_events

Stores raw Twitch events for idempotency and audit.

```text
id uuid primary key
twitch_event_id text unique not null
type text not null
source text not null -- eventsub, oauth, manual
user_id uuid nullable
raw_payload jsonb not null
received_at timestamp
processed_at timestamp nullable
processing_status text -- received, processed, ignored, failed
error text nullable
```

### channel_point_redemptions

Specific normalized table for redemptions.

```text
id uuid primary key
twitch_redemption_id text unique not null
twitch_reward_id text not null
user_id uuid references users(id)
cost integer not null
status text not null -- received, fulfilled, canceled, ignored, failed
raw_payload jsonb not null
created_at timestamp
processed_at timestamp nullable
```

### economy_ledger

Immutable audit log for economy mutations.

```text
id uuid primary key
user_id uuid nullable references users(id)
actor_user_id uuid nullable references users(id) -- admin/user/system that caused it
event_type text not null
source_type text not null -- twitch_redemption, user_action, admin_action, battle_event, system
source_id uuid nullable
delta jsonb not null
reverts_ledger_id uuid nullable references economy_ledger(id)
is_reverted boolean not null default false
created_at timestamp
```

Examples:

- `egg.created_from_channel_points`
- `egg.identified_as_resource`
- `egg.identified_as_pet_egg`
- `pet.hatched`
- `resource.spend`
- `battle.points_awarded`
- `admin.grant_test_egg`
- `admin.revert_battle`

### resources

Stores player resource balances.

```text
user_id uuid references users(id)
resource_type text not null -- cracked_eggs
amount integer not null default 0
updated_at timestamp
primary key(user_id, resource_type)
```

### egg_types

Config table for egg types.

```text
id text primary key -- basic_mystery_egg
display_name text not null
base_incubation_seconds integer not null
is_active boolean not null default true
created_at timestamp
```

### egg_loot_table_entries

Granular loot table for each egg type.

```text
id uuid primary key
egg_type_id text references egg_types(id)
weight integer not null
outcome_type text not null -- resource, unhatched_egg
resource_type text nullable
resource_amount integer nullable
pet_type_id text nullable references pet_types(id)
is_active boolean not null default true
```

Use integer weights, not floating percentages. Example: total weight 10000 for basis points.

### mystery_egg_inventory

Mystery eggs tracked as integer balances, not per-instance rows.

```text
user_id uuid references users(id)
egg_type_id text references egg_types(id)
amount integer not null default 0
updated_at timestamp
primary key(user_id, egg_type_id)
```

When a redemption grants a mystery egg, increment this balance and write an economy ledger row.
When a player identifies a mystery egg, decrement this balance in the same transaction that resolves the outcome and writes ledger rows.

### unhatched_eggs

Pet eggs that are known to contain a pet, but not which pet.

```text
id uuid primary key
owner_user_id uuid references users(id)
egg_type_id text references egg_types(id)
hidden_pet_type_id text references pet_types(id)
state text not null -- ready, incubating, hatched, deleted
created_from_redemption_id uuid nullable references channel_point_redemptions(id)
created_at timestamp
```

### incubator_slots

Tracks available incubators.

```text
id uuid primary key
owner_user_id uuid references users(id)
slot_source text not null -- base, subscriber, upgrade
slot_level integer not null default 1
is_available boolean not null default true
remove_when_empty boolean not null default false
created_at timestamp
updated_at timestamp
```

Subscriber incubator behavior:

- When sub is active, ensure subscriber slot exists.
- When sub ends, set `remove_when_empty = true` if occupied, otherwise mark unavailable/delete.

### incubation_jobs

Tracks eggs in incubators.

```text
id uuid primary key
owner_user_id uuid references users(id)
unhatched_egg_id uuid references unhatched_eggs(id)
incubator_slot_id uuid references incubator_slots(id)
state text not null -- active, completed, canceled
started_at timestamp
completed_at timestamp nullable
required_progress_seconds integer not null
progress_snapshot jsonb not null -- modifiers at start if needed
```

Do not tick every second in the database. Calculate effective progress from timestamps and stream multipliers.

### pet_types

Config table for pet species/types.

```text
id text primary key
display_name text not null
rarity text not null -- regular, rare
role text not null
base_hp integer not null
base_attack integer not null
base_defense integer not null
base_speed integer not null
asset_key text not null
is_active boolean not null default true
```

### pets

Unique hatched pet instances.

```text
id uuid primary key
owner_user_id uuid references users(id)
pet_type_id text references pet_types(id)
display_name text nullable
hp integer not null
attack integer not null
defense integer not null
speed integer not null
stat_rolls jsonb not null
source_unhatched_egg_id uuid references unhatched_eggs(id)
is_favorite boolean not null default false
selected_for_event boolean not null default false
created_at timestamp
hatched_at timestamp
```

Future fields can include level, experience, fusion count, training history, equipment slots, cosmetics.

### consumable_types / consumable_inventory

```text
consumable_types:
id text primary key
display_name text
description text
effect_type text
config jsonb
is_active boolean

consumable_inventory:
user_id uuid
consumable_type_id text
amount integer
primary key(user_id, consumable_type_id)
```

### hatchery_upgrades

```text
id uuid primary key
user_id uuid references users(id)
upgrade_type text not null -- incubator_speed_level, extra_incubator
level integer not null
created_at timestamp
updated_at timestamp
```

## Battle/event tables

### game_events

```text
id uuid primary key
event_type text not null -- battle
status text not null -- draft, running, resolved, reverted
started_by_user_id uuid references users(id)
started_at timestamp
resolved_at timestamp nullable
reverted_at timestamp nullable
result_json jsonb nullable
```

### game_event_participants

```text
id uuid primary key
game_event_id uuid references game_events(id)
user_id uuid references users(id)
pet_id uuid references pets(id)
placement integer nullable
points_awarded integer not null default 0
created_at timestamp
```

### leaderboard_scores

```text
user_id uuid references users(id)
leaderboard_type text not null -- battle_points
score integer not null default 0
updated_at timestamp
primary key(user_id, leaderboard_type)
```

## MVP seed data

### Pet types

```text
waldwachtel      Waldwachtel      regular balanced 100 10 8 12
glitzer_spatz    Glitzer-Spatz    regular fast      80  8  5 18
moorente         Moorente         regular tank      120 7  12 7
turmeule         Turmeule         regular striker   90  14 7 10
goldener_erwin   Goldener Erwin   rare    allrounder 110 13 10 13
```

### Egg type

```text
basic_mystery_egg | 1x Mystery Ei | base incubation time configurable
```

### Basic egg loot table weights

Use weights totaling 10000:

```text
2800 resource cracked_eggs 10
2200 resource cracked_eggs 20
1200 resource cracked_eggs 35
 600 resource cracked_eggs 60
 800 pet waldwachtel
 800 pet glitzer_spatz
 700 pet moorente
 700 pet turmeule
 200 pet goldener_erwin
```


## Admin action log

- `admin_action_logs` stores immutable admin mutations.
- Fields: `actor_user_id`, `target_user_id`, `action_type`, idempotency `request_id`, `payload`, `created_at`.
- Role changes are the only economy-adjacent admin mutation in milestone 3.


## Milestone 3 data flow
- `twitch_events`: one row per unique Twitch EventSub event ID (`twitch_event_id` unique).
- `channel_point_redemptions`: one row per unique Twitch redemption ID (`twitch_redemption_id` unique).
- Valid configured reward redemptions create one unhatched egg, increment `mystery_egg_inventory`, and append one `economy_ledger` mutation event.
