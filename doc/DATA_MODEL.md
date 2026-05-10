# Data Model - Erwin Hatchery MVP

This document describes the recommended database shape. Exact names can change, but the concepts should remain.

## Principles

- Twitch user ID is the canonical identity.
- All economy mutations are server-side and ledgered.
- Mystery eggs are stored as per-user integer balances by egg type.
- Egg contents are determined at identify/open time for mystery eggs and are ledgered.
- Database should support future features: more egg types, fusion, training, consumables, cosmetic hats, boss-event formulas, and runtime boss state.
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
is_subscriber boolean not null default false
subscriber_ends_at timestamp nullable
created_at timestamp
updated_at timestamp
last_login_at timestamp
```

A provisional user is created from a Channel Point redemption before first login. On Twitch login, update the same row.
`is_subscriber` and `subscriber_ends_at` cache Twitch subscription state for Milestone 9 admin visibility and fixed subscription resource grants. Subscriptions do not grant incubators.

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
id text primary key -- common_mystery_egg / uncommon_mystery_egg / rare_mystery_egg
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
pet_species_id text nullable references pet_species(id)
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
hidden_pet_species_id text references pet_species(id)
state text not null -- ready, incubating, hatched, deleted
created_from_redemption_id uuid nullable references channel_point_redemptions(id)
created_at timestamp
```

### incubator_slots

Tracks the single standard incubator and future queue/upgrade slots.

```text
id uuid primary key
owner_user_id uuid references users(id)
slot_source text not null -- default, upgrade (future); subscriber/admin sources are not used in MVP
slot_level integer not null default 1
slot_index integer nullable
speed_multiplier_basis_points integer not null default 10000
special_bonus_basis_points integer not null default 0 -- incubation/economy modifier placeholder; not a pet stat multiplier
fuel_behavior text not null default 'none'
special_effect_config jsonb not null default '{}'
is_available boolean not null default true
remove_when_empty boolean not null default false
created_at timestamp
updated_at timestamp
```

Incubator behavior:

- Ensure one default standard incubator exists for every player at slot index 0.
- Two incubator queue slots are enabled at launch. Additional queue slots are future upgrades and must not be enabled until explicitly granted.
- Subscriptions and admin actions do not grant incubators in the MVP.
- Queueing incubation writes an immutable ledger row. The first queued egg starts automatically when the stream is live and no other egg is running.

### incubation_jobs

Tracks eggs in incubators.

```text
id uuid primary key
owner_user_id uuid references users(id)
unhatched_egg_id uuid references unhatched_eggs(id)
incubator_slot_id uuid references incubator_slots(id)
state text not null -- queued, running, completed, canceled
started_at timestamp -- queue insertion/start metadata timestamp
completed_at timestamp nullable
required_progress_seconds integer not null
progress_seconds_accumulated integer not null default 0
last_progressed_at timestamp nullable -- last live-progress sync point for running jobs
progress_snapshot jsonb not null -- stream state/modifiers from latest sync if needed
```

Do not tick every second in the database. Store accumulated progress plus the last live-progress timestamp, and only add progress for elapsed time while the stream is live.

### pet_rarities

Config table for rarity rank and economy/display metadata. Rarity is not a stat multiplier and must not directly scale hatch stats, battle stats, ability strength, AP generation, or boss-event stack values.

```text
id text primary key -- regular, rare, epic, legendary
label_de text not null
rank integer not null unique
display_config jsonb not null default '{}' -- colors, badges, labels
economy_config jsonb not null default '{}' -- non-random shop/pricing metadata
combine_progression_config jsonb not null default '{}' -- future combine/fusion thresholds
recycle_cracked_eggs integer not null default 0
is_active boolean not null default true
created_at timestamp
updated_at timestamp
```

### pet_classes

Config table for the exactly-one class assigned to each pet. Class metadata is static pet identity data. Boss class stacks are runtime boss-event state and are not stored on `pets`.

```text
id text primary key
label_de text not null
description text not null default ''
is_active boolean not null default true
```

### elements

Config table for the exactly-one element assigned to each pet. Element metadata is static pet identity data. Boss element stacks are runtime boss-event state and are not stored on `pets`.

```text
id text primary key
label_de text not null
description text not null default ''
is_active boolean not null default true
```

### pet_abilities

Config table for automatic pet abilities. Current AP is runtime boss-event participant state, not pet state.

```text
id text primary key
label_de text not null
description text not null default ''
ap_required integer not null -- AP required to auto-trigger
min_attacks_required integer not null default 0 -- attacks required before auto-trigger is allowed
effect_type text not null
effect_config jsonb not null default '{}' -- formulas may reference POW as ability-effect scaling
is_active boolean not null default true
created_at timestamp
updated_at timestamp
```

Ability trigger rule for future boss-event logic: after an attack and AP gain are resolved, automatically trigger when `current_ap >= pet_abilities.ap_required` and `attacks_made >= pet_abilities.min_attacks_required`. Attacks grant 20 base AP. The pet's permanent `gain` stat modifies AP gained per attack. The pet's permanent `pow` stat scales ability effects.

### pet_species

Config table for species templates, default stats, and the species default ability. Species defaults are the starting template only; hatched pets store their own permanent base stats and copied individual ability in `pets`.

```text
id text primary key
display_name text not null
label_de text not null
description text not null default ''
default_hp integer not null
default_atk integer not null
default_def integer not null
default_spd integer not null
default_gain integer not null
default_pow integer not null
default_ability_id text not null references pet_abilities(id)
asset_key text not null
is_active boolean not null default true
created_at timestamp
updated_at timestamp
```

### pet_traits

Reusable trait definitions that can be assigned to pet instances. Modifiers are signed integers and may be positive, negative, or zero for each permanent base stat. The MVP stores the data model now; combat formulas can decide later how trait modifiers affect effective stats.

```text
id text primary key
label_de text not null
description text not null default ''
hp_modifier integer not null default 0
atk_modifier integer not null default 0
def_modifier integer not null default 0
spd_modifier integer not null default 0
gain_modifier integer not null default 0
pow_modifier integer not null default 0
is_active boolean not null default true
created_at timestamp
updated_at timestamp
```

### pets

Unique owned pet instances. A pet is created from its species defaults plus hatch variance and receives an individual `ability_id` copied from `pet_species.default_ability_id`. Its permanent base stats and individual ability live on the `pets` row so later training can change that individual pet without changing the species template.

```text
id uuid primary key
owner_user_id uuid references users(id)
species_id text not null references pet_species(id)
rarity_id text not null references pet_rarities(id)
class_id text not null references pet_classes(id)
element_id text not null references elements(id)
ability_id text not null references pet_abilities(id) -- copied from pet_species.default_ability_id at hatch; future training may change the individual pet
nickname text nullable
base_hp integer not null
base_atk integer not null
base_def integer not null
base_spd integer not null
base_gain integer not null
base_pow integer not null
hatch_variance jsonb not null -- source rolls used to derive initial permanent base stats
training_adjustments jsonb not null default '{}' -- future additive/permanent training changes
equipped_hat_id text nullable references hats(id)
source_unhatched_egg_id uuid references unhatched_eggs(id)
is_favorite boolean not null default false
selected_for_event boolean not null default false
is_scrapped boolean not null default false
scrapped_at timestamp nullable
created_at timestamp
hatched_at timestamp
```

### pet_trait_assignments

Join table that stores the ordered-independent list of traits assigned to each owned pet. Assigning, replacing, or removing traits later counts as a server-authoritative training/economy action and must be ledgered.

```text
pet_id uuid not null references pets(id)
trait_id text not null references pet_traits(id)
assigned_at timestamp
primary key (pet_id, trait_id)
```

Pet invariants:

- Every pet has exactly one class, one element, and one individual ability.
- `pet_species` defines default stats and the default ability; `pets` stores the owned instance, its own permanent base stats, and its own ability.
- Hatch generation starts from species defaults, applies hatch variance, copies `pet_species.default_ability_id` into `pets.ability_id`, assigns rarity/class/element from explicit server-side hatch rules, and writes an immutable ledger row.
- Training may later modify `base_*` values, change `pets.ability_id`, update trait assignments, or append to `training_adjustments`; it must be server-authoritative and ledgered.
- Rarity is used for display, economy metadata, combine progression, and recycle value only. It is never a stat multiplier.
- A pet may equip at most one cosmetic hat. Hats must not affect combat stats, AP gain, ability effects, or boss-event stack logic.
- Gems are intentionally not part of the pet equipment model in this pass. Do not add gem equip slots or gem combat effects yet.
- Current AP, current HP, attacks made, effective stats, class stacks, and element stacks are runtime boss-event state and must not be stored on `pets`.

Future fields can include level, experience, fusion count, and richer training history.

### consumables, equipment, and hats

Consumables are no longer a generic item stack. They are nonstackable slotted instances in their own 8×3 inventory. Equipment and hats use separate, similar nonstackable inventories so future pet battle gear and cosmetics can evolve independently.

```text
consumable_types:
id text primary key
display_name text
description text
effect_type text
config jsonb
is_active boolean

consumable_inventory_slots:
id uuid primary key
user_id uuid references users(id)
consumable_type_id text references consumable_types(id)
slot_index integer nullable
created_at timestamp
updated_at timestamp
unique(user_id, slot_index)

equipment_types:
id text primary key
display_name text
description text
equipment_slot text
config jsonb
is_active boolean
created_at timestamp

equipment_inventory_slots:
id uuid primary key
user_id uuid references users(id)
equipment_type_id text references equipment_types(id)
slot_index integer nullable
created_at timestamp
updated_at timestamp
unique(user_id, slot_index)

hats:
id text primary key
label_de text
description text
config jsonb -- cosmetic display/positioning metadata only; no stat effects
is_active boolean
created_at timestamp

hat_inventory_slots:
id uuid primary key
user_id uuid references users(id)
hat_id text references hats(id)
slot_index integer nullable
created_at timestamp
updated_at timestamp
unique(user_id, slot_index)
```

### hatchery_upgrades

```text
id uuid primary key
user_id uuid references users(id)
upgrade_type text not null -- incubator_speed_level, incubator_queue_slot
level integer not null
created_at timestamp
updated_at timestamp
```

## Battle/event tables

Boss-event combat formulas are documentation-only for this pass. Do not implement battle logic in code yet. Runtime AP, current HP, attacks made, effective stats, class stacks, element stacks, and temporary effects belong on participant runtime state, not on `pets`.

### game_events

```text
id uuid primary key
event_type text not null -- battle, boss_event
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
runtime_state jsonb not null default '{}' -- boss-event state: current_ap, current_hp, attacks_made, effective_stats, class stacks, element stacks, temporary effects
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

### Pet species

```text
waldwachtel      Waldwachtel      regular balanced        class=balanced element=nature ability=peck_burst    HP=100 ATK=10 DEF=8  SPD=12 GAIN=100 POW=100
glitzer_spatz    Glitzer-Spatz    regular fast            class=scout    element=air    ability=glimmer_dash  HP=80  ATK=8  DEF=5  SPD=18 GAIN=115 POW=90
moorente         Moorente         regular tank            class=guardian element=water  ability=mud_guard     HP=120 ATK=7  DEF=12 SPD=7  GAIN=90  POW=105
turmeule         Turmeule         regular striker         class=striker  element=shadow ability=owl_strike    HP=90  ATK=14 DEF=7  SPD=10 GAIN=100 POW=115
goldener_erwin   Goldener Erwin   rare    rare_allrounder   class=hero     element=light  ability=golden_crowl  HP=110 ATK=13 DEF=10 SPD=13 GAIN=105 POW=110
```

Seed `pet_rarities`, `pet_classes`, `elements`, `pet_abilities`, `pet_traits`, and `hats` before seeding owned pet fixtures. Rarity seed values define display/economy/combine/recycle metadata only, never stat multipliers.

### Egg type

```text
common_mystery_egg | 1x Gewöhnliches Mystery Ei | seeded
uncommon_mystery_egg | 1x Ungewöhnliches Mystery Ei | seeded
rare_mystery_egg | 1x Seltenes Mystery Ei | seeded
```

### Basic egg loot table weights

Use weights totaling 10000:

```text
2800 resource cracked_eggs 10
2200 resource cracked_eggs 20
1200 resource cracked_eggs 35
 600 resource cracked_eggs 60
 800 pet_species waldwachtel
 800 pet_species glitzer_spatz
 700 pet_species moorente
 700 pet_species turmeule
 200 pet_species goldener_erwin
```

## Admin action log

- `admin_action_logs` stores immutable admin mutations.
- Fields: `actor_user_id`, `target_user_id`, `action_type`, idempotency `request_id`, `payload`, `created_at`.
- Role changes are the only economy-adjacent admin mutation in milestone 3.

## Milestone 3 data flow

- `twitch_events`: one row per unique Twitch EventSub event ID (`twitch_event_id` unique).
- `channel_point_redemptions`: one row per unique Twitch redemption ID (`twitch_redemption_id` unique).
- Valid configured reward redemptions currently create one `common_mystery_egg` inventory unit, increment `mystery_egg_inventory`, and append one `economy_ledger` mutation event.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` and `voucher` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies only to slotted inventories: unhatched eggs, pets, consumables, equipment, and hats. Incubators are fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion.
- Standard grid dimensions are 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables, equipment, and hats.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- Event-Pet selection is represented by the `pets.selected_for_event` flag. The UI exposes it as a fixed drop target above the pet grid, but the selected pet remains in the pet grid and therefore continues to consume its normal pet inventory slot.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the job stays running, the egg stays incubating, no pet is created, and the incubator remains occupied.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables, equipment, and cosmetic hats are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Unhatched eggs, consumables, equipment, and hats expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.
