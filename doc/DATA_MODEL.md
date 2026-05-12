# Data Model - Erwin Hatchery MVP

This document describes the recommended database shape. Exact names can change, but the concepts should remain.

## Principles

- Twitch user ID is the canonical identity.
- All economy mutations are server-side and ledgered.
- Mystery eggs are stored as per-user integer balances by egg type.
- Egg contents are determined at identify/open time for mystery eggs and are ledgered.
- Database should support future features: more egg types, fusion, training, consumables, cosmetic hats, boss-event formulas, and runtime boss state. Owned pets already carry level, experience, and favorite fields so progression/fusion systems can be added without another base pet-row rewrite.
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
id text primary key -- beta_egg
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

### inventory_dimensions

Per-user grid configuration for slotted inventories. `bonus_rows` is the upgrade counter used for row expansion pricing: `500 * 2^bonus_rows` `cracked_eggs` for the next row when `upgrade_ref` is set.

```text
user_id uuid references users(id)
inventory_kind text not null
columns integer not null
base_rows integer not null
bonus_rows integer not null default 0
upgrade_ref text nullable
updated_at timestamp
primary key(user_id, inventory_kind)
```

### unhatched_eggs

Pet eggs that are known to contain a pet, but not which pet.

```text
id uuid primary key
owner_user_id uuid references users(id)
egg_type_id text references egg_types(id)
hidden_pet_species_id text references pet_species(id)
state text not null -- ready_for_incubation, incubating, hatched, deleted
slot_index integer nullable -- only ready_for_incubation eggs occupy unhatched inventory slots
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
id text primary key -- common, uncommon, rare, epic, legendary
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
related_enemy_stat text not null -- enemy stat this class counters or targets: ATK, DEF, SPD, GAIN, POW
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

Config table for species templates, default stats, fixed rarity/class/element assignments, and the species default ability. Species defaults are the starting template only; hatched pets store their own permanent base stats, copied rarity/class/element IDs, and copied individual ability in `pets`.

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
rarity_id text not null references pet_rarities(id)
class_id text not null references pet_classes(id)
element_id text not null references elements(id)
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

Unique owned pet instances. A pet is created from its species defaults plus hatch variance, receives `rarity_id`, `class_id`, and `element_id` from its `pet_species` row, receives an individual `ability_id` copied from `pet_species.default_ability_id`, starts at level 0 with 0 experience, and starts with `is_favorite = false`. Its permanent base stats, individual ability, and progression fields live on the `pets` row so later training or fusion systems can change that individual pet without changing the species template.

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
experience integer not null default 0 -- future progression/fusion input; server-authoritative
level integer not null default 0 -- future progression/fusion output; server-authoritative
training_adjustments jsonb not null default '{}' -- future additive/permanent training changes
equipped_hat_id text nullable references hats(id)
source_unhatched_egg_id uuid references unhatched_eggs(id)
is_favorite boolean not null default false -- future fusion material protection; favorite pets cannot be selected as fusion materials
selected_for_event boolean not null default false
is_scrapped boolean not null default false
scrapped_at timestamp nullable
created_at timestamp -- owned pet row creation time; this is also the hatch time for normal hatches
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
- `pet_species` defines default stats, fixed rarity/class/element assignments, and the default ability; `pets` stores the owned instance, its own permanent base stats, its copied rarity/class/element IDs, and its own ability.
- Hatch generation starts from species defaults, applies hatch variance, copies `pet_species.rarity_id`, `pet_species.class_id`, `pet_species.element_id`, and `pet_species.default_ability_id` into the owned pet row, and writes an immutable ledger row.
- Training may later modify `base_*` values, change `pets.ability_id`, update trait assignments, or append to `training_adjustments`; it must be server-authoritative and ledgered.
- Rarity is used for display, economy metadata, combine progression, and recycle value only. It is never a stat multiplier.
- A pet may equip at most one cosmetic hat. Hats must not affect combat stats, AP gain, ability effects, or boss-event stack logic.
- Final gem combat mechanics are intentionally not part of the pet equipment model in this pass. This Beta adds a placeholder equipment item named `Beta Gem` (`equipment_slot = gem`) only to test server-authoritative equipment-set placement; it has no combat effect and does not define final gem mechanics.
- Current AP, current HP, attacks made, effective stats, class stacks, and element stacks are runtime boss-event state and must not be stored on `pets`.

Future fields can include level, experience, fusion count, and richer training history.

### consumables, equipment, and hats

Consumables are no longer a generic item stack. They are nonstackable slotted instances in their own 8×3 inventory. Equipment and hats use separate, similar nonstackable inventories so future pet battle gear and cosmetics can evolve independently. Equipment can also be assigned to player-owned equipment sets; assigned equipment no longer occupies or appears in the normal equipment grid.

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

equipment_sets:
id uuid primary key
user_id uuid references users(id)
set_index integer
label text
base_slot_count integer -- default 3
bonus_slot_count integer -- default 0
selected_for_event boolean
upgrade_ref text -- equipment_set_slots
created_at timestamp
updated_at timestamp
unique(user_id, set_index)

equipment_inventory_slots:
id uuid primary key
user_id uuid references users(id)
equipment_type_id text references equipment_types(id)
slot_index integer nullable -- normal equipment grid location
equipment_set_id uuid nullable references equipment_sets(id)
equipment_set_slot_index integer nullable -- set-local location
created_at timestamp
updated_at timestamp
unique(user_id, slot_index)
unique(equipment_set_id, equipment_set_slot_index)

Each equipment item must have exactly one stable location: a normal `slot_index`, an `(equipment_set_id, equipment_set_slot_index)`, or a temporary all-null location while a transaction performs a swap. Equipment assigned to a set is omitted from the normal equipment inventory payload.

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

The MVP seed creates one 30-species Beta pet pool. Every species uses the shared MVP baseline ability `beta_instinct`, no seeded traits are included, and Erwin is not a pet. Default non-HP stats are 10 plus 2 for each rarity rank above Common; HP is that default stat value times 10.

| code | display_name | rarity | weight | element | class | HP | ATK/DEF/SPD/GAIN/POW |
| --- | --- | --- | ---: | --- | --- | ---: | ---: |
| glutfink | Glutfink | common | 70 | fire | nullifier | 100 | 10 |
| bachente | Bachente | common | 70 | water | nullifier | 100 | 10 |
| windlerche | Windlerche | common | 70 | air | nullifier | 100 | 10 |
| kieseltaube | Kieseltaube | common | 70 | earth | protector | 100 | 10 |
| funkenmeise | Funkenmeise | common | 70 | fire | protector | 100 | 10 |
| schilfreiher | Schilfreiher | common | 70 | water | sunderer | 100 | 10 |
| mooswachtel | Mooswachtel | common | 70 | air | sunderer | 100 | 10 |
| erdspatz | Erdspatz | common | 70 | earth | saboteur | 100 | 10 |
| rauchsegler | Rauchsegler | common | 70 | fire | saboteur | 100 | 10 |
| tropfenmoewe | Tropfenmöwe | common | 70 | water | drainer | 100 | 10 |
| wolkenzaunkoenig | Wolkenzaunkönig | common | 70 | air | drainer | 100 | 10 |
| knollenhuhn | Knollenhuhn | common | 70 | earth | drainer | 100 | 10 |
| kerzenkauz | Kerzenkauz | uncommon | 30 | fire | protector | 120 | 12 |
| perlentaucher | Perlentaucher | uncommon | 30 | water | protector | 120 | 12 |
| sturmschwalbe | Sturmschwalbe | uncommon | 30 | air | sunderer | 120 | 12 |
| lehmspecht | Lehmspecht | uncommon | 30 | earth | sunderer | 120 | 12 |
| kupferfasan | Kupferfasan | uncommon | 30 | fire | sunderer | 120 | 12 |
| regenkranich | Regenkranich | uncommon | 30 | water | saboteur | 120 | 12 |
| boeenfalke | Böenfalke | uncommon | 30 | air | saboteur | 120 | 12 |
| wurzelrabe | Wurzelrabe | uncommon | 30 | earth | saboteur | 120 | 12 |
| phoenixkueken | Phönixküken | rare | 14 | fire | nullifier | 140 | 14 |
| mondreiher | Mondreiher | rare | 14 | water | nullifier | 140 | 14 |
| himmelsgreifchen | Himmelsgreifchen | rare | 14 | air | protector | 140 | 14 |
| runenwachtel | Runenwachtel | rare | 14 | air | protector | 140 | 14 |
| kristallkraehe | Kristallkrähe | rare | 14 | earth | drainer | 140 | 14 |
| obsidianule | Obsidianule | rare | 14 | earth | drainer | 140 | 14 |
| sonnenroc | Sonnenroc | epic | 11 | fire | sunderer | 160 | 16 |
| tiefseealk | Tiefseealk | epic | 11 | water | saboteur | 160 | 16 |
| bergwyrm_kondor | Bergwyrm-Kondor | epic | 11 | earth | drainer | 160 | 16 |
| lichtseraph | Lichtseraph | legendary | 3 | light | nullifier | 180 | 18 |

Seed `pet_rarities`, `pet_classes`, `elements`, the shared MVP baseline `pet_abilities` row, and `hats` before seeding owned pet fixtures. Rarity seed values define display/economy/combine/recycle metadata and the static seed defaults above.

### Egg type

```text
beta_egg | 1x Beta Ei | seeded active
```

### Beta egg loot table weights

Use integer pet weights totaling 1200 plus `cracked_eggs` resource weights totaling 2400. The combined table weight is 3600, so pets are about one third of Beta Ei identifications and egg resources are about two thirds.

```text
Common pets total       840 = 23.33% of all outcomes (12 pets x 70)
Uncommon pets total     240 =  6.67% of all outcomes (8 pets x 30)
Rare pets total          84 =  2.33% of all outcomes (6 pets x 14)
Epic pets total          33 =  0.92% of all outcomes (3 pets x 11)
Legendary pet total       3 =  0.08% of all outcomes (1 pet x 3)
cracked_eggs x50        800 = 22.22% of all outcomes
cracked_eggs x100       800 = 22.22% of all outcomes
cracked_eggs x200       800 = 22.22% of all outcomes
```

Within the pet subset, rarity proportions remain 70.00% Common, 20.00% Uncommon, 7.00% Rare, 2.75% Epic, and 0.25% Legendary. The seed validates the pet totals, class counts, normal element counts, and that light appears only on the legendary pet before writing the data.

## Admin action log

- `admin_action_logs` stores immutable admin mutations.
- Fields: `actor_user_id`, `target_user_id`, `action_type`, idempotency `request_id`, `payload`, `created_at`.
- Role changes are the only economy-adjacent admin mutation in milestone 3.

## Milestone 3 data flow

- `twitch_events`: one row per unique Twitch EventSub event ID (`twitch_event_id` unique).
- `channel_point_redemptions`: one row per unique Twitch redemption ID (`twitch_redemption_id` unique).
- Valid configured reward redemptions currently create one active configured egg inventory unit, seeded as `beta_egg`, increment `mystery_egg_inventory`, and append one `economy_ledger` mutation event.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` and `voucher` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies only to slotted inventories: unhatched eggs, pets, consumables, equipment, and hats. Incubators are fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for row expansion. Upgradeable slotted inventories are expanded one row at a time; the first row upgrade for each inventory costs 500 `cracked_eggs`, and each subsequent upgrade for that same inventory doubles the cost based on its current `bonus_rows`.
- Standard grid dimensions are 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables, equipment, and hats.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- Event-Pet selection is represented by the `pets.selected_for_event` flag. The UI exposes it as a fixed drop target above the pet grid, but the selected pet remains in the pet grid and therefore continues to consume its normal pet inventory slot.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the job stays running, the egg stays incubating, no pet is created, and the incubator remains occupied.
- Identifying a mystery egg into an unhatched egg serializes the user's inventory mutation, requires free unhatched egg inventory space before consuming the counted mystery egg, and leaves the counted mystery egg unchanged when full.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables, equipment, and cosmetic hats are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Equipment also supports server-authoritative equipment sets: every player receives one default 3-slot set, items in a set are removed from the normal equipment grid, and one set can be marked as the battle Event-Set. Unhatched eggs, consumables, equipment, and hats expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation and inventory row upgrade is server-authoritative, transactional, and recorded in `economy_ledger`.

## Twitch reward-ingestion tables

- `twitch_integration_state`: singleton setup state with broadcaster ID/login, required scopes, setup/EventSub/backfill completion timestamps, `requires_reauth`, health timestamp, EventSub health, and last error.
- `twitch_eventsub_subscriptions`: one row per required EventSub type/version with Twitch subscription ID, status, callback URL, sync timestamp, and last error.
- `twitch_backfill_runs`: resumable/auditable backfill runs for subscriptions and Bits with status, source, timestamps, and error.
- `twitch_bits_balances`: per-user Bits accounting with imported leaderboard baseline, live EventSub Bits total, total counted Bits, and granted voucher thresholds.
- `twitch_events`: stores EventSub notifications and stable backfill source keys. These rows are used as immutable `economy_ledger.source_id` references for idempotent voucher grants.
